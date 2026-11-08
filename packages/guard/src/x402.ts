/**
 * x402: check what a 402 asks for BEFORE the client pays. Wrap the fetch your x402 client uses; on a 402 the
 * requirement goes to Toll (payee against the seller's registered ERC-8004 agentWallet, extra.erc8004, the seller's
 * record), and on BLOCK the 402 never reaches the payer: TollBlockedError is thrown instead.
 *
 *   const pay = wrapFetchWithPayment(guardX402Fetch(fetch), account);   // x402-fetch, or any x402 client
 */
import type { CheckInput, FetchLike } from "./check.js";
import { commitSpend, enforce, policyRefuse, refuse, releaseSpend, storeOf, type GuardOptions, type GuardReport, type InternalOptions } from "./policy.js";

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
/** the payment header's value on the request (init headers first, then a Request's own), or null */
const paymentHeader = (input: unknown, init: { headers?: unknown } | undefined): string | null => {
  const read = (h: unknown): string | null => {
    if (!h) return null;
    try {
      const hs = new Headers(h as HeadersInit);
      for (const n of PAY_HEADERS) if (hs.has(n)) return hs.get(n) ?? "";
    } catch {
      /* unreadable headers */
    }
    return null;
  };
  return read(init?.headers) ?? (typeof Request !== "undefined" && input instanceof Request ? read(input.headers) : null);
};
const hasPayment = (input: unknown, init: { headers?: unknown } | undefined): boolean => paymentHeader(input, init) !== null;

/**
 * The x402 payment-identifier extension's id in a signed payment header (base64 JSON PaymentPayload):
 * extensions["payment-identifier"].info.id (or .id); null when there is none.
 */
