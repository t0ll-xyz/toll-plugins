/**
 * Toll Markets: Robinhood Stock Tokens on Robinhood Chain, read over t0ll.xyz's HTTP API.
 * Facts with their sources, not advice.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Said in every Markets description, so the model never reads the data as advice or as shares. */
export const MARKETS_NOTE =
  "Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.";

/** The daily limits a Toll key carries (new coins a day, and Markets calls a day), and the x402 prices past them. */
export const LIMITS_NOTE =
  "Holding $TOLL lifts the daily limits: new coins a day Free 10 / 1M $TOLL 100 / 5M 500 / 20M 2,000, and Markets calls a day 50 / 1,000 / 5,000 / 20,000, with a Toll key from https://t0ll.xyz/toll#keys (the tollKey option, sent as x-toll-pass). Past that, x402 per call: 0.05 USDG a check, 0.02 USDG a stock.";

/** A ticker as Robinhood lists it (NVDA, BRK.B, $NVDA) or a Stock Token contract (0x + 40 hex). Same rule as the API. */
export const STOCK_ID = /^(0x[0-9a-fA-F]{40}|\$?[A-Za-z][A-Za-z0-9.\-]{0,11})$/;

export interface MarketsOptions {
  /** Default https://t0ll.xyz */
  baseUrl?: string;
  /** Default: global fetch. */
  fetch?: FetchLike;
  /** A Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass: carries the key wallet's daily Markets tier. */
  tollKey?: string;
  /** Per-request timeout. Default 30000. */
  timeoutMs?: number;
}

/** The x402 URL for one Stock Token (0.02 USDG on Robinhood Chain or USDC on Base). */
export function paidStockUrl(id: string, baseUrl = "https://t0ll.xyz"): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/x402/stock/${encodeURIComponent(id.replace(/^\$/, ""))}`;
}

/** Wraps fetch so every call carries the Toll key as x-toll-pass (no key: fetch unchanged). */
export function withTollKey(f: FetchLike | undefined, tollKey: string | undefined): FetchLike {
  const base: FetchLike = f ?? ((input, init) => globalThis.fetch(input, init));
  const key = tollKey?.trim();
  if (!key) return base;
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-toll-pass", key);
    return base(input, { ...init, headers });
  };
}

async function getJson(url: string, opts: MarketsOptions): Promise<{ status: number; json: any; retryAfter: string | null }> {
  const f = withTollKey(opts.fetch, opts.tollKey);
  const ctl = new AbortController();
  const ms = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await f(url, { method: "GET", headers: { accept: "application/json" }, signal: ctl.signal });
    const raw = await res.text();
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, retryAfter: res.headers.get("retry-after") };
  } catch (e) {
    throw new Error(ctl.signal.aborted ? `request timed out after ${ms} ms` : `request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

function overQuota(json: any, paid: string | null, retryAfter: string | null): string {
  const q = json?.quota;
  if (!q) {
    // The per-minute burst cap, not the daily count.
    const s = Number(retryAfter);
    return `Toll could not answer: too many Markets calls a minute; ask again in ${Number.isFinite(s) && s > 0 ? Math.ceil(s) : 60} seconds.`;
  }
  const used = typeof q.limit === "number" ? `${q.limit.toLocaleString("en-US")} Markets calls used today` : "Markets calls for today are used up";
  const pay = paid
    ? ` This Stock Token over x402: ${paid} (0.02 USDG on Robinhood Chain or USDC on Base; pay only with the owner's consent).`
    : " One Stock Token over x402: https://t0ll.xyz/api/x402/stock/{ticker} (0.02 USDG; pay only with the owner's consent).";
  return `${used} (${q.tier ?? "free"}; resets 00:00 UTC).${pay} ${LIMITS_NOTE}`;
}

function failure(status: number, json: any): string {
  const why = typeof json?.error === "string" ? json.error : `HTTP ${status}`;
  return `Toll could not answer: ${why}`;
}

/** One Robinhood Stock Token by ticker or contract: GET /api/markets/stock/{id}. Returns the JSON text, or one line saying why not. */
export async function stockToken(id: string, opts: MarketsOptions = {}): Promise<string> {
  const v = typeof id === "string" ? id.trim() : "";
  if (!STOCK_ID.test(v)) return "Toll could not answer: Not a ticker (NVDA) or a Stock Token contract address (0x + 40 hex).";
  const base = (opts.baseUrl ?? "https://t0ll.xyz").replace(/\/+$/, "");
  const clean = v.replace(/^\$/, "");
  try {
    const { status, json, retryAfter } = await getJson(`${base}/api/markets/stock/${encodeURIComponent(clean)}`, opts);
    if (status === 429) return overQuota(json, paidStockUrl(clean, base), retryAfter);
    if (status !== 200 || json === null) return failure(status, json);
    return JSON.stringify(json);
  } catch (e) {
    return `Toll could not answer: ${e instanceof Error ? e.message : "request failed"}`;
  }
}

/** The Robinhood Stock Tokens list: GET /api/markets/stocks?q=&limit=. Returns the JSON text, or one line saying why not. */
export async function stockTokens(args: { query?: string; limit?: number } = {}, opts: MarketsOptions = {}): Promise<string> {
  const { query, limit } = args;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 250)) {
    return "Toll could not answer: limit is a whole number from 1 to 250.";
  }
  const base = (opts.baseUrl ?? "https://t0ll.xyz").replace(/\/+$/, "");
  const sp = new URLSearchParams();
  const q = typeof query === "string" ? query.trim().slice(0, 60) : "";
  if (q) sp.set("q", q);
  if (limit !== undefined) sp.set("limit", String(limit));
  const qs = sp.toString();
  try {
    const { status, json, retryAfter } = await getJson(`${base}/api/markets/stocks${qs ? `?${qs}` : ""}`, opts);
    if (status === 429) return overQuota(json, null, retryAfter);
    if (status !== 200 || json === null) return failure(status, json);
    return JSON.stringify(json);
  } catch (e) {
    return `Toll could not answer: ${e instanceof Error ? e.message : "request failed"}`;
  }
}
