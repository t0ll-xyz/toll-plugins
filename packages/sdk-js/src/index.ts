/**
 * @tollxyz/sdk - client for Toll's remote MCP server (https://t0ll.xyz/mcp).
 * Information only, not financial advice.
 */

/** Toll reads Robinhood Chain (chain id 4663) only. The chain option stays for compatibility and takes only "rh". */
export type Chain = "rh";
export type LarpChain = "rh";

/** Every tool of https://t0ll.xyz/mcp, in the server's order. */
export const TOOL_NAMES = [
  "check_coin",
  "larp_check",
  "dev_record",
  "wallet_privacy",
  "fresh_launches",
  "chain_pulse",
  "launch_record",
  "check_agent",
  "check_hook",
  "check_tx",
  "presign_risk_report",
  "stock_token",
  "stock_tokens",
  "fundamentals",
  "insider_trades",
  "institutions",
  "guidance",
  "macro",
  "stock_events",
] as const;
export type TollToolName = (typeof TOOL_NAMES)[number];

/** The periods fundamentals takes. */
export const FUNDAMENTALS_PERIODS = ["ttm", "annual", "quarterly"] as const;
export type FundamentalsPeriod = (typeof FUNDAMENTALS_PERIODS)[number];

/** The kinds stock_events filters on. */
export const STOCK_EVENT_KINDS = [
  "listed",
  "delisted",
  "multiplier_scheduled",
  "multiplier_applied",
  "corporate_action",
  "feed_stale",
  "feed_paused",
  "feed_resumed",
  "filing",
] as const;
export type StockEventKind = (typeof STOCK_EVENT_KINDS)[number];

/**
 * check_tx input: a transaction (to, data, value, from), an EIP-712 signature request (typedData) or an x402
 * payment (x402: the PaymentRequired from the 402, or one accepts entry). Robinhood Chain (4663) only.
 */
export interface CheckTxRequest {
  /** 4663 (Robinhood Chain), the only one read; leave it out for 4663. */
  chainId?: number | string;
  /** The signer's address: a swap paying out to anyone else is flagged. */
  from?: string;
  /** The contract or wallet the transaction is sent to. */
  to?: string;
  /** The calldata, hex (0x for a plain send). */
  data?: string;
  /** Wei sent with it, decimal or 0x hex (default 0). */
  value?: number | string;
  /** An EIP-712 signature request: {domain, types, primaryType, message}. */
  typedData?: Record<string, unknown>;
  /** An x402 payment: the PaymentRequired the 402 sent (with accepts), or one accepts entry; optional payment and resource. */
  x402?: Record<string, unknown>;
  /** The x402 seller's ERC-8004 agent id, when known. */
  agentId?: number | string;
  /** The identity registry agentId is in, CAIP-10 (default eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432). */
  registry?: string;
  /** Strict payee policy: an x402 payTo not verified as the seller's (ERC-8478) is BLOCK instead of a warning. */
  strict?: boolean;
}

