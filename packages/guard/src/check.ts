/**
 * The one call to Toll: POST https://t0ll.xyz/api/tx/check. Every check runs on Toll's server, so a new check reaches
 * every agent without a package update. This file only sends the request and reads the answer.
 */

export const DEFAULT_BASE_URL = "https://t0ll.xyz";
/** Robinhood Chain: the only chain the pre-sign check reads for now */
export const TX_CHAIN_ID = 4663;
/** the paid route without the daily limit (0.01 USDG over x402); the guard never pays it */
export const PAID_TX_PATH = "/api/x402/tx";
export const PRESIGN_DOCS = "https://t0ll.xyz/agents/x402#presign";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RETRY_WAIT_MS = 10_000;

/* ------------------------------------------------------------------ the answer: ERC-8265 RiskAssessment */

export type Action = "ALLOW" | "WARN" | "BLOCK";
export type Severity = "low" | "medium" | "high" | "critical";
export interface RiskWarning {
  /** machine-readable, kebab-case, e.g. "unbounded-approval", "coin-not-read", "payee-mismatch" */
  code: string;
  severity: Severity;
  message: string;
  /** the facts behind this warning (Toll's vendor extension) */
  "x-toll-evidence"?: Record<string, unknown>;
}
export interface ScannerVerdict {
  provider: string;
  verdict: Action;
  url?: string;
}
export interface TollExtra {
  scanner?: { agent_id: number; chain_id: number; registry: string; site: string };
  /** when Toll made this answer, ISO 8601 UTC */
  checked_at?: string;
  /** what the transaction / signature does, as Toll read it */
  decoded?: Record<string, unknown>[];
  coins?: Record<string, unknown>[];
  payees?: Record<string, unknown>[];
  /** a coin still being read: ask again after this many seconds */
  retry_after_s?: number;
  /** the page to read more on t0ll.xyz */
  link?: string;
  note?: string;
  [key: string]: unknown;
}
export interface RiskAssessment {
  action: Action;
  score?: number;
  warnings: RiskWarning[];
  scanners?: ScannerVerdict[];
  "x-toll"?: TollExtra;
}

/* ------------------------------------------------------------------ the request */

export type Hex = `0x${string}`;
export type Numberish = number | bigint | string;

/** An EIP-712 request as the wallet would sign it. */
export interface TypedDataLike {
  domain?: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * What to check. A transaction ({chainId, from, to, data, value}), an EIP-712 request ({typedData}), an x402 payment
 * ({x402, agentId?, payment?}), or several together.
 */
export interface CheckInput {
  chainId?: Numberish;
  from?: string;
  to?: string;
  data?: string;
  value?: Numberish;
  typedData?: TypedDataLike;
  /** the 402's PaymentRequired, or one of its accepts entries */
  x402?: Record<string, unknown>;
  /** the seller's ERC-8004 agent id, when known */
  agentId?: number | string;
  /** the signed payment (PaymentPayload, {authorization} or the authorization), when already signed */
  payment?: Record<string, unknown>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CheckOptions {
  /** default https://t0ll.xyz */
  baseUrl?: string;
  /** default globalThis.fetch */
  fetch?: FetchLike;
  /** one HTTP request, default 15000 ms */
  timeoutMs?: number;
  /** ask once more after Retry-After when a coin is still being read (default true) */
  retry?: boolean;
  /** the longest Retry-After we wait for that one retry (default 10000 ms); longer = no retry, the WARN stands */
  maxRetryWaitMs?: number;
  /** for tests */
  sleep?: (ms: number) => Promise<void>;
}

/* ------------------------------------------------------------------ errors */

export class TollBlockedError extends Error {
  readonly assessment: RiskAssessment;
  readonly codes: string[];
  constructor(assessment: RiskAssessment, why = assessment.action) {
    const ws = assessment.warnings ?? [];
    const top = ws.filter((w) => w.severity !== "low").slice(0, 5);
    const lines = (top.length ? top : ws.slice(0, 5)).map((w) => `${w.code}: ${w.message}`);
    const link = assessment["x-toll"]?.link;
    super(`Toll ${why}, not signed. ${lines.join(" | ") || "No reason given."}${link ? ` More: ${link}` : ""}`);
    this.name = "TollBlockedError";
    this.assessment = assessment;
    this.codes = ws.map((w) => w.code);
  }
}

export type UnavailableReason = "network" | "timeout" | "rate-limited" | "server-error" | "bad-request" | "bad-answer" | "unsupported" | "encode";

export class TollUnavailableError extends Error {
  readonly reason: UnavailableReason;
  readonly status: number | null;
  /** the paid route (no daily limit) when the free one was rate limited */
  readonly paidUrl: string | null;
  constructor(message: string, o: { reason: UnavailableReason; status?: number | null; paidUrl?: string | null; cause?: unknown }) {
    super(message, o.cause === undefined ? undefined : { cause: o.cause });
    this.name = "TollUnavailableError";
    this.reason = o.reason;
    this.status = o.status ?? null;
    this.paidUrl = o.paidUrl ?? null;
  }
}

/* ------------------------------------------------------------------ helpers */

const ADDR = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (x: unknown): x is string => typeof x === "string" && ADDR.test(x);

/** a chain id as wallets carry it: 4663, 4663n, "4663", "0x1237", "eip155:4663"; null when not readable */
export function chainIdOf(v: unknown): number | null {
  if (typeof v === "bigint") return v > 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^eip155:/i, "");
  if (/^0x[0-9a-fA-F]{1,12}$/.test(s)) return Number(BigInt(s));
  return /^\d{1,15}$/.test(s) ? Number(s) : null;
}

/** JSON with bigints as decimal strings (what the route reads for value, chainId and typed-data fields) */
export const toJson = (x: unknown): string => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const trimBase = (b: string) => b.replace(/\/+$/, "");

/** the request body as the route reads it (lib/txcheck.ts parseTxCheckBody): payment rides inside x402 */
export function bodyOf(input: CheckInput): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (input.to !== undefined || input.data !== undefined) {
    if (input.chainId !== undefined) b.chainId = input.chainId;
    if (input.from !== undefined) b.from = input.from;
    b.to = input.to;
    b.data = input.data ?? "0x";
    b.value = input.value ?? 0;
  }
  if (input.typedData) b.typedData = input.typedData;
  if (input.x402) b.x402 = input.payment ? { ...input.x402, payment: input.payment } : input.x402;
  if (input.agentId !== undefined && input.agentId !== null) b.agentId = input.agentId;
  return b;
}

