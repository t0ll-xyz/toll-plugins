import {
  TX_CHAIN_ID,
  TollBlockedError,
  TollUnavailableError,
  checkTx,
  chainIdOf,
  paidUrlOf,
  bodyOf,
  toJson,
  type CheckInput,
  type CheckOptions,
  type RiskAssessment,
} from "./check.js";
import { ticketOfAnswer, type TicketResult } from "./ticket.js";
import { DEFAULT_SPEND_ASSETS, spendOf, type Spend } from "./spend.js";
import { MemorySpendStore, dayStart, type SpendStore } from "./store.js";

export type WarnPolicy = "allow" | "block" | "block-high" | ((assessment: RiskAssessment) => boolean | Promise<boolean>);
export type BlockPolicy = "throw" | ((assessment: RiskAssessment) => boolean | Promise<boolean>);

export type GuardKind = "transaction" | "typedData" | "x402" | "message" | "userOp" | "calls";

export interface GuardReport {
  kind: GuardKind;
  /** what was sent to Toll (null when nothing was sent) */
  input: CheckInput | null;
  /** Toll's answer; null when Toll was unavailable or the request was not checked */
  assessment: RiskAssessment | null;
  /** what the guard did */
  decision: "allowed" | "blocked";
  /**
   * why: Toll's action, "unavailable" (Toll could not answer), "unsupported" (not a request Toll reads) or "policy"
   * (blocked by your own spend rules: allowlist, cap, approval; `policy` says which)
   */
  basis: "ALLOW" | "WARN" | "BLOCK" | "unavailable" | "unsupported" | "policy";
  /** the paid route (no daily limit) when this caller's free checks are used */
  paidUrl: string | null;
  error?: TollUnavailableError;
  /** the spend rule that blocked it (basis "policy") */
  policy?: PolicyCode;
  /** with `spend` set: what the request spends, the day-cap reservations it holds, and the approval reference */
  spend?: { spend: Spend; reservations: string[]; approvalRef?: string; needsApproval?: boolean };
  /**
   * 0.4.1, with the `ticket` option: Toll's single-use ALLOW ticket for this exact call ({ticket, signature, signer}),
   * or {why} none was issued. Put it on the call with appendTicketSuffix (routers) or pass abi.encode(ticket, signature).
   */
  ticket?: TicketResult;
}

/* ------------------------------------------------------------------ spend policy (0.4.0) */

export type PolicyCode = "not-allowlisted" | "cap-per-call" | "cap-per-day" | "cap-endpoint" | "approval-denied" | "duplicate-payment" | "unknown-spend";

export interface Caps {
  /** the most one request may spend, base units */
  perCall?: bigint;
  /** the most all requests together may spend in one UTC day, base units */
  perDay?: bigint;
}

export interface ApprovalRequest {
  kind: GuardKind;
  input: CheckInput | null;
  /** Toll's answer (null when Toll could not answer) */
  assessment: RiskAssessment | null;
  spend: Spend;
  /** each asset over its approveAbove threshold */
  over: Array<{ asset: string; amount: bigint; threshold: bigint }>;
}

/**
 * Your own rules around Toll's verdict. Order: allowlists (before Toll is asked) -> Toll's ALLOW / WARN / BLOCK
 * (unchanged) -> per-call and per-day caps -> human approval -> the day reservation is committed after the send
 * (released when the send throws). Keys are "native" or a token address (any case); amounts are base units.
 */
export interface SpendPolicy {
  /** caps per spend asset; the spend assets are native, WETH and USDG plus every key here and in approveAbove */
  assets?: Record<string, Caps>;
  /** x402 caps per endpoint: a URL prefix (origin + path), in the payment asset's base units */
  perEndpoint?: Record<string, Caps>;
  /** when a list is given, every recipient / called contract, approval spender or x402 payee must be on it */
  allow?: { to?: string[]; spender?: string[]; payTo?: string[] };
  /** a spend (or allowance) above this amount needs `approve` to say yes */
  approveAbove?: Record<string, bigint>;
  /** asks a human (or another system); no function = denied */
  approve?: (r: ApprovalRequest) => Promise<{ approved: boolean; approvalRef?: string }>;
  /** a request whose spend could not be read (a contract call Toll did not simulate): default "allow", "block" under failClosed */
  onUnknownSpend?: "allow" | "block";
}

