/**
 * x402: check what a 402 asks for BEFORE the client pays. Wrap the fetch your x402 client uses; on a 402 the
 * requirement goes to Toll (payee against the seller's registered ERC-8004 agentWallet, extra.erc8004, the seller's
 * record), and on BLOCK the 402 never reaches the payer: TollBlockedError is thrown instead.
 *
 *   const pay = wrapFetchWithPayment(guardX402Fetch(fetch), account);   // x402-fetch, or any x402 client
 */
import type { CheckInput, FetchLike } from "./check.js";
import { enforce, type GuardOptions, type GuardReport } from "./policy.js";

type AnyFetch = (input: any, init?: any) => Promise<Response>;

function decodeBase64Json(value: string): unknown {
  const bin = atob(value.trim());
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/** the 402's PaymentRequired: v2 from the PAYMENT-REQUIRED header, else v1 from the JSON body; null when neither */
export async function readPaymentRequired(res: Response): Promise<Record<string, unknown> | null> {
  const h = res.headers.get("payment-required");
  if (h) {
    try {
      const pr = decodeBase64Json(h) as Record<string, unknown>;
      if (pr && Array.isArray(pr.accepts) && pr.accepts.length) return pr;
    } catch {
      /* fall back to the body */
    }
  }
  try {
    const body = JSON.parse(await res.clone().text()) as Record<string, unknown>;
    if (body && Array.isArray(body.accepts) && body.accepts.length) return body;
  } catch {
    /* not JSON */
  }
  return null;
}

const urlOf = (input: unknown): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const u = (input as { url?: unknown } | null)?.url;
  return typeof u === "string" ? u : String(input);
};

const PAY_HEADERS = ["payment-signature", "x-payment"];
const hasPayment = (input: unknown, init: { headers?: unknown } | undefined): boolean => {
  const read = (h: unknown) => {
    if (!h) return false;
    try {
      const hs = new Headers(h as HeadersInit);
      return PAY_HEADERS.some((n) => hs.has(n));
    } catch {
      return false;
    }
  };
  return read(init?.headers) || (typeof Request !== "undefined" && input instanceof Request && read(input.headers));
};

export interface X402GuardOptions extends GuardOptions {
  /** called with each 402's report (also passed to onReport) */
  on402?: (report: GuardReport, url: string) => void;
}

/**
 * Wraps a fetch so every 402 is checked by Toll before an x402 client pays it. A 402 to a request that already
 * carries a payment header passes through (it was checked before it was signed). Non-402 answers pass untouched.
 */
export function guardX402Fetch<F extends AnyFetch>(fetchLike: F, opts: X402GuardOptions = {}): F {
  const toll: GuardOptions = { ...opts, fetch: opts.fetch ?? ((globalThis.fetch as FetchLike | undefined)?.bind(globalThis) as FetchLike | undefined) };
  const wrapped = async (input: unknown, init?: { headers?: unknown }) => {
    const res = await fetchLike(input, init);
    if (res.status !== 402 || hasPayment(input, init)) return res;
    const url = urlOf(input);
    const pr = await readPaymentRequired(res);
    const r = await enforce("x402", () => {
      if (!pr) return {} as CheckInput; // nothing readable: the unsupported policy decides
      const x402 = pr.resource || pr.url ? pr : { ...pr, url };
      const id = typeof opts.agentId === "function" ? opts.agentId(url) : opts.agentId;
      return { x402, ...(id !== undefined && id !== null ? { agentId: id } : {}) };
    }, toll);
    opts.on402?.(r, url);
    return res;
  };
  return wrapped as unknown as F;
}
