import {
  TX_CHAIN_ID,
  TollBlockedError,
  TollUnavailableError,
  checkTx,
  chainIdOf,
  paidUrlOf,
  type CheckInput,
  type CheckOptions,
  type RiskAssessment,
} from "./check.js";

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
  /** why: Toll's action, "unavailable" (Toll could not answer) or "unsupported" (not a request Toll reads) */
  basis: "ALLOW" | "WARN" | "BLOCK" | "unavailable" | "unsupported";
  /** the paid route (no daily limit) when this caller's free checks are used */
  paidUrl: string | null;
  error?: TollUnavailableError;
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
    a = await checkTx(input, o);
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
    const r: GuardReport = { kind, input, assessment: a, decision, basis, paidUrl };
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
  for (const c of calls) out.push(await enforce("calls", () => c, o));
  return out;
}
