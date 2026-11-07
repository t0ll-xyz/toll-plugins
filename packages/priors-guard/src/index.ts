/**
 * @tollxyz/priors-guard: Toll's free pre-sign check as a Priors payer's `beforePay`, in one line.
 *
 *   import { createPayer } from "@priors/x402";
 *   import { tollCheck } from "@tollxyz/priors-guard";
 *   const payer = createPayer({ signer, agentId, pool, maxBorrow, beforePay: tollCheck() });
 *
 * Toll (t0ll.xyz, ERC-8004 agent #20030 on Robinhood Chain) answers POST https://t0ll.xyz/api/tx/check with an
 * ERC-8265 RiskAssessment: ALLOW / WARN / BLOCK and reason codes. For an x402 payment it reads the seller's ERC-8004
 * identity and checks payTo against its registered agentWallet or a payee delegation (the ERC-8478 draft), the asset
 * and the amount. A payTo that is not the seller's is BLOCK (x402-payee-mismatch). A seller Toll cannot identify is
 * WARN (x402-seller-unknown), and WARN pays by default: refuse: ["BLOCK", "WARN"] for an agent that pays only sellers
 * whose payee Toll could verify.
 *
 * What is sent: the 402's requirement and the resource's origin and path (never its query string or fragment), and
 * agentId when given. Nothing else, and nothing is signed.
 *
 * In beforePay, so before anything is read, topped up, borrowed or signed:
 *   - an action in `refuse`: PayError TOLL_REFUSED { action, codes, link }; the message holds fixed words and Toll's
 *     warning codes (checked against a code pattern) only, never text from an answer, and the link is a field only;
 *   - no answer it can use (timeout, the caller's abort, HTTP error, a body too large or not JSON, no action):
 *     PayError TOLL_UNREAD with fixed words, which refuses the payment (fails closed), or `failOpen: true` to pay
 *     without it. The timeout and the abort cover the whole answer, body included, and the body is capped.
 */
import { PayError } from "@priors/x402";

export const TOLL_CHECK_URL = "https://t0ll.xyz/api/tx/check";
export const TOLL_TIMEOUT_MS = 8_000;
/** the most of an answer that is read (a RiskAssessment is a few KB) */
export const TOLL_MAX_BODY_BYTES = 64 * 1024;

type Action = "ALLOW" | "WARN" | "BLOCK";
const ACTIONS = new Set<string>(["ALLOW", "WARN", "BLOCK"]);
const CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LINK = /^https:\/\/t0ll\.xyz\/[A-Za-z0-9._~\-/?=&%#]{0,300}$/;

/** what beforePay is given (@priors/x402 BeforePayInput); only the fields read here */
export interface PaymentToCheck {
  readonly requirement: Readonly<Record<string, unknown>>;
  x402Version: 1 | 2;
  resource: string;
  signal?: AbortSignal;
}

export interface TollResult {
  action: Action;
  /** Toll's warning codes, e.g. "x402-payee-mismatch" */
  codes: string[];
  /** where to read more on t0ll.xyz, or null */
  link: string | null;
}

/** the seller's ERC-8004 agent id: one id, a map from the resource's origin to an id, or a function of the origin */
export type AgentIdOption = number | bigint | string | Record<string, number | bigint | string> | ((origin: string) => number | bigint | string | null | undefined);

export interface TollCheckOptions {
  /** Toll's check endpoint (default https://t0ll.xyz/api/tx/check) */
  url?: string;
  /** BLOCK is always refused; add "WARN" to pay only sellers whose payee Toll could verify */
  refuse?: Array<"BLOCK" | "WARN">;
  /**
   * The seller you mean to pay, per origin. When given, YOURS is the identity Toll checks: a 402 that names another
   * one (extra.erc8004) comes back WARN x402-identity-differs. A map is keyed by origin ("https://api.seller.xyz").
   */
  agentId?: AgentIdOption;
  /** refuse a payment to an origin you named no agentId for (default false: the 402's own extra.erc8004 is used) */
  requireAgent?: boolean;
  /** how long Toll may take, the whole answer included (default 8000 ms) */
  timeoutMs?: number;
  /** pay when Toll cannot be reached: a network error, a timeout, HTTP 429 or 5xx (never a 4xx or a bad body) */
  failOpen?: boolean;
  fetchImpl?: typeof fetch;
  /** called with every answer read, before it is acted on */
  onResult?: (r: TollResult) => void | Promise<void>;
}

/** the URL without its query string, fragment or credentials: what the check needs to know the seller */
export function originAndPath(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "";
  }
}

