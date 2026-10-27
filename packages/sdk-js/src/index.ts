/**
 * @tollxyz/sdk - client for Toll's remote MCP server (https://t0ll.xyz/mcp).
 * Information only, not financial advice.
 */

export type Chain = "rh" | "sol" | "bsc";
export type LarpChain = "rh" | "sol";

export interface TollResult {
  /** The markdown text the server answered with. */
  text: string;
  /** The paid x402 URL for this coin when the free quota is used up, else null. */
  paidUrl: string | null;
  /** Set when part of the answer is still being read: ask again after retryAfterS seconds. */
  pending: { retryAfterS: number } | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** What a paid URL asks for, read from its 402 answer. */
export interface PaymentRequirements {
  /** 2 when the 402 carried a PAYMENT-REQUIRED header (the SDK then sends PAYMENT-SIGNATURE), else 1 (X-PAYMENT). */
  x402Version: 1 | 2;
  /** The decoded 402 object: the base64 JSON of the PAYMENT-REQUIRED header (v2) or the JSON body (v1). */
  paymentRequired: { x402Version: number; accepts: Array<Record<string, unknown>>; [key: string]: unknown };
  /** paymentRequired.accepts: scheme, network, asset, amount (v2) or maxAmountRequired (v1), payTo, maxTimeoutSeconds, extra. */
  accepts: Array<Record<string, unknown>>;
}

/**
 * Signs ONE payment for a paid URL and returns the payment header value (base64 payload) for
 * requirements.x402Version: v2 is sent as PAYMENT-SIGNATURE, v1 as X-PAYMENT.
 * pay() calls it at most once per call and resends the same value while the answer is pending.
 */
export type SignPayment = (requirements: PaymentRequirements, url: string) => Promise<string> | string;

export interface TollOptions {
  /** Default https://t0ll.xyz */
  baseUrl?: string;
  /** Plain fetch used for MCP calls. Default: global fetch. */
  fetch?: FetchLike;
  /** Signs the payment pay() sends (see SignPayment). Without it pay() throws before any request. */
  sign?: SignPayment;
  /** Per-request timeout for MCP calls. Default 30000. */
  timeoutMs?: number;
  /** Whole-call timeout for pay(), waits included. Default 300000. */
  payTimeoutMs?: number;
  /** Replaces the wait between retries (tests). Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export class TollError extends Error {
  readonly status?: number;
  readonly code?: number;
  readonly retryAfterS?: number;
  constructor(message: string, extra: { status?: number; code?: number; retryAfterS?: number } = {}) {
    super(message);
    this.name = "TollError";
    this.status = extra.status;
    this.code = extra.code;
    this.retryAfterS = extra.retryAfterS;
  }
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** True for a token address: 0x + 40 hex, or a Solana base58 mint (32-44 chars). */
export function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && (EVM.test(value) || BASE58.test(value));
}

/** True for a wallet address: 0x + 40 hex. */
export function isValidWallet(value: unknown): value is string {
  return typeof value === "string" && EVM.test(value);
}

function assertAddress(value: unknown, what = "address"): string {
  if (!isValidAddress(value)) {
    throw new TollError(`Invalid ${what}: expected 0x + 40 hex characters or a Solana base58 mint (32-44 characters).`);
  }
  return value;
}

function assertWallet(value: unknown): string {
  if (!isValidWallet(value)) throw new TollError("Invalid wallet: expected 0x + 40 hex characters.");
  return value;
}

function assertChain(chain: string | undefined, allowed: readonly string[]): void {
  if (chain !== undefined && !allowed.includes(chain)) {
    throw new TollError(`Invalid chain "${chain}": use ${allowed.join(", ")}.`);
  }
}

// Only the upsell line counts: a finished LARP answer also lists Toll's own x402 endpoint as a "working part".
const PAID_URL = /paid (?:LARP )?check of this coin \(x402\):\s*(https:\/\/t0ll\.xyz\/api\/x402\/[^\s)"'<>]+)/i;
const AGAIN = /again in (?:about )?(\d+)\s*(?:s\b|sec)/i;

/** Seconds to wait, never below 1 (a 0 or junk value must not become a tight loop). */
function clampSeconds(n: number, fallback: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : fallback;
}

/** Pull the paid x402 URL out of the over-quota line of an answer (only https://t0ll.xyz/api/x402/...). */
export function parsePaidUrl(text: string): string | null {
  const m = PAID_URL.exec(text);
  return m ? m[1].replace(/[.,;:]+$/, "") : null;
}

/** "ask again in 20 s" / "try again in about 30 seconds" -> seconds. */
export function parsePending(text: string): { retryAfterS: number } | null {
  const m = AGAIN.exec(text);
  return m ? { retryAfterS: clampSeconds(Number(m[1]), 5) } : null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Toll {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly signFn?: SignPayment;
  private readonly timeoutMs: number;
  private readonly payTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextId = 1;

  constructor(opts: TollOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://t0ll.xyz").replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.signFn = opts.sign;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.payTimeoutMs = opts.payTimeoutMs ?? 300_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** One HTTP request. The timer covers reading the body and is cleared only after the body is read. */
  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number = this.timeoutMs,
    note = "",
  ): Promise<{ res: Response; raw: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.fetchFn(url, { ...init, signal: ctl.signal });
      const raw = await res.text();
      return { res, raw };
    } catch (e) {
      if (ctl.signal.aborted) throw new TollError(`Request to ${url} timed out after ${timeoutMs} ms.${note}`);
      throw new TollError(`Request to ${url} failed: ${e instanceof Error ? e.message : String(e)}.${note}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const { res, raw } = await this.request(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
    });
    if (!res.ok) {
      throw new TollError(`Toll answered HTTP ${res.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`, { status: res.status });
    }
    let body: any;
    try {
      body = parseBody(raw);
    } catch {
      throw new TollError("Toll sent an answer that is not JSON-RPC.", { status: res.status });
    }
    if (body?.error) {
      throw new TollError(`Toll JSON-RPC error ${body.error.code}: ${body.error.message}`, { code: body.error.code });
    }
    return body?.result;
  }

  /** The server's tool list (name, title, description, inputSchema). */
  async tools(): Promise<Array<{ name: string; title?: string; description?: string; inputSchema?: unknown }>> {
    const r = await this.rpc("tools/list", {});
    return r?.tools ?? [];
  }

  /** Call any tool by its server name. isError answers throw a TollError. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<TollResult> {
    const r = await this.rpc("tools/call", { name, arguments: args });
    const text: string = Array.isArray(r?.content)
      ? r.content.filter((c: any) => c?.type === "text").map((c: any) => String(c.text)).join("\n")
      : "";
    if (r?.isError) {
      const p = parsePending(text);
      throw new TollError(text.split("\n\n")[0] || "Toll reported an error.", p ? { retryAfterS: p.retryAfterS } : {});
    }
    const pending = /still reading/i.test(text) ? parsePending(text) : null;
    return { text, paidUrl: parsePaidUrl(text), pending };
  }

  async checkCoin(address: string, opts: { chain?: Chain } = {}): Promise<TollResult> {
    assertAddress(address);
    assertChain(opts.chain, ["rh", "sol", "bsc"]);
    return this.call("check_coin", { address, ...(opts.chain ? { chain: opts.chain } : {}) });
  }

  /**
   * LARP check. With wait: true, asks again while part of the answer is still being read, or while Toll
   * answers that it is busy with many new LARP checks (a TollError with retryAfterS): max 3 tries, max 120 s waiting.
   */
  async larpCheck(token: string, opts: { chain?: LarpChain; wait?: boolean } = {}): Promise<TollResult> {
    assertAddress(token, "token");
    assertChain(opts.chain, ["rh", "sol"]);
    const args = { token, ...(opts.chain ? { chain: opts.chain } : {}) };
    if (!opts.wait) return this.call("larp_check", args);
    let waited = 0;
    for (let tries = 1; ; tries++) {
      let res: TollResult | null = null;
      let busy: TollError | null = null;
      try {
        res = await this.call("larp_check", args);
      } catch (e) {
        if (e instanceof TollError && e.retryAfterS !== undefined) busy = e;
        else throw e;
      }
      const s = res ? res.pending?.retryAfterS : busy!.retryAfterS!;
      if (s === undefined) return res!;
      if (tries >= 3 || waited + s > 120) {
        if (busy) throw busy;
        return res!;
      }
      await this.sleep(s * 1000);
      waited += s;
    }
  }

  async devRecord(wallet: string, opts: { chain?: Chain } = {}): Promise<TollResult> {
    assertWallet(wallet);
    assertChain(opts.chain, ["rh", "bsc"]);
    return this.call("dev_record", { wallet, ...(opts.chain ? { chain: opts.chain } : {}) });
  }

  async launchRecord(address: string): Promise<TollResult> {
    assertWallet(address);
    return this.call("launch_record", { address });
  }

  async walletPrivacy(wallet: string): Promise<TollResult> {
    assertWallet(wallet);
    return this.call("wallet_privacy", { wallet });
  }

  async freshLaunches(limit?: number): Promise<TollResult> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
      throw new TollError("Invalid limit: use a whole number from 1 to 20.");
    }
    return this.call("fresh_launches", limit === undefined ? {} : { limit });
  }

  async chainPulse(): Promise<TollResult> {
    return this.call("chain_pulse", {});
  }

  /**
   * Pays a paid x402 URL (the paidUrl of an answer) and returns its JSON.
   *
   * 1. GET without payment: 402 with the requirements (v2 PAYMENT-REQUIRED header, else the v1 body).
   * 2. Calls sign(requirements, url) ONCE for the payment header value.
   * 3. GET with it (v2: PAYMENT-SIGNATURE, v1: X-PAYMENT). On 402 {"pending": true} resends EXACTLY the same
   *    header after Retry-After (at least 1 s), max 5 tries and 300 s of waiting. 200 JSON is the answer.
   *    Any other 402 after paying is a TollError "payment not accepted". It never signs a second payment.
   * The whole call is bounded by payTimeoutMs (default 300000).
   */
  async pay(paidUrl: string, opts: { sign?: SignPayment; timeoutMs?: number } = {}): Promise<unknown> {
    if (typeof paidUrl !== "string" || !/^https:\/\/t0ll\.xyz\/api\/x402\//.test(paidUrl)) {
      throw new TollError("pay() only takes https://t0ll.xyz/api/x402/... URLs.");
    }
    const sign = opts.sign ?? this.signFn;
    if (!sign) {
      throw new TollError("pay() needs a sign function: new Toll({ sign }) or pay(url, { sign }). See the README (paying).");
    }
    const totalMs = opts.timeoutMs ?? this.payTimeoutMs;
    const deadline = Date.now() + totalMs;
    const left = () => Math.max(1, deadline - Date.now());

    // 1. Unpaid GET: read what to pay.
    const first = await this.request(paidUrl, { method: "GET", headers: { accept: "application/json" } }, left());
    if (first.res.ok) return parseJsonAnswer(first.raw, first.res.status);
    if (first.res.status !== 402) throw httpError(first.res.status, first.raw);
    const requirements = readRequirements(first.res, first.raw);

    // 2. One signature for this call.
    let header: string;
    try {
      header = await sign(requirements, paidUrl);
    } catch (e) {
      throw new TollError(`sign() failed, nothing was sent: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (typeof header !== "string" || !header.trim() || /[\r\n]/.test(header)) {
      throw new TollError("sign() must return the payment header value as one non-empty line; nothing was sent.");
    }
    const headerName = requirements.x402Version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT";
    const settleNote =
      " The payment may have settled: do not retry this call with a new signature; resend the same payment header to get the answer.";

    // 3. Paid GET, resending the same header while the answer is pending.
    let waitedS = 0;
    for (let tries = 1; ; tries++) {
      if (Date.now() >= deadline) throw new TollError(`pay() timed out after ${totalMs} ms.${settleNote}`);
      const { res, raw } = await this.request(
        paidUrl,
        { method: "GET", headers: { accept: "application/json", [headerName]: header } },
        left(),
        settleNote,
      );
      const json = tryJson(raw);
      if (res.status === 402 && json?.pending === true) {
        const s = clampSeconds(Number(res.headers.get("retry-after") ?? NaN), 5);
        if (tries >= 5 || waitedS + s > 300 || Date.now() + s * 1000 > deadline) {
          throw new TollError(
            `The paid answer is still being read after ${tries} tries (nothing is charged while it is pending). Resend the same payment header later; do not sign a new one for this call.`,
            { status: 402, retryAfterS: s },
          );
        }
        await this.sleep(s * 1000);
        waitedS += s;
        continue;
      }
      if (res.status === 402) {
        const why = typeof json?.error === "string" ? ` (${json.error})` : "";
        throw new TollError(`payment not accepted: Toll answered 402 to the signed payment${why}. pay() does not sign again.`, {
          status: 402,
        });
      }
      if (!res.ok) throw httpError(res.status, raw, settleNote);
      return parseJsonAnswer(raw, res.status);
    }
  }
}

function tryJson(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parseJsonAnswer(raw: string, status: number): unknown {
  const json = tryJson(raw);
  if (json === null) throw new TollError("The paid answer was not JSON.", { status });
  return json;
}

function httpError(status: number, raw: string, note = ""): TollError {
  return new TollError(`Toll answered HTTP ${status}${raw ? `: ${raw.slice(0, 200)}` : ""}.${note}`, { status });
}

function decodeBase64Json(value: string): any {
  const bin = atob(value.trim());
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/** Reads a 402: v2 from the PAYMENT-REQUIRED header when it decodes, else v1 from the JSON body. */
export function readRequirements(res: Response, raw: string): PaymentRequirements {
  const h = res.headers.get("payment-required");
  if (h) {
    try {
      const pr = decodeBase64Json(h);
      if (pr && Array.isArray(pr.accepts) && pr.accepts.length) return { x402Version: 2, paymentRequired: pr, accepts: pr.accepts };
    } catch {
      /* fall back to the body */
    }
  }
  const body = tryJson(raw);
  if (body && Array.isArray(body.accepts) && body.accepts.length) {
    return { x402Version: 1, paymentRequired: body, accepts: body.accepts };
  }
  throw new TollError("Toll answered 402 without x402 payment requirements; nothing was signed.", { status: 402 });
}

/** Accepts plain JSON or one SSE `data:` frame. */
function parseBody(raw: string): any {
  const t = raw.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  const line = t.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error("no data");
  return JSON.parse(line.slice(5).trim());
}