/** blocked by your own spend rules; a TollBlockedError, so existing catch blocks still see a block */
export class TollPolicyError extends TollBlockedError {
  readonly code: PolicyCode;
  readonly asset?: string;
  readonly amount?: bigint;
  readonly limit?: bigint;
  /** the guard's report of this request */
  readonly report?: GuardReport;
  constructor(code: PolicyCode, message: string, x: { asset?: string; amount?: bigint; limit?: bigint; assessment?: RiskAssessment | null; report?: GuardReport } = {}) {
    super({ action: "BLOCK", warnings: [{ code: `policy-${code}`, severity: "critical", message }], ...(x.assessment?.["x-toll"] ? { "x-toll": x.assessment["x-toll"] } : {}) }, "policy");
    this.name = "TollPolicyError";
    this.code = code;
    this.asset = x.asset;
    this.amount = x.amount;
    this.limit = x.limit;
    this.report = x.report;
  }
}

export interface GuardOptions extends CheckOptions {
  /**
   * WARN: "block-high" (default since 0.2.0: blocked when any warning is high or critical, else allowed and logged),
   * "allow" (every WARN goes ahead, logged; the 0.1.x default), "block", or a function (true lets it through)
   */
  onWarn?: WarnPolicy;
  /** BLOCK: "throw" (default, TollBlockedError), or a function (e.g. ask a human); true lets it through */
  onBlock?: BlockPolicy;
  /**
   * Toll unreachable, timed out, 5xx, 429, or a request it could not read: "allow" (default, fail-open, logged) or
   * "block" (fail-closed, throws TollUnavailableError). `strict` makes "block" the default.
   */
  onUnavailable?: "allow" | "block";
  /** a request Toll does not read (another chain, a contract deploy): "allow" (default) or "block"; `strict`: "block" */
  onUnsupported?: "allow" | "block";
  /**
   * The strict preset: the defaults become onWarn "block", onUnavailable "block" and onUnsupported "block".
   * Any of those three passed explicitly (not undefined) still wins over the preset.
   */
  strict?: boolean;
  /** every decision, with Toll's answer; errors thrown here are caught and logged */
  onReport?: (report: GuardReport) => void | Promise<void>;
  /** where WARN / unavailable lines go (default console.warn); false = silent */
  logger?: ((message: string) => void) | false;
  /** the seller's ERC-8004 agent id for x402 payments (or a function of the URL) */
  agentId?: number | string | ((url: string) => number | string | undefined | null);
  /**
   * An EIP-7702 authorization (a transaction's authorizationList, signAuthorization / authorize): it sets the
   * wallet's code to another contract, which can then move everything the wallet holds.
   * "check" (default since 0.3.0): Toll reads it and decides (a known, verified delegate comes back WARN medium and
   * passes under onWarn "block-high"; an unknown one comes back BLOCK). It fails closed: when Toll cannot read it
   * (unreachable, another chain, a request it refuses) it is blocked, whatever onUnavailable / onUnsupported say.
   * "block": TollBlockedError, nothing is signed, Toll is not asked. "allow": let it through unchecked (logged, reported).
   */
  onAuthorization?: "check" | "block" | "allow";
  /** the site asking for a signature (a URL or host name), sent with messages so Toll can match a sign-in's domain */
  origin?: string;
  /** 0.4.0: spend caps, allowlists and human approval around Toll's verdict; unset = 0.3.x behaviour */
  spend?: SpendPolicy;
  /** where caps and paid x402 ids are counted; default an in-process MemorySpendStore per SpendPolicy object */
  store?: SpendStore;
  /** with `spend`: a request whose spend cannot be read is blocked (onUnknownSpend default "block") */
  failClosed?: boolean;
}

/** fields the wrappers pass to enforce; not part of the public options */
export interface InternalOptions extends GuardOptions {
  /** spend-mode reports of one wrapped call, committed after the send or released when it throws */
  _collect?: GuardReport[];
  /** a preview's confirm id: Toll's answer from that preview is reused once when the request is identical */
  _confirm?: string;
  /** preview: check everything, reserve nothing, never ask for approval */
  _preview?: boolean;
  /** the x402 endpoint URL (per-endpoint caps) */
  _endpoint?: string;
}

/** the effective policy: explicit options win, then the strict preset, then the defaults */
export function resolvePolicy(o: GuardOptions = {}): { onWarn: WarnPolicy; onUnavailable: "allow" | "block"; onUnsupported: "allow" | "block" } {
  const strict = o.strict === true;
  return {
    onWarn: o.onWarn ?? (strict ? "block" : "block-high"),
    onUnavailable: o.onUnavailable ?? (strict ? "block" : "allow"),
    onUnsupported: o.onUnsupported ?? (strict ? "block" : "allow"),
  };
}

