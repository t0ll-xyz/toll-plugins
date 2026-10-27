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
  /** Set when the server says it is still reading: ask again after retryAfterS seconds. */
  pending: { retryAfterS: number } | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TollOptions {
  /** Default https://t0ll.xyz */
  baseUrl?: string;
  /** Plain fetch used for MCP calls. Default: global fetch. */
  fetch?: FetchLike;
  /** An x402-aware fetch (for example from x402-fetch) used by pay(). */
  payFetch?: FetchLike;
  /** Per-request timeout. Default 30000. */
  timeoutMs?: number;
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

/** Pull the paid x402 URL out of the over-quota line of an answer (only https://t0ll.xyz/api/x402/...). */
export function parsePaidUrl(text: string): string | null {
  const m = PAID_URL.exec(text);
  return m ? m[1].replace(/[.,;:]+$/, "") : null;
}

/** "ask again in 20 s" / "try again in about 30 seconds" -> seconds. */
export function parsePending(text: string): { retryAfterS: number } | null {
  const m = AGAIN.exec(text);
  return m ? { retryAfterS: Number(m[1]) } : null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Toll {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly payFetch?: FetchLike;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextId = 1;

  constructor(opts: TollOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://t0ll.xyz").replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.payFetch = opts.payFetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async request(url: string, init: RequestInit, f: FetchLike): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await f(url, { ...init, signal: ctl.signal });
    } catch (e) {
      if (ctl.signal.aborted) throw new TollError(`Request to ${url} timed out after ${this.timeoutMs} ms.`);
      throw new TollError(`Request to ${url} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const res = await this.request(
      `${this.baseUrl}/mcp`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
      },
      this.fetchFn,
    );
    const raw = await res.text();
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

  /** LARP check. With wait: true, re-asks while the server is still reading (max 3 tries, max 120 s waiting). */
  async larpCheck(token: string, opts: { chain?: LarpChain; wait?: boolean } = {}): Promise<TollResult> {
    assertAddress(token, "token");
    assertChain(opts.chain, ["rh", "sol"]);
    const args = { token, ...(opts.chain ? { chain: opts.chain } : {}) };
    let res = await this.call("larp_check", args);
    if (!opts.wait) return res;
    let waited = 0;
    for (let tries = 1; tries < 3 && res.pending; tries++) {
      const s = res.pending.retryAfterS;
      if (waited + s > 120) break;
      await this.sleep(s * 1000);
      waited += s;
      res = await this.call("larp_check", args);
    }
    return res;
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
   * GET a paid x402 URL (the paidUrl of an answer) with the payFetch you brought.
   * On 402 {"pending": true} it resends after Retry-After (max 3 tries, max 120 s). Returns the JSON.
   */
  async pay(paidUrl: string): Promise<unknown> {
    if (!/^https:\/\/t0ll\.xyz\/api\/x402\//.test(paidUrl)) {
      throw new TollError("pay() only takes https://t0ll.xyz/api/x402/... URLs.");
    }
    if (!this.payFetch) {
      throw new TollError("pay() needs a payFetch: pass an x402-aware fetch (for example from x402-fetch) as new Toll({ payFetch }).");
    }
    let waited = 0;
    for (let tries = 1; ; tries++) {
      const res = await this.request(paidUrl, { method: "GET", headers: { accept: "application/json" } }, this.payFetch);
      const raw = await res.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        /* not JSON */
      }
      if (res.status === 402 && json?.pending === true) {
        const s = Number(res.headers.get("retry-after")) || 5;
        if (tries >= 3 || waited + s > 120) {
          throw new TollError("The paid answer is still being read; payment not settled yet. Try again later.", {
            status: 402,
            retryAfterS: s,
          });
        }
        await this.sleep(s * 1000);
        waited += s;
        continue;
      }
      if (res.status === 402) throw new TollError("Payment required: the payment was missing or not accepted.", { status: 402 });
      if (!res.ok) throw new TollError(`Toll answered HTTP ${res.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`, { status: res.status });
      if (json === null) throw new TollError("The paid answer was not JSON.", { status: res.status });
      return json;
    }
  }
}

/** Accepts plain JSON or one SSE `data:` frame. */
function parseBody(raw: string): any {
  const t = raw.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  const line = t.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error("no data");
  return JSON.parse(line.slice(5).trim());
}
