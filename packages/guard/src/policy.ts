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

export type WarnPolicy = "allow" | "block" | ((assessment: RiskAssessment) => boolean | Promise<boolean>);
export type BlockPolicy = "throw" | ((assessment: RiskAssessment) => boolean | Promise<boolean>);

export type GuardKind = "transaction" | "typedData" | "x402";

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
  /** WARN: "allow" (default, reported and logged), "block", or a function; true lets it through */
  onWarn?: WarnPolicy;
  /** BLOCK: "throw" (default, TollBlockedError), or a function (e.g. ask a human); true lets it through */
  onBlock?: BlockPolicy;
  /**
   * Toll unreachable, timed out, 5xx, 429, or a request it could not read: "allow" (default, fail-open, logged) or
   * "block" (fail-closed, throws TollUnavailableError).
   */
  onUnavailable?: "allow" | "block";
  /** a request Toll does not read (another chain, a contract deploy): "allow" (default) or "block" */
  onUnsupported?: "allow" | "block";
  /** every decision, with Toll's answer; errors thrown here are caught and logged */
  onReport?: (report: GuardReport) => void | Promise<void>;
  /** where WARN / unavailable lines go (default console.warn); false = silent */
  logger?: ((message: string) => void) | false;
  /** the seller's ERC-8004 agent id for x402 payments (or a function of the URL) */
  agentId?: number | string | ((url: string) => number | string | undefined | null);
}

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

/** why Toll would not read this request, or null when it does */
export function unsupportedWhy(input: CheckInput): string | null {
  const tx = input.to !== undefined || input.data !== undefined;
  if (tx) {
    if (input.to === undefined || input.to === null) return "a contract deployment (no `to`) is not read";
    const cid = input.chainId === undefined ? null : chainIdOf(input.chainId);
    if (input.chainId !== undefined && cid === null) return "the chain id could not be read";
    if (cid !== null && cid !== TX_CHAIN_ID) return `chain ${cid} is not read (Robinhood Chain ${TX_CHAIN_ID} only for now)`;
  }
  if (input.typedData && !input.x402) {
    const c = input.typedData.domain?.chainId;
    const cid = c === undefined || c === null ? null : chainIdOf(c);
    if (cid !== null && cid !== TX_CHAIN_ID) return `a signature for chain ${cid} is not read (Robinhood Chain ${TX_CHAIN_ID} only for now)`;
  }
  if (!tx && !input.typedData && !input.x402) return "nothing to check";
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
  if (why) {
    const blocked = o.onUnsupported === "block";
    const r: GuardReport = { kind, input, assessment: null, decision: blocked ? "blocked" : "allowed", basis: "unsupported", paidUrl: null };
    await report(o, r);
    if (blocked) throw new TollUnavailableError(`Not checked by Toll: ${why}. onUnsupported is "block".`, { reason: "unsupported" });
    return r;
  }
  let a: RiskAssessment;
  try {
    a = await checkTx(input, o);
  } catch (e) {
    const err = e instanceof TollUnavailableError ? e : new TollUnavailableError(`Toll's check failed: ${(e as Error)?.message ?? e}`, { reason: "network", cause: e });
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
  const p = o.onWarn ?? "allow";
  const ok = p === "allow" ? true : p === "block" ? false : (await p(a)) === true;
  if (ok) {
    say(o, `WARN (${kind}), going ahead: ${a.warnings.map((w) => `${w.code}: ${w.message}`).join(" | ")}${paidUrl ? ` Paid, no daily limit: ${paidUrl}` : ""}`);
    return done("allowed", "WARN");
  }
  await done("blocked", "WARN");
  throw new TollBlockedError(a, "WARN");
}

async function unavailable(kind: GuardKind, input: CheckInput | null, err: TollUnavailableError, o: GuardOptions): Promise<GuardReport> {
  const blocked = o.onUnavailable === "block";
  const r: GuardReport = { kind, input, assessment: null, decision: blocked ? "blocked" : "allowed", basis: "unavailable", paidUrl: err.paidUrl, error: err };
  await report(o, r);
  if (blocked) throw err;
  say(o, `Toll unavailable, NOT checked, going ahead (onUnavailable "allow"): ${err.message}`);
  return r;
}