/** seconds from a Retry-After header (delta-seconds only); null when absent or unreadable */
export function retryAfterS(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** the paid URL an answer names when this caller's free coins are used ("coin-over-quota"), else null */
export function paidUrlOf(a: RiskAssessment | null | undefined): string | null {
  for (const w of a?.warnings ?? []) {
    const p = w["x-toll-evidence"]?.paid;
    if (typeof p === "string" && p.startsWith("http")) return p;
  }
  return null;
}

/** true when the answer is a well-formed RiskAssessment */
export function isAssessment(x: unknown): x is RiskAssessment {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (a.action === "ALLOW" || a.action === "WARN" || a.action === "BLOCK") && Array.isArray(a.warnings);
}

/* ------------------------------------------------------------------ the call */

async function once(url: string, body: string, o: CheckOptions, f: FetchLike, paid: string): Promise<{ a: RiskAssessment; retryS: number | null }> {
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  let raw: string;
  try {
    res = await f(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body, signal: ctl.signal });
    raw = await res.text();
  } catch (e) {
    const timedOut = ctl.signal.aborted;
    throw new TollUnavailableError(timedOut ? `Toll did not answer within ${timeoutMs} ms.` : `Toll could not be reached: ${(e as Error)?.message ?? e}.`, {
      reason: timedOut ? "timeout" : "network",
      cause: e,
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    throw new TollUnavailableError(`Toll's free check is rate limited for this caller (HTTP 429). Paid, no daily limit: ${paid}`, { reason: "rate-limited", status: 429, paidUrl: paid });
  }
  if (res.status >= 500) throw new TollUnavailableError(`Toll answered HTTP ${res.status}.`, { reason: "server-error", status: res.status });
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* handled below */
  }
  if (res.status !== 200) {
    const err = json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : raw.slice(0, 200);
    throw new TollUnavailableError(`Toll could not check this request (HTTP ${res.status}): ${err}`, { reason: res.status === 400 || res.status === 413 ? "bad-request" : "bad-answer", status: res.status });
  }
  if (!isAssessment(json)) throw new TollUnavailableError("Toll's answer was not a RiskAssessment.", { reason: "bad-answer", status: 200 });
  const header = retryAfterS(res.headers.get("retry-after"));
  const ext = json["x-toll"]?.retry_after_s;
  return { a: json, retryS: header ?? (typeof ext === "number" ? ext : null) };
}

/**
 * Checks one transaction, EIP-712 request or x402 payment before it is signed. Returns Toll's ERC-8265
 * RiskAssessment. When a coin is still being read (Retry-After), asks once more if the wait is at most
 * `maxRetryWaitMs`; a coin that is still not read stays a WARN ("coin-not-read"), never an ALLOW.
 * Throws TollUnavailableError when Toll cannot answer (network, timeout, 429, 5xx, a request it cannot read).
 */
export async function checkTx(input: CheckInput, opts: CheckOptions = {}): Promise<RiskAssessment> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!f) throw new TollUnavailableError("No fetch available: pass opts.fetch.", { reason: "network" });
  const base = trimBase(opts.baseUrl ?? DEFAULT_BASE_URL);
  const url = `${base}/api/tx/check`;
  const paid = `${base}${PAID_TX_PATH}`;
  const body = toJson(bodyOf(input));
  const first = await once(url, body, opts, f, paid);
  if (first.retryS === null || opts.retry === false) return first.a;
  const waitMs = Math.max(1, first.retryS) * 1000;
  if (waitMs > (opts.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS)) return first.a;
  await (opts.sleep ?? realSleep)(waitMs);
  // the first answer stands if the retry fails: it is a WARN already, never an ALLOW
  try {
    return (await once(url, body, opts, f, paid)).a;
  } catch {
    return first.a;
  }
}