/** presign_risk_report input: an ERC draft PresignRequest (ethereum/ERCs PR #2134). */
export interface PresignRequest {
  version: "erc-presign/1";
  /** {type: "calls", chainId: "eip155:4663", from: "eip155:4663:0x<signer>", calls: [{to, value, data}], typedData?} */
  subject: Record<string, unknown>;
  /** Optional: {payment: {requirements, resource?, payee?: {registry, agentId}}, texts: [{field, ref?, text}], tokens: [CAIP-10]} */
  context?: Record<string, unknown>;
  /** Optional: only these finding kinds. */
  kinds?: string[];
}

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

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** The slice of node:fs the install id needs (injectable for tests). */
export interface ClientIdFs {
  readFileSync(path: string, enc: "utf8"): string;
  writeFileSync(path: string, data: string, opts?: { mode?: number; flag?: string }): void;
  mkdirSync(path: string, opts?: { recursive?: boolean }): unknown;
  renameSync(from: string, to: string): void;
  unlinkSync?(path: string): void;
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let processId: string | undefined;

/** Node's fs and home directory, looked up lazily so browser and edge bundles never import them. */
function nodeEnv(): { fs: ClientIdFs | null; home: string | null } {
  try {
    const get = (globalThis as any).process?.getBuiltinModule;
    if (typeof get !== "function") return { fs: null, home: null };
    const fs = get.call((globalThis as any).process, "node:fs") as ClientIdFs | undefined;
    const os = get.call((globalThis as any).process, "node:os") as { homedir(): string } | undefined;
    return { fs: fs ?? null, home: os?.homedir() || null };
  } catch {
    return { fs: null, home: null };
  }
}

/**
 * The stable install id sent as x-toll-client so Toll can count returning agents (no wallet, no personal data):
 * `explicit` when it matches [A-Za-z0-9_-]{22,64}, else the one kept in ~/.toll/client-id (created once), else a random
 * id for this process. Never throws.
 */
export function resolveClientId(
  explicit?: string,
  env: { fs?: ClientIdFs | null; home?: string | null; sleep?: (ms: number) => void } = nodeEnv(),
): string {
  const given = typeof explicit === "string" ? explicit.trim() : "";
  if (CLIENT_ID_RE.test(given)) return given;
  try {
    if (env.fs && env.home) {
      const dir = `${env.home.replace(/[\\/]+$/, "")}/.toll`;
      const file = `${dir}/client-id`;
      try {
        const have = env.fs.readFileSync(file, "utf8").trim();
        if (CLIENT_ID_RE.test(have)) return have;
      } catch {}
      const fresh = randomId();
      env.fs.mkdirSync(dir, { recursive: true });
      const line = `${fresh}\n`;
      const readValid = (): string | null => {
        try {
          const have = env.fs!.readFileSync(file, "utf8").trim();
          return CLIENT_ID_RE.test(have) ? have : null;
        } catch {
          return null;
        }
      };
      try {
        env.fs.writeFileSync(file, line, { mode: 0o600, flag: "wx" });
        return readValid() ?? fresh;
      } catch {
        // the file exists: its writer may not have finished (retry the read briefly), else it holds junk
        for (let i = 0; i < 3; i++) {
          const have = readValid();
          if (have) return have;
          (env.sleep ?? sleepSync)(20);
        }
      }
      // junk or empty: replace it atomically, then trust whatever valid id is on disk
      const tmp = `${file}.${randomId()}.tmp`;
      try {
        env.fs.writeFileSync(tmp, line, { mode: 0o600 });
        env.fs.renameSync(tmp, file);
      } catch {
        try {
          env.fs.unlinkSync?.(tmp);
        } catch {}
      }
      return readValid() ?? fresh;

    }
  } catch {}
  return (processId ??= randomId());
}

export interface TollOptions {
  /** Default https://t0ll.xyz */
  baseUrl?: string;
  /**
   * A Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every MCP call: carries the key wallet's daily
   * tier (more new coins and Markets calls a day, the live stock_events feed).
   */
  tollKey?: string;
  /**
   * A stable install id sent as x-toll-client on every MCP call so Toll can count returning agents (22-64 chars of
   * A-Z a-z 0-9 _ -; anything else is ignored). Default: a random id kept in ~/.toll/client-id when the filesystem is
   * there, else random per process.
   */
  clientId?: string;
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
/** A ticker as Robinhood lists it (NVDA, BRK.B, $NVDA) or a Stock Token contract (0x + 40 hex). Same rule as the API. */
const STOCK_ID = /^(0x[0-9a-fA-F]{40}|\$?[A-Za-z][A-Za-z0-9.\-]{0,11})$/;

/** What Toll answers for any chain but Robinhood Chain. */
export const RH_ONLY = "Toll reads Robinhood Chain only right now.";

/** True for a token address on Robinhood Chain: 0x + 40 hex. */
export function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && EVM.test(value);
}

/** True for a Stock Token id: a ticker (NVDA, BRK.B, $NVDA) or its contract (0x + 40 hex). */
export function isValidStockId(value: unknown): value is string {
  return typeof value === "string" && STOCK_ID.test(value.trim());
}

/** True for a wallet address: 0x + 40 hex. */
export function isValidWallet(value: unknown): value is string {
  return typeof value === "string" && EVM.test(value);
}

function assertAddress(value: unknown, what = "address"): string {
  if (!isValidAddress(value)) {
    throw new TollError(`Invalid ${what}: expected 0x + 40 hex characters (a Robinhood Chain address). ${RH_ONLY}`);
  }
  return value;
}

function assertWallet(value: unknown): string {
  if (!isValidWallet(value)) throw new TollError("Invalid wallet: expected 0x + 40 hex characters.");
  return value;
}

function assertChain(chain: string | undefined): void {
  if (chain !== undefined && chain !== "rh") {
    throw new TollError(`Invalid chain "${chain}": ${RH_ONLY} Use rh or leave chain out.`);
  }
}

function assertStockId(value: unknown): string {
  if (!isValidStockId(value)) throw new TollError("Invalid id: expected a ticker (NVDA, BRK.B) or a Stock Token contract (0x + 40 hex).");
  return value.trim().replace(/^\$/, "");
}

function assertLimit(limit: number | undefined, max: number): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > max)) {
    throw new TollError(`Invalid limit: use a whole number from 1 to ${max}.`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
  private readonly tollKey?: string;
  private readonly clientId: string;
  private readonly signFn?: SignPayment;
  private readonly timeoutMs: number;
  private readonly payTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextId = 1;

  constructor(opts: TollOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://t0ll.xyz").replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.tollKey = opts.tollKey?.trim() || undefined;
    this.clientId = resolveClientId(opts.clientId);
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
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.tollKey ? { "x-toll-pass": this.tollKey } : {}),
        "x-toll-client": this.clientId,
      },
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
    assertChain(opts.chain);
    return this.call("check_coin", { address, ...(opts.chain ? { chain: opts.chain } : {}) });
  }

  /**
   * LARP check. With wait: true, asks again while part of the answer is still being read, or while Toll
   * answers that it is busy with many new LARP checks (a TollError with retryAfterS): max 3 tries, max 120 s waiting.
   */
  async larpCheck(token: string, opts: { chain?: LarpChain; wait?: boolean } = {}): Promise<TollResult> {
    assertAddress(token, "token");
    assertChain(opts.chain);
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
    assertChain(opts.chain);
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

  /** One ERC-8004 agent registered on Robinhood Chain, by its agent id (for example 20030). */
  async checkAgent(id: number | string): Promise<TollResult> {
    const ok =
      (typeof id === "number" && Number.isInteger(id) && id >= 0 && id <= 1_000_000_000) ||
      (typeof id === "string" && /^[0-9]{1,10}$/.test(id));
    if (!ok) throw new TollError("Invalid agent id: expected a whole number (its ERC-8004 token id on Robinhood Chain).");
    return this.call("check_agent", { id });
  }

  /**
   * One Uniswap v4 hook on Robinhood Chain, by its contract address: its name, what its address lets it do, whether
   * its owner can change its code, how many pools use it, and whether sells through it fail. A $TOLL holder's key
   * (apiKey) adds the measured cut and how its latest coins ended.
   */
  async checkHook(address: string): Promise<TollResult> {
    assertAddress(address, "hook address");
    return this.call("check_hook", { address });
  }

  /**
   * Pre-sign check on Robinhood Chain: ALLOW / WARN / BLOCK with the reasons (an ERC-8265 RiskAssessment), for a
   * transaction (to, data, value, from), an EIP-712 signature (typedData) or an x402 payment (x402).
   */
  async checkTx(req: CheckTxRequest): Promise<TollResult> {
    if (!isObject(req) || (req.to === undefined && req.typedData === undefined && req.x402 === undefined)) {
      throw new TollError("checkTx needs a transaction (to, data, value, from), typedData or x402.");
    }
    if (req.chainId !== undefined && String(req.chainId) !== "4663" && String(req.chainId).toLowerCase() !== "0x1237") {
      throw new TollError(`Invalid chainId "${req.chainId}": ${RH_ONLY} (chain id 4663)`);
    }
    return this.call("check_tx", { ...req });
  }

  /** Agent Pre-Sign Risk Report (ERC draft, PR #2134): typed facts about an unsigned request, EIP-712 signed by Toll. No verdict. */
  async presignRiskReport(req: PresignRequest): Promise<TollResult> {
    if (!isObject(req) || req.version !== "erc-presign/1" || !isObject(req.subject)) {
      throw new TollError('presignRiskReport needs {version: "erc-presign/1", subject: {type: "calls", ...}}.');
    }
    return this.call("presign_risk_report", { ...req });
  }

  /** One Robinhood Stock Token by ticker (NVDA) or contract: reference price, pool price, supply, corporate actions, SEC facts. */
  async stockToken(id: string): Promise<TollResult> {
    return this.call("stock_token", { id: assertStockId(id) });
  }

  /** The Stock Tokens Robinhood lists on Robinhood Chain; query filters by ticker or company. */
  async stockTokens(opts: { query?: string; limit?: number } = {}): Promise<TollResult> {
    assertLimit(opts.limit, 250);
    const q = typeof opts.query === "string" ? opts.query.trim().slice(0, 60) : "";
    return this.call("stock_tokens", { ...(q ? { query: q } : {}), ...(opts.limit !== undefined ? { limit: opts.limit } : {}) });
  }

  /** A Stock Token company's numbers from SEC filings (period: ttm, annual or quarterly). */
  async fundamentals(id: string, opts: { period?: FundamentalsPeriod } = {}): Promise<TollResult> {
    const clean = assertStockId(id);
    if (opts.period !== undefined && !(FUNDAMENTALS_PERIODS as readonly string[]).includes(opts.period)) {
      throw new TollError("Invalid period: use ttm, annual or quarterly.");
    }
    return this.call("fundamentals", { id: clean, ...(opts.period ? { period: opts.period } : {}) });
  }

  /** Form 4 insider trades of the last 90 days and Schedule 13D/G filings (limit: 1 to 100 rows). */
  async insiderTrades(id: string, opts: { limit?: number } = {}): Promise<TollResult> {
    const clean = assertStockId(id);
    assertLimit(opts.limit, 100);
    return this.call("insider_trades", { id: clean, ...(opts.limit !== undefined ? { limit: opts.limit } : {}) });
  }

  /** 13F institutional holders for the latest quarter (limit: 1 to 20 holders). */
  async institutions(id: string, opts: { limit?: number } = {}): Promise<TollResult> {
    const clean = assertStockId(id);
    assertLimit(opts.limit, 20);
    return this.call("institutions", { id: clean, ...(opts.limit !== undefined ? { limit: opts.limit } : {}) });
  }

  /** Guidance, KPIs and non-GAAP from the last 4 earnings releases, AI-extracted from cited filings (limit: 1 to 60 per release). */
  async guidance(id: string, opts: { limit?: number } = {}): Promise<TollResult> {
    const clean = assertStockId(id);
    assertLimit(opts.limit, 60);
    return this.call("guidance", { id: clean, ...(opts.limit !== undefined ? { limit: opts.limit } : {}) });
  }

  /** US macro: the Treasury curve, the EFFR, CPI, unemployment and payrolls, each with its date. */
  async macro(): Promise<TollResult> {
    return this.call("macro", {});
  }

  /**
   * What changed on Robinhood's Stock Tokens, oldest first; since = the last answer's next. Without a Toll key: the last
   * 10 events found an hour ago or more; Team holders read it live, Pro 15 minutes late.
   */
  async stockEvents(opts: { since?: number; kind?: StockEventKind; limit?: number } = {}): Promise<TollResult> {
    if (opts.since !== undefined && (!Number.isInteger(opts.since) || opts.since < 0)) {
      throw new TollError("Invalid since: use the next of the last answer (a whole number).");
    }
    if (opts.kind !== undefined && !(STOCK_EVENT_KINDS as readonly string[]).includes(opts.kind)) {
      throw new TollError(`Invalid kind: use ${STOCK_EVENT_KINDS.join(", ")}.`);
    }
    assertLimit(opts.limit, 100);
    return this.call("stock_events", {
      ...(opts.since !== undefined ? { since: opts.since } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
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