const HIGH = new Set(["high", "critical"]);
/** true when any warning is high or critical */
export const hasHighWarning = (a: RiskAssessment): boolean => (a.warnings ?? []).some((w) => HIGH.has(String(w?.severity).toLowerCase()));

const say = (o: GuardOptions, msg: string) => {
  if (o.logger === false) return;
  try {
    (o.logger ?? console.warn)(`[toll-guard] ${msg}`);
  } catch {
    /* a logger must never stop a signature */
  }
};

async function report(o: GuardOptions, r: GuardReport): Promise<void> {
  if (!o.onReport) return;
  try {
    await o.onReport(r);
  } catch (e) {
    say(o, `onReport threw: ${(e as Error)?.message ?? e}`);
  }
}

const SIGN_RPC = new Set(["personal_sign", "eth_sign", "eth_signTypedData_v4"]);

/** the typed data a request signs: its typedData, or an eth_signTypedData_v4 request's params[1] (JSON or object) */
function typedOf(input: CheckInput): { domain?: Record<string, unknown> } | null {
  if (input.typedData) return input.typedData;
  if (input.rpc?.method !== "eth_signTypedData_v4") return null;
  let td: unknown = input.rpc.params?.[1];
  if (typeof td === "string") {
    try {
      td = JSON.parse(td);
    } catch {
      return null;
    }
  }
  return td && typeof td === "object" ? (td as { domain?: Record<string, unknown> }) : null;
}

/** true for a signature request (typed data, a message, a signing RPC) rather than a transaction or an x402 payment */
export const isSignature = (input: CheckInput | null | undefined): boolean =>
  !!input && !input.x402 && (!!input.typedData || !!input.message || SIGN_RPC.has(String(input.rpc?.method)));

/** true for eth_sign: it signs any 32 bytes (a transaction hash included), so it fails closed when Toll cannot answer */
export const isEthSign = (input: CheckInput | null | undefined): boolean => input?.message?.kind === "eth_sign" || input?.rpc?.method === "eth_sign";

/** the other chain a typed-data signature names (its domain chainId), or null (Robinhood Chain, none, or an x402 payment) */
function otherChainSignature(input: CheckInput): number | null {
  if (input.x402) return null;
  const c = typedOf(input)?.domain?.chainId;
  const cid = c === undefined || c === null ? null : chainIdOf(c);
  return cid !== null && cid !== TX_CHAIN_ID ? cid : null;
}

/** Toll's 400 for a request on another chain ("... chainId N is not read ...") */
const OTHER_CHAIN_400 = /chainId \d+ is not read/;

/** why Toll would not read this request, or null when it does */
export function unsupportedWhy(input: CheckInput): string | null {
  const tx = input.to !== undefined || input.data !== undefined;
  const auths = !!input.authorizationList && input.authorizationList.length > 0;
  if (!tx && auths) {
    const cid = input.chainId === undefined ? null : chainIdOf(input.chainId);
    if (input.chainId !== undefined && cid === null) return "the chain id could not be read";
    if (cid !== null && cid !== TX_CHAIN_ID) return `chain ${cid} is not read (Robinhood Chain ${TX_CHAIN_ID} only for now)`;
  }
  if (tx) {
    if (input.to === undefined || input.to === null) return "a contract deployment (no `to`) is not read";
    const cid = input.chainId === undefined ? null : chainIdOf(input.chainId);
    if (input.chainId !== undefined && cid === null) return "the chain id could not be read";
    if (cid !== null && cid !== TX_CHAIN_ID) return `chain ${cid} is not read (Robinhood Chain ${TX_CHAIN_ID} only for now)`;
  }
  const other = otherChainSignature(input);
  if (other !== null) return `a signature for chain ${other} is not read (Robinhood Chain ${TX_CHAIN_ID} only for now)`;
  if (!tx && !auths && !input.typedData && !input.x402 && !input.message && !input.rpc && !input.userOp) return "nothing to check";
  return null;
}

/**
 * Runs Toll's check on one request and applies the policy. Resolves with the report when the request may go ahead;
 * throws TollBlockedError (BLOCK, or WARN under a blocking policy) or TollUnavailableError (fail-closed).
 * `build` may throw (e.g. calldata that could not be encoded): that counts as unavailable.
 */