export function paymentIdOf(header: string | null): string | null {
  if (!header) return null;
  try {
    const p = decodeBase64Json(header) as Record<string, any>;
    const ext = p?.extensions?.["payment-identifier"] ?? p?.payload?.extensions?.["payment-identifier"];
    const id = ext?.info?.id ?? ext?.id ?? p?.paymentId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** the request URL without its query: the key a 402's hold waits under for its paid retry */
const holdKey = (url: string): string => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
};

export interface X402GuardOptions extends GuardOptions {
  /** called with each 402's report (also passed to onReport) */
  on402?: (report: GuardReport, url: string) => void;
  /**
   * With `spend`: how long a checked 402's cap reservation waits for its paid retry before it is given back
   * (default 120000 ms). The paid retry commits it on a non-402 answer and releases it on a 402 or an error.
   */
  holdMs?: number;
  /** With `spend`: how long a paid payment-identifier is remembered (default 86400 s) */
  paymentIdTtlS?: number;
}

/**
 * Wraps a fetch so every 402 is checked by Toll before an x402 client pays it. A 402 to a request that already
 * carries a payment header passes through (it was checked before it was signed). Non-402 answers pass untouched.
 */
export function guardX402Fetch<F extends AnyFetch>(fetchLike: F, opts: X402GuardOptions = {}): F {
  const toll: GuardOptions = { ...opts, fetch: opts.fetch ?? ((globalThis.fetch as FetchLike | undefined)?.bind(globalThis) as FetchLike | undefined) };
  // spend mode: each checked 402's reservations wait here (oldest first per URL) for the paid retry
  const holds = new Map<string, Array<{ reports: GuardReport[]; timer: ReturnType<typeof setTimeout> }>>();
  const takeHold = (key: string) => {
    const q = holds.get(key);
    const h = q?.shift();
    if (q && !q.length) holds.delete(key);
    if (h) clearTimeout(h.timer);
    return h ?? null;
  };
  // payment ids being sent right now, and the hold each id keeps across a retry after a network error
  const inFlight = new Set<string>();
  const idHolds = new Map<string, { reports: GuardReport[]; timer: ReturnType<typeof setTimeout> }>();
  const keepForRetry = (id: string, reports: GuardReport[]) => {
    const timer = setTimeout(() => {
      if (idHolds.get(id)?.reports === reports) {
        idHolds.delete(id);
        void releaseSpend(reports, toll);
      }
    }, opts.holdMs ?? 120_000);
    (timer as { unref?: () => void }).unref?.();
    idHolds.set(id, { reports, timer });
  };
  /**
   * A paid request. With an x402 payment-identifier: an id the seller already accepted (non-402 answer) is refused,
   * and so is a second send of an id still in flight; after a network error the same id may be sent again (the
   * seller dedupes it) and it reuses the cap reservation of its 402, so nothing is counted twice.
   */
  const paidRetry = async (input: unknown, init: { headers?: unknown } | undefined, header: string | null) => {
    const url = urlOf(input);
    const id = paymentIdOf(header);
    const store = storeOf(toll);
    if (id !== null) {
      if (await store.paymentSeen(id)) {
        await policyRefuse("x402", { x402: { url } }, "duplicate-payment", `Not paid: payment-identifier ${id} was already paid; the guard never pays it twice.`, toll);
      }
      // checked after the await, right before the mark: no other send of this id can slip in between
      if (inFlight.has(id)) {
        await policyRefuse("x402", { x402: { url } }, "duplicate-payment", `Not paid: payment-identifier ${id} is being sent right now; the guard never sends it twice at once.`, toll);
      }
      inFlight.add(id);
    }
    let hold: { reports: GuardReport[] } | null = null;
    if (id !== null && idHolds.has(id)) {
      const h = idHolds.get(id)!;
      clearTimeout(h.timer);
      idHolds.delete(id);
      hold = h;
    } else hold = takeHold(holdKey(url));
    let res: Response;
    try {
      res = await fetchLike(input, init);
    } catch (e) {
      if (id !== null) {
        // no answer: the seller may not have it; the same id may be retried and keeps this reservation
        inFlight.delete(id);
        if (hold) keepForRetry(id, hold.reports);
      } else if (hold) await releaseSpend(hold.reports, toll);
      throw e;
    }
    try {
      if (res.status === 402) {
        if (hold) await releaseSpend(hold.reports, toll);
      } else {
        if (hold) await commitSpend(hold.reports, toll);
        if (id !== null) await store.markPaid(id, opts.paymentIdTtlS ?? 86_400);
      }
    } finally {
      if (id !== null) inFlight.delete(id);
    }
    return res;
  };
  const wrapped = async (input: unknown, init?: { headers?: unknown }) => {
    if (toll.spend) {
      const header = paymentHeader(input, init);
      if (header !== null) return paidRetry(input, init, header);
    }
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
    const col: GuardReport[] = [];
    const eo: InternalOptions = toll.spend ? { ...toll, _collect: col, _endpoint: url } : toll;
    const r = await enforce("x402", () => {
      if (!pr) return {} as CheckInput; // nothing readable: the unsupported policy decides
      const x402 = pr.resource || pr.url ? pr : { ...pr, url };
      const id = typeof opts.agentId === "function" ? opts.agentId(url) : opts.agentId;
      return { x402, ...(id !== undefined && id !== null ? { agentId: id } : {}) };
    }, eo);
    if (col.some((c) => c.spend?.reservations.length)) {
      const key = holdKey(url);
      const entry = { reports: col, timer: setTimeout(() => {
        const q = holds.get(key);
        const i = q ? q.indexOf(entry) : -1;
        if (q && i >= 0) {
          q.splice(i, 1);
          if (!q.length) holds.delete(key);
          void releaseSpend(col, toll);
        }
      }, opts.holdMs ?? 120_000) };
      (entry.timer as { unref?: () => void }).unref?.();
      const q = holds.get(key) ?? [];
      q.push(entry);
      holds.set(key, q);
    }
    opts.on402?.(r, url);
    return res;
  };
  return wrapped as unknown as F;
}
