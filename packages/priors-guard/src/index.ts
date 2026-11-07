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

export interface TollCheckOptions {
  /** Toll's check endpoint (default https://t0ll.xyz/api/tx/check) */
  url?: string;
  /** actions that refuse the payment (default ["BLOCK"]; ["BLOCK", "WARN"] pays only sellers Toll verified) */
  refuse?: Array<"BLOCK" | "WARN">;
  /** the seller's ERC-8004 agent id, when the 402 does not name it */
  agentId?: number | bigint | string;
  /** how long Toll may take, the whole answer included (default 8000 ms) */
  timeoutMs?: number;
  /** pay when Toll gives no answer it can use (default false: PayError TOLL_UNREAD) */
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

class Unread extends Error {}

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

/** A Priors `beforePay` that asks Toll about the payment and refuses what it says to refuse. */
export function tollCheck(o: TollCheckOptions = {}): (payment: PaymentToCheck) => Promise<void> {
  const url = o.url ?? TOLL_CHECK_URL;
  const refuse = new Set((o.refuse ?? ["BLOCK"]).map((a) => String(a).toUpperCase()));
  for (const a of refuse) {
    if (a !== "BLOCK" && a !== "WARN") throw new PayError("BAD_TOLL_OPTION", 'tollCheck: `refuse` takes "BLOCK" and "WARN" only');
  }
  const timeoutMs = o.timeoutMs ?? TOLL_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new PayError("BAD_TOLL_OPTION", "tollCheck: `timeoutMs` is a positive number of milliseconds");
  const fetchImpl = o.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new PayError("NO_FETCH", "tollCheck: no fetch implementation");
  const agentId = o.agentId === undefined || o.agentId === null ? null : Number(o.agentId);
  if (agentId !== null && (!Number.isSafeInteger(agentId) || agentId < 0)) {
    throw new PayError("BAD_TOLL_OPTION", "tollCheck: `agentId` is the seller's ERC-8004 id, a whole number");
  }
  const secs = `${timeoutMs / 1000} s`;

  return async function tollBeforePay({ requirement, x402Version, resource, signal }: PaymentToCheck): Promise<void> {
    const where = originAndPath(resource);
    const x402 = x402Version === 2 ? { x402Version: 2, resource: { url: where }, accepts: [requirement] } : { ...requirement, resource: where };
    const body = JSON.stringify({ x402, ...(agentId !== null ? { agentId } : {}) });
    const timeout = AbortSignal.timeout(timeoutMs);
    const stop = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let a: Record<string, unknown>;
    try {
      // one signal for the request and the body: the timeout and the caller's abort stop the whole read
      const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body, signal: stop });
      if (!r.ok) {
        await r.body?.cancel().catch(() => {});
        throw new Unread(`HTTP ${r.status}`);
      }
      const text = await Promise.race([
        readCapped(r, TOLL_MAX_BODY_BYTES),
        new Promise<never>((_, no) => {
          if (stop.aborted) no(stop.reason);
          stop.addEventListener("abort", () => no(stop.reason), { once: true });
        }),
      ]);
      try {
        a = JSON.parse(text);
      } catch {
        throw new Unread("not JSON");
      }
      if (!a || typeof a !== "object" || !ACTIONS.has(a.action as string)) throw new Unread("no action in the answer");
    } catch (e) {
      if (o.failOpen) return;
      const why = e instanceof Unread ? e.message : signal?.aborted && !timeout.aborted ? "the payment was aborted" : `no answer in ${secs}`;
      throw new PayError("TOLL_UNREAD", `pay: Toll's check gave no answer to use (${why}); nothing was read, borrowed or signed. failOpen: true pays without it.`);
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