export async function enforce(kind: GuardKind, build: () => CheckInput | Promise<CheckInput>, o: GuardOptions = {}): Promise<GuardReport> {
  return o.spend ? enforceSpend(kind, build, o) : enforceVerdict(kind, build, o);
}

/** Toll's verdict and the 0.3.x policy (onWarn, onBlock, onUnavailable, onUnsupported) */
async function enforceVerdict(kind: GuardKind, build: () => CheckInput | Promise<CheckInput>, o: GuardOptions): Promise<GuardReport> {
  let input: CheckInput;
  try {
    input = await build();
  } catch (e) {
    const err = e instanceof TollUnavailableError ? e : new TollUnavailableError(`The request could not be read for Toll's check: ${(e as Error)?.message ?? e}`, { reason: "encode", cause: e });
    return unavailable(kind, null, err, o);
  }
  const why = unsupportedWhy(input);
  // a signature for another chain is not "unsupported -> allow": an off-chain signature Toll cannot read is refused
  if (why && isSignature(input) && otherChainSignature(input) !== null && o.onUnsupported !== "allow") {
    return refuse(kind, input, "signature-other-chain", `Not signed: ${why}. A signature Toll cannot read could hand over anything; onUnsupported: "allow" lets it through unchecked.`, o);
  }
  if (why) {
    const blocked = resolvePolicy(o).onUnsupported === "block";
    const r: GuardReport = { kind, input, assessment: null, decision: blocked ? "blocked" : "allowed", basis: "unsupported", paidUrl: null };
    await report(o, r);
    if (blocked) throw new TollUnavailableError(`Not checked by Toll: ${why}. onUnsupported is "block"${o.strict === true && o.onUnsupported === undefined ? " (strict)" : ""}.`, { reason: "unsupported" });
    return r;
  }
  let a: RiskAssessment;
  try {
    a = takeConfirmed(o, input) ?? (await checkTx(input, o));
  } catch (e) {
    const err = e instanceof TollUnavailableError ? e : new TollUnavailableError(`Toll's check failed: ${(e as Error)?.message ?? e}`, { reason: "network", cause: e });
    // Toll's 400 for a signature on another chain: blocked, never "unsupported -> allow"
    if (err.reason === "bad-request" && isSignature(input) && OTHER_CHAIN_400.test(err.message) && o.onUnsupported !== "allow") {
      return refuse(kind, input, "signature-other-chain", `Not signed: Toll does not read a signature for another chain (${err.message}). onUnsupported: "allow" lets it through unchecked.`, o);
    }
    return unavailable(kind, input, err, o);
  }
  const paidUrl = paidUrlOf(a);
  const done = async (decision: "allowed" | "blocked", basis: GuardReport["basis"]) => {
    const tk = ticketOfAnswer(a);
    const r: GuardReport = { kind, input, assessment: a, decision, basis, paidUrl, ...(tk ? { ticket: tk } : {}) };
    await report(o, r);
    return r;
  };
  if (a.action === "ALLOW") return done("allowed", "ALLOW");
  if (a.action === "BLOCK") {
    const p = o.onBlock ?? "throw";
    if (typeof p === "function" && (await p(a)) === true) {
      say(o, `BLOCK let through by onBlock: ${a.warnings.map((w) => w.code).join(", ")}`);
      return done("allowed", "BLOCK");
    }
    await done("blocked", "BLOCK");
    throw new TollBlockedError(a, "BLOCK");
  }
  // WARN, and anything that is not one of the three actions: never treated as an ALLOW
  const p = resolvePolicy(o).onWarn;
  const ok = p === "allow" ? true : p === "block" ? false : p === "block-high" ? !hasHighWarning(a) : (await p(a)) === true;
  if (ok) {
    say(o, `WARN (${kind}), going ahead: ${a.warnings.map((w) => `${w.code}: ${w.message}`).join(" | ")}${paidUrl ? ` Paid, no daily limit: ${paidUrl}` : ""}`);
    return done("allowed", "WARN");
  }
  await done("blocked", "WARN");
  throw new TollBlockedError(a, "WARN");
}

async function unavailable(kind: GuardKind, input: CheckInput | null, err: TollUnavailableError, o: GuardOptions): Promise<GuardReport> {
  // eth_sign signs any 32 bytes (a transaction hash included): it always fails closed
  const blocked = resolvePolicy(o).onUnavailable === "block" || isEthSign(input);
  const r: GuardReport = { kind, input, assessment: null, decision: blocked ? "blocked" : "allowed", basis: "unavailable", paidUrl: err.paidUrl, error: err };
  await report(o, r);
  if (blocked) throw err;
  say(o, `Toll unavailable, NOT checked, going ahead (onUnavailable "allow"): ${err.message}`);
  return r;
}