/** an answer that could not be used; `open` = Toll could not be reached (failOpen may pay), else a payee could cause it */
class Unread extends Error {
  constructor(msg: string, readonly open = false) { super(msg); }
}

/** reads at most `max` bytes of a body as text; past it, Unread("answer too large") */
async function readCapped(r: Response, max: number): Promise<string> {
  if (!r.body) return "";
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      throw new Unread("answer too large");
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** the id as a decimal string, or null; throws BAD_TOLL_OPTION on anything that is not a whole, non-negative number */
function idOf(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = typeof v === "bigint" ? v.toString() : typeof v === "number" ? (Number.isSafeInteger(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  if (!/^(0|[1-9][0-9]{0,77})$/.test(t)) throw new PayError("BAD_TOLL_OPTION", "tollCheck: `agentId` is the seller's ERC-8004 id, a whole number");
  return t;
}

function agentFor(o: AgentIdOption | undefined, origin: string): string | null {
  if (o === undefined || o === null) return null;
  if (typeof o === "function") return idOf(o(origin));
  if (typeof o === "object" && typeof o !== "bigint") return idOf((o as Record<string, unknown>)[origin]);
  return idOf(o);
}

/** the requirement as Toll needs it, and nothing a payee could pad: the payment fields and extra.erc8004 only */
export function trimmed(req: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["scheme", "network", "asset", "amount", "maxAmountRequired", "payTo", "maxTimeoutSeconds"]) {
    const v = req[k];
    if (typeof v === "string" && v.length <= 200) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  const extra = req.extra as { erc8004?: unknown } | undefined;
  if (extra && typeof extra === "object" && extra.erc8004 && typeof extra.erc8004 === "object") {
    const j = JSON.stringify(extra.erc8004);
    if (j.length <= 4096) out.extra = { erc8004: JSON.parse(j) };
  }
  return out;
}

/** A Priors `beforePay` that asks Toll about the payment and refuses what it says to refuse. */
export function tollCheck(o: TollCheckOptions = {}): (payment: PaymentToCheck) => Promise<void> {
  const url = o.url ?? TOLL_CHECK_URL;
  const refuse = new Set<string>(["BLOCK"]);                  // BLOCK always (review 2026-11-07)
  for (const a of o.refuse ?? []) {
    const u = String(a).toUpperCase();
    if (u !== "BLOCK" && u !== "WARN") throw new PayError("BAD_TOLL_OPTION", 'tollCheck: `refuse` takes "BLOCK" and "WARN" only');
    refuse.add(u);
  }
  const timeoutMs = o.timeoutMs ?? TOLL_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new PayError("BAD_TOLL_OPTION", "tollCheck: `timeoutMs` is a positive number of milliseconds");
  const fetchImpl = o.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new PayError("NO_FETCH", "tollCheck: no fetch implementation");
  if (o.agentId !== undefined && typeof o.agentId !== "function" && (typeof o.agentId !== "object" || o.agentId === null)) idOf(o.agentId);
  const secs = `${timeoutMs / 1000} s`;

  return async function tollBeforePay({ requirement, x402Version, resource, signal }: PaymentToCheck): Promise<void> {
    const where = originAndPath(resource);
    let origin = "";
    try { origin = new URL(where).origin; } catch { /* no origin: no per-origin agent */ }
    const agentId = agentFor(o.agentId, origin);
    if (o.requireAgent && agentId === null) {
      throw new PayError("TOLL_NO_AGENT", "pay: no agentId is set for this seller's origin and requireAgent is on; nothing was read, borrowed or signed.", { origin });
    }
    const req = trimmed(requirement);
    const x402 = x402Version === 2 ? { x402Version: 2, resource: { url: where }, accepts: [req] } : { ...req, resource: where };
    const body = JSON.stringify({ x402, ...(agentId !== null ? { agentId } : {}) });
    // A TIMER THAT KEEPS THE PROCESS ALIVE (review: AbortSignal.timeout's timer does not, so a script could exit
    // mid-check), one controller for the request and the body, and the whole read raced against it
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) ctl.abort();
    const stopped = new Promise<never>((_, no) => {
      if (ctl.signal.aborted) no(new Unread(timedOut ? `no answer in ${secs}` : "the payment was aborted", timedOut));
      ctl.signal.addEventListener("abort", () => no(new Unread(timedOut ? `no answer in ${secs}` : "the payment was aborted", timedOut)), { once: true });
    });
    stopped.catch(() => {});
    let a: Record<string, unknown>;
    try {
      const read = (async () => {
        let r: Response;
        try {
          r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body, signal: ctl.signal });
        } catch {
          throw new Unread(timedOut ? `no answer in ${secs}` : signal?.aborted ? "the payment was aborted" : "Toll could not be reached", !signal?.aborted || timedOut);
        }
        if (!r.ok) {
          await r.body?.cancel().catch(() => {});
          throw new Unread(`HTTP ${r.status}`, r.status === 429 || r.status >= 500);
        }
        const text = await readCapped(r, TOLL_MAX_BODY_BYTES);
        let j: unknown;
        try { j = JSON.parse(text); } catch { throw new Unread("not JSON"); }
        if (!j || typeof j !== "object" || !ACTIONS.has((j as { action?: string }).action as string)) throw new Unread("no action in the answer");
        return j as Record<string, unknown>;
      })();
      read.catch(() => {});
      a = await Promise.race([read, stopped]);
    } catch (e) {
      const u = e instanceof Unread ? e : new Unread(timedOut ? `no answer in ${secs}` : "the answer could not be read");
      if (o.failOpen && u.open) return;
      throw new PayError("TOLL_UNREAD", `pay: Toll's check gave no answer to use (${u.message}); nothing was read, borrowed or signed.${u.open ? " failOpen: true pays without it." : ""}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    const warnings = Array.isArray(a.warnings) ? (a.warnings as Array<{ code?: unknown }>) : [];
    const codes = warnings.map((w) => w?.code).filter((c): c is string => typeof c === "string" && CODE.test(c)).slice(0, 10);
    const extra = (a["x-toll"] ?? {}) as { link?: unknown };
    const link = typeof extra.link === "string" && LINK.test(extra.link) ? extra.link : null;
    const action = a.action as Action;
    if (typeof o.onResult === "function") await o.onResult({ action, codes, link });
    if (refuse.has(action)) {
      throw new PayError("TOLL_REFUSED", `pay: Toll's check answered ${action}${codes.length ? ` (${codes.join(", ")})` : ""}; nothing was read, borrowed or signed.`, { action, codes, link });
    }
  };
}

/** a signer that is enough for createPayer to reach its option checks; it never signs anything */
const PROBE_SIGNER = { getAddress: async () => "0x0000000000000000000000000000000000000001", signTypedData: async () => { throw new Error("probe"); } };

/**
 * DOES THIS @priors/x402 RUN beforePay? (review 2026-11-07: on 0.8.8 and older, createPayer ignores the option and
 * every payment goes through unchecked, with no error.) The release with the hook refuses `beforePay: 1` with
 * BAD_BEFORE_PAY; an older one accepts it. Throws PayError TOLL_GUARD_UNSUPPORTED when the hook is not there.
 */
export function requireBeforePay(createPayer: (opts: Record<string, unknown>) => unknown): void {
  try {
    createPayer({ signer: PROBE_SIGNER, beforePay: 1 });
  } catch (e) {
    if ((e as { code?: unknown })?.code === "BAD_BEFORE_PAY") return;
    throw e;
  }
  throw new PayError("TOLL_GUARD_UNSUPPORTED", "this @priors/x402 does not run beforePay, so Toll's check would never be asked: upgrade @priors/x402 to the release with beforePay.");
}

/** createPayer with Toll's check as its beforePay, after requireBeforePay: the one call to use */
export function tollPayer<P>(createPayer: (opts: Record<string, unknown>) => P, payerOpts: Record<string, unknown>, tollOpts: TollCheckOptions = {}): P {
  requireBeforePay(createPayer);
  return createPayer({ ...payerOpts, beforePay: tollCheck(tollOpts) });
}
