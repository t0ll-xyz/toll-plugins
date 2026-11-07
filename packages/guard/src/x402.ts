/**
 * x402: check what a 402 asks for BEFORE the client pays. Wrap the fetch your x402 client uses; on a 402 the
 * requirement goes to Toll (payee against the seller's registered ERC-8004 agentWallet, extra.erc8004, the seller's
 * record), and on BLOCK the 402 never reaches the payer: TollBlockedError is thrown instead.
 *
 *   const pay = wrapFetchWithPayment(guardX402Fetch(fetch), account);   // x402-fetch, or any x402 client
 */
import type { CheckInput, FetchLike } from "./check.js";
import { enforce, refuse, type GuardOptions, type GuardReport } from "./policy.js";

type AnyFetch = (input: any, init?: any) => Promise<Response>;

function decodeBase64Json(value: string): unknown {
  const bin = atob(value.trim());
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

type PR = Record<string, unknown>;
const withAccepts = (x: unknown): PR | null =>
  x && typeof x === "object" && Array.isArray((x as PR).accepts) && ((x as PR).accepts as unknown[]).length ? (x as PR) : null;

/**
 * Both places a 402 can carry its PaymentRequired: the PAYMENT-REQUIRED header (v2) and the JSON body (v1, and v2
 * servers that also put it there). A client pays from the one it reads (x402-fetch v1 reads the body), so the guard
 * reads both.
 */
export async function readPaymentForms(res: Response): Promise<{ header: PR | null; body: PR | null }> {
  let header: PR | null = null;
  let body: PR | null = null;
  const h = res.headers.get("payment-required");
  if (h) {
    try {
      header = withAccepts(decodeBase64Json(h));
    } catch {
      /* not base64 JSON */
    }
  }
  try {
    body = withAccepts(JSON.parse(await res.clone().text()));
  } catch {
    /* not JSON */
  }
  return { header, body };
}

/** the 402's PaymentRequired: v2 from the PAYMENT-REQUIRED header, else v1 from the JSON body; null when neither */
export async function readPaymentRequired(res: Response): Promise<PR | null> {
  const { header, body } = await readPaymentForms(res);
  return header ?? body;
}

/** what a client would pay under each accepts entry: scheme, asset, amount (v2 amount or v1 maxAmountRequired), payee */
function terms(pr: PR): string[] {
  const low = (v: unknown) => String(v ?? "").trim().toLowerCase();
  return (pr.accepts as unknown[])
    .map((a) => {
      const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      return [low(x.scheme), low(x.asset), low(x.amount ?? x.maxAmountRequired), low(x.payTo)].join("|");
    })
    .sort();
}

/** true when the header and the body would pay differently (a payee, amount, asset or scheme in one and not the other) */
export function paymentFormsDiffer(header: PR, body: PR): boolean {
  const a = terms(header);
  const b = terms(body);
  return a.length !== b.length || a.some((t, i) => t !== b[i]);
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
    const forms = await readPaymentForms(res);
    // A harmless header and another payTo or amount in the body: the guard cannot know which one the client pays
    // (x402-fetch v1 pays the body), so it refuses the 402.
    if (forms.header && forms.body && paymentFormsDiffer(forms.header, forms.body)) {
      await refuse("x402", { x402: { ...forms.header, url } }, "x402-forms-differ", "The 402's PAYMENT-REQUIRED header and its JSON body ask for different payments (payee, amount, asset or scheme). A client pays from the one it reads, so it was not paid.", toll);
    }
    const pr = forms.header ?? forms.body;
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