/**
 * A request the guard refuses itself, without asking Toll (EIP-7702 authorizations, an x402 402 whose header and body
 * disagree): reported as a BLOCK with one critical warning, then TollBlockedError. Nothing is sent to Toll.
 */
export async function refuse(kind: GuardKind, input: CheckInput | null, code: string, message: string, o: GuardOptions = {}): Promise<never> {
  const a: RiskAssessment = { action: "BLOCK", warnings: [{ code, severity: "critical", message }] };
  await report(o, { kind, input, assessment: a, decision: "blocked", basis: "BLOCK", paidUrl: null });
  throw new TollBlockedError(a, "BLOCK");
}

/**
 * The onAuthorization policy for an EIP-7702 authorization. Resolves true when Toll checked the whole request (the
 * "check" default: the caller asks nothing more), false when "allow" let it through unchecked (the caller still checks
 * the rest of the request); throws when it is blocked. `input` is the request with its authorizationList, or a function
 * that builds it; under "check", null is blocked (nothing to send).
 */
export async function gateAuthorization(
  kind: GuardKind,
  where: string,
  input: CheckInput | null | (() => CheckInput | Promise<CheckInput>),
  o: GuardOptions = {},
): Promise<boolean> {
  const p = o.onAuthorization ?? "check";
  const shown = typeof input === "function" ? null : input;
  if (p === "allow") {
    say(o, `EIP-7702 authorization (${where}) NOT checked, going ahead (onAuthorization "allow")`);
    await report(o, { kind, input: shown, assessment: null, decision: "allowed", basis: "unsupported", paidUrl: null });
    return false;
  }
  const what = `${where} carries an EIP-7702 authorization, which sets this wallet's code to another contract that can then move everything it holds.`;
  if (p === "block" || input === null) {
    return refuse(kind, shown, "eip7702-authorization", `${what} ${p === "block" ? 'onAuthorization is "block"' : "It could not be read for Toll's check"}; onAuthorization: "allow" lets it through unchecked.`, o);
  }
  const build = typeof input === "function" ? input : () => input;
  try {
    // fail closed: an authorization Toll could not read is not signed
    await enforce(kind, build, { ...o, onUnavailable: "block", onUnsupported: "block" });
  } catch (e) {
    if (!(e instanceof TollUnavailableError)) throw e;
    return refuse(kind, null, "eip7702-authorization", `${what} Toll could not read it (${e.message}), so it is not signed; onAuthorization: "allow" lets it through unchecked.`, o);
  }
  return true;
}

/**
 * A batch (EIP-5792 sendCalls, wallet_sendCalls, a smart account's calls): each call is checked as its own transaction
 * from the batch's sender, in order; the first one blocked stops the batch. Reports carry kind "calls".
 */
export async function enforceCalls(build: () => CheckInput[] | Promise<CheckInput[]>, o: GuardOptions = {}): Promise<GuardReport[]> {
  let calls: CheckInput[];
  try {
    calls = await build();
  } catch (e) {
    const err = e instanceof TollUnavailableError ? e : new TollUnavailableError(`The batch could not be read for Toll's check: ${(e as Error)?.message ?? e}`, { reason: "encode", cause: e });
    return [await unavailable("calls", null, err, o)];
  }
  if (!calls.length) return [await enforce("calls", () => ({}), o)];
  const out: GuardReport[] = [];
  try {
    for (const c of calls) out.push(await enforce("calls", () => c, o));
  } catch (e) {
    // the batch is not sent: the calls already passed give their day reservations back
    await releaseSpend(out, o);
    throw e;
  }
  return out;
}


/* ------------------------------------------------------------------ spend mode */

const lc = (x: unknown) => String(x ?? "").toLowerCase();
const fmt = (a: string) => (a === "native" ? "native ETH" : a);
const stores = new WeakMap<SpendPolicy, SpendStore>();

/** the store for these options: the one given, else one in-process store per SpendPolicy object */
export function storeOf(o: GuardOptions): SpendStore {
  if (o.store) return o.store;
  const sp = o.spend ?? {};
  let s = stores.get(sp);
  if (!s) {
    s = new MemorySpendStore();
    stores.set(sp, s);
  }
  return s;
}

const lower = <T>(r: Record<string, T> | undefined): Record<string, T> => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [lc(k), v]));

function assetsOf(sp: SpendPolicy): string[] {
  return [...new Set([...DEFAULT_SPEND_ASSETS, ...Object.keys(sp.assets ?? {}), ...Object.keys(sp.approveAbove ?? {})].map(lc))];
}

/** the first counterparty off an allowlist, or null */
function offList(sp: SpendPolicy, s: Spend): string | null {
  const check = (list: string[] | undefined, got: string[], what: string) => {
    if (!list) return null;
    const ok = new Set(list.map(lc));
    const bad = got.find((x) => !ok.has(x));
    return bad ? `${what} ${bad} is not on the allowlist` : null;
  };
  return check(sp.allow?.to, s.to, "recipient") ?? check(sp.allow?.spender, s.spender, "spender") ?? check(sp.allow?.payTo, s.payTo, "x402 payee");
}

/* previews: Toll's answer kept 30 s for one confirmed send of the identical request */
const CONFIRM_TTL_MS = 30_000;
const confirmed = new Map<string, { body: string; assessment: RiskAssessment; until: number }>();
let confirmSeq = 0;

function rememberConfirm(input: CheckInput, assessment: RiskAssessment): string {
  const t = Date.now();
  for (const [k, v] of confirmed) if (v.until <= t) confirmed.delete(k);
  const id = `c${t.toString(36)}${(++confirmSeq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  confirmed.set(id, { body: toJson(bodyOf(input)), assessment, until: t + CONFIRM_TTL_MS });
  return id;
}

function takeConfirmed(o: GuardOptions, input: CheckInput): RiskAssessment | null {
  const id = (o as InternalOptions)._confirm;
  if (!id) return null;
  const c = confirmed.get(id);
  if (!c || c.until <= Date.now() || c.body !== toJson(bodyOf(input))) return null;
  confirmed.delete(id); // once
  return c.assessment;
}

/** the reservations of these reports, committed: the request was sent */
export async function commitSpend(reports: GuardReport | GuardReport[], o: GuardOptions): Promise<void> {
  if (!o.spend) return;
  const store = storeOf(o);
  for (const r of ([] as GuardReport[]).concat(reports)) for (const id of r.spend?.reservations ?? []) await store.commit(id);
}

/** the reservations of these reports, released: the request was refused or the send threw */
export async function releaseSpend(reports: GuardReport | GuardReport[], o: GuardOptions): Promise<void> {
  if (!o.spend) return;
  const store = storeOf(o);
  for (const r of ([] as GuardReport[]).concat(reports)) for (const id of r.spend?.reservations ?? []) await store.release(id);
}

/** the per-endpoint caps whose prefix the URL starts with */
function endpointCaps(sp: SpendPolicy, url: string | undefined): Array<[string, Caps]> {
  if (!url || !sp.perEndpoint) return [];
  let u: string;
  try {
    const x = new URL(url);
    u = x.origin + x.pathname;
  } catch {
    u = url;
  }
  return Object.entries(sp.perEndpoint).filter(([p]) => u.toLowerCase().startsWith(p.toLowerCase()));
}

/**
 * Spend mode: allowlists -> Toll's verdict (the 0.3.x policy, unchanged) -> caps -> approval. Resolves with the report
 * holding its day reservations (commitSpend after the send, releaseSpend when it throws); throws TollPolicyError for a
 * spend rule, TollBlockedError / TollUnavailableError as before.
 */
async function enforceSpend(kind: GuardKind, build: () => CheckInput | Promise<CheckInput>, o: GuardOptions): Promise<GuardReport> {
  const io = o as InternalOptions;
  const sp = o.spend!;
  const store = storeOf(o);
  const assets = assetsOf(sp);
  const preview = io._preview === true;

  let input: CheckInput | null = null;
  let buildErr: unknown = null;
  try {
    input = await build();
  } catch (e) {
    buildErr = e;
  }

  const blockWith = async (base: GuardReport, code: PolicyCode, message: string, s: Spend | null, x: { asset?: string; amount?: bigint; limit?: bigint } = {}): Promise<never> => {
    const r: GuardReport = { ...base, decision: "blocked", basis: "policy", policy: code, ...(s ? { spend: { spend: s, reservations: [] } } : {}) };
    if (!preview) await report(o, r);
    throw new TollPolicyError(code, message, { ...x, assessment: base.assessment, report: r });
  };

  // 1. allowlists, from the local read, before Toll is asked
  if (input) {
    const local = spendOf(input, null, assets);
    const why = offList(sp, local);
    if (why) return blockWith({ kind, input, assessment: null, decision: "blocked", basis: "policy", paidUrl: null }, "not-allowlisted", `Not signed: ${why}.`, local);
  }

  // 2. Toll's verdict (the 0.3.x policy), reported once at the end
  let verdict: GuardReport | null = null;
  const vo: GuardOptions = { ...o, onReport: (r) => void (verdict = r) };
  let base: GuardReport;
  try {
    base = await enforceVerdict(kind, buildErr ? () => Promise.reject(buildErr) : () => input as CheckInput, vo);
  } catch (e) {
    if (verdict && !preview) await report(o, verdict);
    if (preview && verdict && e instanceof Error) (e as Error & { report?: GuardReport }).report = verdict;
    throw e;
  }

  // 3. what it spends, now with Toll's simulation when there is one
  const s: Spend = input ? spendOf(input, base.assessment, assets) : { items: [], outflow: {}, approvals: {}, to: [], spender: [], payTo: [], unknown: true, simulated: false };
  const why = offList(sp, s);
  if (why) return blockWith(base, "not-allowlisted", `Not signed: ${why}.`, s);
  if (s.unknown && (sp.onUnknownSpend ?? (o.failClosed ? "block" : "allow")) === "block") {
    return blockWith(base, "unknown-spend", 'Not signed: what this request spends could not be read (no simulation), and onUnknownSpend is "block".', s);
  }

  const caps = lower(sp.assets);
  const touched = [...new Set([...Object.keys(s.outflow), ...Object.keys(s.approvals)])];
  const amountOf = (a: string) => {
    const out = s.outflow[a] ?? 0n;
    const ap = s.approvals[a] ?? 0n;
    return out > ap ? out : ap;
  };
  // 4. per-call caps
  for (const a of touched) {
    const c = caps[a]?.perCall;
    const amt = amountOf(a);
    if (c !== undefined && amt > c) return blockWith(base, "cap-per-call", `Not signed: ${amt} of ${fmt(a)} is over the per-call cap of ${c}.`, s, { asset: a, amount: amt, limit: c });
  }
  const x402url = typeof input?.x402?.url === "string" ? input.x402.url : typeof input?.x402?.resource === "string" ? input.x402.resource : undefined;
  const eps = input?.x402 ? endpointCaps(sp, io._endpoint ?? x402url) : [];
  const epAmount = Object.values(s.outflow).reduce((m, v) => (v > m ? v : m), 0n);
  for (const [p, c] of eps) {
    if (c.perCall !== undefined && epAmount > c.perCall) return blockWith(base, "cap-endpoint", `Not paid: ${epAmount} is over the per-call cap of ${c.perCall} for ${p}.`, s, { amount: epAmount, limit: c.perCall });
  }

  // 5. day caps: outflows are reserved; an allowance must fit in what is left today (checked, not reserved)
  const held: string[] = [];
  const day = dayStart(Date.now());
  const giveBack = async () => {
    for (const id of held) await store.release(id);
    held.length = 0;
  };
  const reserve = async (key: string, amt: bigint, limit: bigint, keep: boolean, code: PolicyCode, msg: string, asset?: string) => {
    const r = await store.reserve(key, amt, limit, day);
    if (!r.ok) {
      await giveBack();
      await blockWith(base, code, `${msg} (${r.used} of ${limit} used today).`, s, { asset, amount: amt, limit });
    }
    if (keep && !preview) held.push(r.id);
    else await store.release(r.id);
  };
  for (const a of touched) {
    const c = caps[a]?.perDay;
    if (c === undefined) continue;
    const out = s.outflow[a] ?? 0n;
    if (out > 0n) await reserve(`day:${a}`, out, c, true, "cap-per-day", `Not signed: ${out} more of ${fmt(a)} is over the day cap of ${c}`, a);
    const ap = s.approvals[a] ?? 0n;
    if (ap > 0n) await reserve(`day:${a}`, ap, c, false, "cap-per-day", `Not signed: an allowance of ${ap} ${fmt(a)} is over what is left of the day cap of ${c}`, a);
  }
  for (const [p, c] of eps) {
    if (c.perDay !== undefined && epAmount > 0n) await reserve(`endpoint:${p}`, epAmount, c.perDay, true, "cap-endpoint", `Not paid: ${epAmount} more is over the day cap of ${c.perDay} for ${p}`);
  }

  // 6. human approval above a threshold
  const above = lower(sp.approveAbove);
  const over = touched.filter((a) => above[a] !== undefined && amountOf(a) > above[a]).map((a) => ({ asset: a, amount: amountOf(a), threshold: above[a] }));
  let approvalRef: string | undefined;
  let needsApproval = false;
  if (over.length && preview) needsApproval = true;
  else if (over.length) {
    let ok = false;
    try {
      const res = sp.approve ? await sp.approve({ kind, input, assessment: base.assessment, spend: s, over }) : { approved: false };
      ok = res?.approved === true;
      approvalRef = res?.approvalRef;
    } catch (e) {
      say(o, `approve threw: ${(e as Error)?.message ?? e}`);
    }
    if (!ok) {
      await giveBack();
      const top = over[0];
      return blockWith(base, "approval-denied", `Not signed: ${top.amount} of ${fmt(top.asset)} is over ${top.threshold} and was not approved${sp.approve ? "" : " (no approve function)"}.`, s, { asset: top.asset, amount: top.amount, limit: top.threshold });
    }
  }

  const r: GuardReport = { ...base, spend: { spend: s, reservations: [...held], ...(approvalRef !== undefined ? { approvalRef } : {}), ...(needsApproval ? { needsApproval } : {}) } };
  if (!preview) {
    await report(o, r);
    io._collect?.push(r);
  }
  return r;
}

/** a request the spend policy refuses outside enforce (a repeated x402 payment id): reported, then TollPolicyError */
export async function policyRefuse(kind: GuardKind, input: CheckInput | null, code: PolicyCode, message: string, o: GuardOptions): Promise<never> {
  const r: GuardReport = { kind, input, assessment: null, decision: "blocked", basis: "policy", policy: code, paidUrl: null };
  await report(o, r);
  throw new TollPolicyError(code, message, { report: r });
}

/* ------------------------------------------------------------------ preview */

export interface GuardDecision {
  decision: "allowed" | "blocked";
  basis: GuardReport["basis"];
  /** Toll's answer (null when Toll was not asked or could not answer) */
  assessment: RiskAssessment | null;
  /** the spend rule that would block it */
  policy?: PolicyCode;
  /** what it would spend (with `spend` set) */
  spend?: Spend;
  /** over an approveAbove threshold: the send will ask `approve` */
  needsApproval?: boolean;
  /** why it would be blocked */
  reason?: string;
  paidUrl: string | null;
}

const kindOf = (i: CheckInput): GuardKind =>
  i.x402 ? "x402" : i.userOp ? "userOp" : i.typedData || i.rpc?.method === "eth_signTypedData_v4" ? "typedData" : i.message || i.rpc ? "message" : "transaction";

/**
 * What the guard would do with this request, without doing it: Toll is asked and every spend rule is checked, but
 * nothing is reserved, `approve` is not called and onReport is not called. When allowed, `confirmId` passed as
 * `tollConfirm` on the send within 30 s skips the second Toll call (once, and only for the identical request).
 */
export async function preview(input: CheckInput, opts: GuardOptions & { kind?: GuardKind } = {}): Promise<GuardDecision & { confirmId: string }> {
  const { kind: k, ...rest } = opts;
  const kind = k ?? kindOf(input);
  const io: InternalOptions = { ...rest, onReport: undefined, _preview: true };
  try {
    const r = await enforce(kind, () => input, io);
    return {
      decision: "allowed",
      basis: r.basis,
      assessment: r.assessment,
      ...(r.spend ? { spend: r.spend.spend } : {}),
      ...(r.spend?.needsApproval ? { needsApproval: true } : {}),
      paidUrl: r.paidUrl,
      confirmId: r.assessment ? rememberConfirm(input, r.assessment) : "",
    };
  } catch (e) {
    const rep = (e as { report?: GuardReport }).report;
    if (e instanceof TollPolicyError) {
      return { decision: "blocked", basis: "policy", policy: e.code, assessment: rep?.assessment ?? null, ...(rep?.spend ? { spend: rep.spend.spend } : {}), reason: e.message, paidUrl: rep?.paidUrl ?? null, confirmId: "" };
    }
    if (e instanceof TollBlockedError) {
      return { decision: "blocked", basis: e.assessment.action, assessment: e.assessment, reason: e.message, paidUrl: paidUrlOf(e.assessment), confirmId: "" };
    }
    if (e instanceof TollUnavailableError) {
      return { decision: "blocked", basis: e.reason === "unsupported" ? "unsupported" : "unavailable", assessment: null, reason: e.message, paidUrl: e.paidUrl, confirmId: "" };
    }
    throw e;
  }
}
