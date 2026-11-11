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
  "pre_buy_check",
  "check_coins",
  "larp_check",
  "dev_record",
  "wallet_privacy",
  "wallet_approvals",
  "fresh_launches",
  "chain_pulse",
  "launch_record",
  "check_agent",
  "find_paid_api",
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
  "watch_coin",
  "my_watches",
  "unwatch_coin",
  "watch_wallet",
  "unwatch_wallet",
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
  /**
   * 0.7.1: a type-4 (EIP-7702) transaction's authorizationList, or a signAuthorization alone (no to, no data):
   * [{chainId, address, nonce, yParity, r, s}]. A delegate Toll has verified by code hash is WARN; any other is BLOCK.
   */
  authorizationList?: unknown[];
  /** 0.7.1: a message to sign: {kind: "personal_sign" | "eth_sign", data (0x hex or text), origin?, from?}. Sign-In with Ethereum is read; eth_sign of a hash is BLOCK. */
  message?: { kind: "personal_sign" | "eth_sign"; data: string; origin?: string; from?: string } | Record<string, unknown>;
  /** 0.7.1: the site or app asking for the signature (https://...), checked against a Sign-In with Ethereum domain. */
  origin?: string;
  /** 0.7.1: the wallet request as the agent would send it: {method, params} (personal_sign, eth_sign, eth_signTypedData_v4, eth_sendTransaction). */
  rpc?: { method: string; params?: unknown[] } | Record<string, unknown>;
  /** 0.7.1: an ERC-4337 user operation (v0.6, v0.7 packed or unpacked, v0.8); its calls are opened and each checked. */
  userOp?: Record<string, unknown>;
  /** 0.7.1: the userOp's EntryPoint address (0x + 40 hex). */
  entryPoint?: string;
  /** 0.7.1: what the agent means to do ({action, recipient, ...}); an effect that does not match it is flagged. */
  intent?: Record<string, unknown>;
  /** An x402 payment: the PaymentRequired the 402 sent (with accepts), or one accepts entry; optional payment and resource. */
  x402?: Record<string, unknown>;
  /** The x402 seller's ERC-8004 agent id, when known. */
  agentId?: number | string;
  /** The identity registry agentId is in, CAIP-10 (default eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432). */
  registry?: string;
  /** Strict payee policy: an x402 payTo not verified as the seller's (ERC-8478) is BLOCK instead of a warning. */
  strict?: boolean;
  /**
   * Ask for a single-use ALLOW ticket for this exact call: `true` (scope "call", any consumer) or {consumer?, scope?}.
   * It comes back in the RiskAssessment's x-toll.ticket (CheckTxResult.ticket): signed, or {why} none was issued.
   * A BLOCK is never signed; no ticket without `from`. Same option as @tollxyz/guard 0.4.1.
   */
  ticket?: boolean | TicketAsk;
}

/** What to ask Toll for: `true` = scope "call", any consumer (same shape as @tollxyz/guard). */
export interface TicketAsk {
  /** The contract that will check the ticket (its `consumer` field); unset = any contract. */
  consumer?: string;
  /** "call" (default): bound to (target, value, keccak256(data)); "v4swap": bound to the swap a HookrRouter call makes. */
  scope?: "call" | "v4swap";
}

/** The ticket as Toll returns it (x-toll.ticket.ticket); uint64 times are unix seconds. */
export interface AllowTicket {
  scope: number;
  verdict: number;
  account: string;
  consumer: string;
  subject: string;
  validAfter: number | bigint | string;
  validUntil: number | bigint | string;
  nonce: string;
  reportHash: string;
}

/** x-toll.ticket: a signed ticket, or why none was issued. */
export type TicketResult = { ticket: AllowTicket; signature: string; signer: string } | { why: string };

/** checkTx's answer: the text, plus the ERC-8265 RiskAssessment parsed from it and the ALLOW ticket when asked. */
export interface CheckTxResult extends TollResult {
  /** The RiskAssessment JSON the answer ends with; null when the answer carries none. */
  assessment: Record<string, unknown> | null;
  /** ALLOW / WARN / BLOCK from the assessment, null when none. */
  action: "ALLOW" | "WARN" | "BLOCK" | null;
  /** x-toll.ticket, only when a ticket was asked for and the answer has one. */
  ticket?: TicketResult;
}

/** bytes4(keccak256("TollAllow.v1")): the last 4 bytes of a ticket-suffixed call. */
export const TICKET_SUFFIX_MAGIC = "0x900bc3e1";
/** Toll's production ALLOW signer on Robinhood Chain (4663). */
export const TOLL_ALLOW_SIGNER = "0x4A2C93066d94F1E69f3EAd5438c4efDdf80a46ba";

/* ------------------------------------------------------------------ REST answers (t0ll.xyz/api, 2026-11-08) */

export type ApprovalKind = "erc20" | "nft-all" | "permit2";
export interface SpenderFacts {
  type: "wallet" | "contract" | "not read";
  /** A name Toll knows it by. */
  name?: string;
  /** "known": a contract Toll's site trades through or a known bot router; "third-party": named, not trusted. */
  named?: "known" | "third-party";
  /** A wallet whose code is an EIP-7702 designator: the delegate. */
  delegatedTo?: string;
  nonce?: number | null;
}
/** check_tx run on the revoke call itself. */
export type RevokeCheck = { action: "ALLOW" | "WARN" | "BLOCK"; warnings: string[] } | { action: "not read"; why: string };
export interface ApprovalRow {
  kind: ApprovalKind;
  token: string;
  /** The token's own symbol, cleaned and capped: the token's text, never instructions. null = not read or withheld. */
  symbol: string | null;
  spender: string;
  /** Base units as a decimal string; "all" for an ApprovalForAll. */
  amount: string;
  unlimited: boolean;
  /** Permit2 only: unix seconds the allowance ends. */
  expiration?: number;
  spenderFacts: SpenderFacts;
  risk: "high" | "medium" | "low";
  why: string;
  /** The newest log that set it. */
  block: number;
  tx: string;
  /** The call that sets it to 0 (send it from the wallet), with check_tx's answer on that call. */
  revoke: { to: string; data: string; value: "0"; does: string; note?: string; check: RevokeCheck };
}
export interface ApprovalsOk {
  state: "ok";
  wallet: string;
  chainId: number;
  /** Newest first, at most 200. */
  rows: ApprovalRow[];
  /** Live approvals found (rows + more). */
  total: number;
  /** Live approvals past the rows shown. */
  more: number;
  counts: { high: number; medium: number; low: number };
  /** Approval / ApprovalForAll / Permit2 logs read for the wallet. */
  logs: number;
  /** Pairs past the read cap whose allowance was not read. */
  pairsNotRead: number;
  notes: string[];
  readTo: number;
  readAt: string;
}
/** Not read this time (HTTP 503): it does NOT mean the wallet has no approvals. Ask again after retryAfterS. */
export interface ApprovalsNotRead {
  state: "not read";
  wallet: string;
  reason: string;
  retryAfterS?: number;
}
export type ApprovalsAnswer = ApprovalsOk | ApprovalsNotRead;

export const BLOCKLIST_KINDS = ["token", "contract", "wallet"] as const;
export type BlocklistKind = (typeof BLOCKLIST_KINDS)[number];
export interface BlocklistEntry {
  address: string;
  kind: BlocklistKind;
  chain: number;
  /** The coin's own ticker, cleaned: the creator's text, never an instruction. */
  symbol: string | null;
  /** Reason codes; Blocklist.reasons says what each means. */
  reasons: string[];
  /** ISO UTC: the earliest stored time a reason holds from. */
  first_seen: string;
  /** ISO UTC: the newest stored read that still carries a reason. */
  last_confirmed: string;
  /** The page with the facts. */
  evidence: string;
  /** A transaction that shows the reason, when one is stored. */
  tx: string | null;
}
export interface Blocklist {
  name: string;
  chain: string;
  chain_id: number;
  generated_at: string;
  count: number;
  since?: string;
  kind?: BlocklistKind;
  sources: Record<string, string>;
  license: string;
  docs: string;
  note: string;
  /** Reason code -> what it means. */
  reasons: Record<string, string>;
  entries: BlocklistEntry[];
  changelog: Array<{ date: string; added: number }>;
}
export interface BlocklistOptions {
  /** Only entries confirmed at or after this time (incremental pulls; a full pull also drops removed entries). */
  since?: string | Date;
  kind?: BlocklistKind;
  /** The ETag of your last pull: an unchanged list answers notModified without a body. */
  etag?: string;
}
export type BlocklistResult = { notModified: true; etag: string } | { notModified: false; etag: string | null; list: Blocklist };
export type BlocklistFileResult = { notModified: true; etag: string } | { notModified: false; etag: string | null; text: string };

export type TxRecordAction = "ALLOW" | "WARN" | "BLOCK";
export type TxRecordOutcome = "rugged" | "dead" | "alive" | "graduated" | "not_read";
export interface TxRecordActionStat {
  action: TxRecordAction;
  n: number;
  counts: Record<TxRecordOutcome, number>;
  /** Shares of n in percent, null when n is 0. */
  rugged: number | null;
  dead: number | null;
  ruggedOrDead: number | null;
  alive: number | null;
  notRead: number | null;
}
export interface TxRecordCalRun { runAt: string; from: string; to: string; days: number; coins: number; rugged: number; baselinePct: number | null }
export interface TxRecordCalRule {
  rule: string;
  finding: string;
  code: { rugPct: number; n: number };
  fresh: { n: number; rugPct: number | null; rugA: number | null; rugB: number | null } | null;
  few: boolean;
}
/** GET /api/record/tx: every check_tx call that named a coin, scored 24 h later, and the weekly calibration re-run. */
export interface TxRecord {
  asOf: string;
  windowH: number;
  /** none = nothing logged yet; waiting = logged, none scored yet; live = scored calls exist. */
  state: "none" | "waiting" | "live";
  logged: number;
  scored: number;
  pending: number;
  firstAt: string | null;
  newestScored: string | null;
  firstScoresOn: string | null;
  actions: TxRecordActionStat[];
  weekly: Array<{ week: string; by: Record<TxRecordAction, { n: number; rugged: number | null; ruggedOrDead: number | null }> }>;
  latest: Array<{ token: string; sym: string | null; role: "bought" | "approved"; action: TxRecordAction; codes: string[]; at: string; outcome: TxRecordOutcome }>;
  calibration: { blockAtPct: number; codeDate: string; codeWindow: string; latest: TxRecordCalRun | null; rules: TxRecordCalRule[]; runs: TxRecordCalRun[] };
  page: string;
  note: string;
}

/** The events a coin watch sends. */
export const COIN_WATCH_EVENTS = ["verdict_changed", "new_against", "dev_sold", "cluster_sold"] as const;
/** The events a wallet watch sends. */
export const WALLET_WATCH_EVENTS = ["approval", "delegation", "risky_token_in"] as const;
export type CoinWatchEventName = (typeof COIN_WATCH_EVENTS)[number];
export type WalletWatchEventName = (typeof WALLET_WATCH_EVENTS)[number];

/** One watch as GET /api/watch or /api/watch/wallet lists it (never the secret). */
export interface WatchRow {
  id: string;
  /** Coin watches. */
  token?: string;
  /** Wallet watches. */
  address?: string;
  url: string;
  paused?: boolean;
  fails?: number;
  checked_at?: string | null;
  [key: string]: unknown;
}
export interface WatchList { watches: WatchRow[]; cap: number; docs?: string }
/** POST /api/watch(/wallet): `secret` only when the watch is new (HTTP 201); keep it, it signs every event. */
export interface WatchAdded {
  id: string;
  token?: string;
  address?: string;
  url: string;
  cap: number;
  events: string[];
  signature: string;
  secret?: string;
  note: string;
  /** true when HTTP 201 (a new watch, secret included). */
  created: boolean;
}

/** The JSON a coin watch POSTs (type "toll.watch"). */
export interface CoinWatchEvent {
  type: "toll.watch";
  event: CoinWatchEventName;
  events: CoinWatchEventName[];
  watch_id: string;
  token: string;
  chain: "rh";
  verdict: { before: string | null; now: string | null };
  new_against: unknown[];
  sold?: { dev?: { before: number; now: number; of?: unknown; wallet?: string }; groups?: Array<{ group: unknown; label: string; before: number; now: number }> };
  check_url: string;
  at: string;
}
/** The JSON a wallet watch POSTs (type "toll.wallet_watch"). */
export interface WalletWatchEvent {
  type: "toll.wallet_watch";
  event: WalletWatchEventName;
  events: Array<
    | { type: "approval"; token: string; spender: string; amount: string; kind: ApprovalKind; tx: string; block: number }
    | { type: "delegation"; delegate: string; previous: string | null; block: number }
    | { type: "risky_token_in"; token: string; amount: string; from: string; verdict: string; tx: string; block: number; check_url: string }
  >;
  more: number;
  watch_id: string;
  address: string;
  chain: "rh";
  blocks: { from: number; to: number };
  at: string;
}
export type WatchEvent = CoinWatchEvent | WalletWatchEvent;

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

/** pre_buy_check's one word (https://t0ll.xyz/mcp, 2026-11-06): BLOCK / WARN / ALLOW / WAIT; null when the answer has none. */
export type PreBuyDecision = "BLOCK" | "WARN" | "ALLOW" | "WAIT";
export interface PreBuyResult extends TollResult {
  /** The first line's word; null on an error-free answer without one (for example past the free coins). */
  decision: PreBuyDecision | null;
}
/** check_coins takes 1 to 20 addresses. */
export const CHECK_COINS_MAX = 20;

export interface TollResult {
  /** The markdown text the server answered with. */
  text: string;
  /** The paid x402 URL for this coin when the free quota is used up, else null. */
  paidUrl: string | null;
  /** Set when part of the answer is still being read: ask again after retryAfterS seconds. */
  pending: { retryAfterS: number } | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/* ------------------------------------------------------------------ the x402 facilitator (x402.t0ll.xyz) */

/** Toll's x402 facilitator: keyless, USDG on Robinhood Chain (also served at https://t0ll.xyz/api/facilitator). */
export const TOLL_FACILITATOR = "https://x402.t0ll.xyz";

/** toll-screen: check_tx's word on the payment being verified or settled; "not-read" = not read in time (never a refusal). */
export type ScreenOutcome = "allow" | "warn" | "block" | "not-read";
/** extensions.screen of every /verify and /settle answer of Toll's facilitator, for the seller. */
export interface FacilitatorScreen {
  outcome: ScreenOutcome;
  /** check_tx's reason codes, empty when there are none */
  codes: string[];
}
/** The extensions a Toll facilitator answer carries (each one optional: older answers or another facilitator). */
export interface FacilitatorExtensions {
  /** ERC-8478: whether payTo is the agentWallet the seller's ERC-8004 identity registered */
  erc8478?: Record<string, unknown>;
  /** toll-receipt: Toll's signed EIP-712 receipt (settle only; null when nothing settled) */
  receipt?: Record<string, unknown> | null;
  /** toll-screen */
  screen?: FacilitatorScreen;
  /** the offer-receipt helper (settle only, when the payment carried extensions["offer-receipt"]); see tollOfferReceiptOf */
  "toll-offer-receipt"?: TollOfferReceipt;
  [key: string]: unknown;
}
/** POST /verify's answer. */
export interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: FacilitatorExtensions;
}
/** POST /settle's answer (amount: what an upto payment actually charged). */
export interface FacilitatorSettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  transaction: string;
  network: string;
  payer?: string;
  amount?: string;
  extensions?: FacilitatorExtensions;
}

const SCREEN_OUTCOMES: readonly string[] = ["allow", "warn", "block", "not-read"];
/** extensions.screen of a facilitator answer (verify or settle), checked; null when absent or malformed. */
export function screenOf(answer: unknown): FacilitatorScreen | null {
  const ext = isObject(answer) ? answer.extensions : null;
  const s = isObject(ext) ? ext.screen : null;
  if (!isObject(s) || typeof s.outcome !== "string" || !SCREEN_OUTCOMES.includes(s.outcome)) return null;
  const codes = Array.isArray(s.codes) ? s.codes.filter((c): c is string => typeof c === "string") : [];
  return { outcome: s.outcome as ScreenOutcome, codes };
}

/** Who sells a discovered resource: one row per operator unless the query names it. */
export interface DiscoveryOperator {
  key: string;
  label: string;
  entries: number;
}
/** One paid API in the facilitator's discovery catalog (the x402 v2 bazaar item plus Toll's fields). */
export interface PaidApi {
  /** the resource URL (an MCP server URL when type is "mcp") */
  resource: string;
  /** "http" or "mcp" */
  type: string;
  x402Version: number;
  /** what it accepts: network, amount, asset, payTo, extra */
  accepts: Array<Record<string, unknown>>;
  lastUpdated?: string;
  /** payTo is the agentWallet its ERC-8004 identity registered (ERC-8478); not a word on whether it delivers */
  verified: boolean;
  /** payments settled through Toll's facilitator */
  settledViaToll: number;
  /** "census" (the agent census) or "bazaar" (recorded from a payment settled with the bazaar extension) */
  source?: string;
  payTo: string | null;
  /** "0.05 USDG" */
  price: string | null;
  name: string | null;
  agentId: number | null;
  operator: DiscoveryOperator | null;
  [key: string]: unknown;
}
export interface FindPaidApisOptions {
  /** what to buy, in a few words ("weather", "stock quotes"): given = /discovery/search, else /discovery/resources */
  query?: string;
  /** "http" or "mcp" */
  type?: "http" | "mcp";
  /** only resources that pay this wallet */
  payTo?: string;
  /** only this operator's resources (an operator key from a listing, for example "agent:8654") */
  operator?: string;
  /** 1 to 100 */
  limit?: number;
  /** skip this many (the list only) */
  offset?: number;
}
export interface PaidApiList {
  x402Version: number;
  items: PaidApi[];
  /** the list: { limit, offset, total }; search: null */
  pagination: { limit: number; offset?: number; total?: number; cursor?: string | null } | null;
  /** search only: true when more matches were left out */
  partialResults?: boolean;
}

/* ------------------------------------------------------------------ paid before (GET /paid), for sign-in-with-x sellers */

/** One earlier payment: transaction (null for a batch charge), unix seconds, base units, Toll's receipt id, how it was paid. */
export interface PaidEntry {
  tx: string | null;
  ts: number;
  amount: string;
  receiptId: string;
  via: "settlement" | "escrow" | "batch";
}
/** A source count, or why it was not counted ("not-read": its table could not be read; "not-applicable": batch with a resource). */
export type PaidSource = number | "not-read" | "not-applicable";
/** GET /paid's answer: whether the payer already paid this payTo through Toll's facilitator. Facts already public on chain. */
export interface PaidAnswer {
  paid: boolean;
  /** payments found (each source reads at most 1,000 rows) */
  count: number;
  /** the latest one, or null */
  last: PaidEntry | null;
  network: string;
  sources: { settlements: number; escrow: PaidSource; batch: PaidSource };
}
export interface PaidBeforeOptions {
  /** the wallet that proved it is the caller (sign-in-with-x) */
  payer: string;
  /** the wallet the seller is paid at */
  payTo: string;
  /** only payments for this resource URL, exactly as the payment named it */
  resource?: string;
  /** only payments after this time: unix seconds, or a Date */
  since?: number | Date;
}

/* ------------------------------------------------------------------ the x402 offer-receipt extension (seller-signed receipts) */

/** The x402 offer-receipt spec's receipt payload (v1): what the seller signs once it has delivered. */
export interface ReceiptPayload {
  version: number;
  /** CAIP-2, "eip155:4663" */
  network: string;
  resourceUrl: string;
  payer: string;
  /** unix seconds */
  issuedAt: number;
  /** the settlement transaction, or "" (the spec's privacy-minimal form) */
  transaction: string;
}
/** What Toll's facilitator read from the seller's signed offer the payment carried (facts, never a refusal). */
export type OfferFacts =
  | { read: "ok"; format: "eip712"; signer: string; signerIsPayTo: boolean; amount: string; amountMatches: boolean; resourceMatches: boolean; validUntil: number; expired: boolean }
  | { read: "none" | "no-match" | "invalid" }
  | { read: "unsupported"; format: string };
/**
 * extensions["toll-offer-receipt"] of a settle answer (only when the payment carried extensions["offer-receipt"]):
 * the offer check, and the receipt payload for the seller to sign (null when nothing settled).
 */
export interface TollOfferReceipt {
  offer: OfferFacts;
  receiptPayload: ReceiptPayload | null;
}
/** GET /receipt/<id|tx>'s offerReceipt on a settled row: the payload, the domain to sign it under, and who signs it. */
export interface ReceiptRowOfferReceipt {
  payload: ReceiptPayload;
  domain: { name: string; version: string; chainId: number };
  /** "the resource server": Toll never signs the spec's receipt */
  signer: string;
}
/** The spec's signed receipt, as the seller returns it in extensions["offer-receipt"].info.receipt. */
export interface SignedReceipt {
  format: "eip712";
  payload: ReceiptPayload;
  signature: string;
}

/** The offer-receipt spec's EIP-712 receipt domain (chainId 1 by the spec, whatever the payment network). */
export const RECEIPT_DOMAIN = { name: "x402 receipt", version: "1", chainId: 1 } as const;
/** The spec's canonical receipt types (v1). */
export const RECEIPT_TYPES = {
  Receipt: [
    { name: "version", type: "uint256" },
    { name: "network", type: "string" },
    { name: "resourceUrl", type: "string" },
    { name: "payer", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "transaction", type: "string" },
  ],
} as const;

/* ------------------------------------------------------------------ per-payer budgets (POST/GET /budget), coming */

/** A day cap for one payTo, USDG base units. */
export interface PayToCap {
  payTo: string;
  perDay: bigint | number | string;
}
/**
 * A payer's spending limits with Toll's facilitator, in USDG base units (6 decimals). perPayment and perDay always
 * apply (0 = nothing passes); perPayTo 0 = not set; payToCaps a day cap per payTo (at most 50); allowedPayTos empty =
 * any (at most 50); validUntil unix seconds, 0 = no end; days are UTC. A newer nonce replaces the stored budget.
 */
export interface BudgetInput {
  payer: string;
  perPayment: bigint | number | string;
  perDay: bigint | number | string;
  perPayTo?: bigint | number | string;
  payToCaps?: PayToCap[];
  allowedPayTos?: string[];
  validUntil?: bigint | number | string;
  nonce: bigint | number | string;
}
/** EIP-712 typed data, ready for viem's signTypedData / ethers' signer.signTypedData (uint fields as bigint). */
export interface TypedData<M> {
  domain: { name: string; version: string; chainId: number };
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: M;
}
export interface BudgetMessage {
  payer: string;
  perPayment: bigint;
  perDay: bigint;
  perPayTo: bigint;
  payToCaps: Array<{ payTo: string; perDay: bigint }>;
  allowedPayTos: string[];
  validUntil: bigint;
  nonce: bigint;
}
/** GET /budget?payer=: the stored budget (decimal strings) and today's (UTC) spend. */
export interface BudgetState {
  payer: string;
  network: string;
  day: string;
  budget: {
    perPayment: string;
    perDay: string;
    perPayTo: string;
    payToCaps: Array<{ payTo: string; perDay: string }>;
    allowedPayTos: string[];
    validUntil: string;
    nonce: string;
    revoked: boolean;
  } | null;
  spentToday: string;
  spentByPayTo: Record<string, string>;
  /** null without a budget; "0" once revoked, expired or spent */
  remainingToday: string | null;
}
/** POST /budget's answer. */
export interface BudgetSetAnswer {
  ok: true;
  payer: string;
  nonce: string;
  revoked: boolean;
}

/** The budget's EIP-712 domain: no verifyingContract (nothing on chain checks it). */
export const BUDGET_DOMAIN = { name: "Toll Facilitator Budget", version: "1", chainId: 4663 } as const;
export const BUDGET_TYPES = {
  Budget: [
    { name: "payer", type: "address" },
    { name: "perPayment", type: "uint256" },
    { name: "perDay", type: "uint256" },
    { name: "perPayTo", type: "uint256" },
    { name: "payToCaps", type: "PayToCap[]" },
    { name: "allowedPayTos", type: "address[]" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
  PayToCap: [
    { name: "payTo", type: "address" },
    { name: "perDay", type: "uint256" },
  ],
} as const;
export const REVOKE_TYPES = {
  Revoke: [
    { name: "payer", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
/** At most this many payToCaps and allowedPayTos. */
export const BUDGET_MAX_PAYTOS = 50;

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
  /**
   * The x402 facilitator findPaidApis() reads. Default: https://x402.t0ll.xyz with the default baseUrl, else
   * `${baseUrl}/api/facilitator`.
   */
  facilitatorUrl?: string;
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

/** a find-paid-API query: trimmed, at most 200 characters; empty = none */
function assertQuery(query: unknown): string {
  if (query === undefined || query === null) return "";
  if (typeof query !== "string") throw new TollError("Invalid query: use a few words of text.");
  const q = query.trim();
  if (q.length > 200) throw new TollError("Invalid query: at most 200 characters.");
  return q;
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
  private readonly facilitatorUrl: string;
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
    this.facilitatorUrl = (opts.facilitatorUrl ?? (this.baseUrl === "https://t0ll.xyz" ? TOLL_FACILITATOR : `${this.baseUrl}/api/facilitator`)).replace(/\/+$/, "");
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
   * One call before a buy: Decision BLOCK / WARN / ALLOW / WAIT with up to 3 reasons, on the same calibrated rules as
   * checkTx. On WAIT, `pending.retryAfterS` says when to ask again. ALLOW is never a promise.
   */
  async preBuyCheck(address: string): Promise<PreBuyResult> {
    assertAddress(address);
    const r = await this.call("pre_buy_check", { address });
    const m = /^Decision: (BLOCK|WARN|ALLOW|WAIT)$/m.exec(r.text);
    const decision = (m?.[1] ?? null) as PreBuyDecision | null;
    return { ...r, decision, pending: decision === "WAIT" ? (r.pending ?? parsePending(r.text)) : r.pending };
  }

  /** Up to 20 coins from the checks Toll already holds: a verdict word each, or "not read yet". Reads nothing new, free. */
  async checkCoins(addresses: string[]): Promise<TollResult> {
    if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > CHECK_COINS_MAX) {
      throw new TollError(`checkCoins takes 1 to ${CHECK_COINS_MAX} addresses.`);
    }
    return this.call("check_coins", { addresses: addresses.map(String) });
  }

  /** The JSON a watch tool answered (the text before its Docs line), or null. */
  private watchData(r: TollResult): Record<string, unknown> | null {
    try { return JSON.parse(r.text.split("\n\nDocs:")[0]) as Record<string, unknown>; } catch { return null; }
  }

  private needKey(what: string): void {
    if (!this.tollKey) throw new TollError(`${what} needs a Toll key: new Toll({ tollKey }) with a key from https://t0ll.xyz/toll#keys.`);
  }

  /**
   * Watch a coin: Toll re-reads it about every 10 minutes and POSTs a signed JSON event to `url` (public https) when
   * its verdict word changes or a new finding against appears. `data.secret` (first time only) signs every event:
   * x-toll-signature = sha256=<hex HMAC-SHA256(secret, raw body)>. Needs a Toll key; the cap is the key's tier.
   */
  async watchCoin(address: string, url: string): Promise<TollResult & { data: Record<string, unknown> | null }> {
    assertAddress(address);
    this.needKey("watchCoin");
    const r = await this.call("watch_coin", { address, url: String(url) });
    return { ...r, data: this.watchData(r) };
  }

  /** The coins this Toll key's wallet watches (never the secret). */
  async myWatches(): Promise<TollResult & { data: Record<string, unknown> | null }> {
    this.needKey("myWatches");
    const r = await this.call("my_watches", {});
    return { ...r, data: this.watchData(r) };
  }

  /** Remove one watch by its id (from myWatches). */
  async unwatchCoin(id: string): Promise<TollResult & { data: Record<string, unknown> | null }> {
    this.needKey("unwatchCoin");
    const r = await this.call("unwatch_coin", { id: String(id) });
    return { ...r, data: this.watchData(r) };
  }

  /**
   * Watch a wallet over MCP: Toll reads it about once a minute and POSTs a signed JSON event to `url` on a new approval,
   * a new EIP-7702 delegation or a token received whose check is against. `data.secret` comes back the first time only.
   * Needs a Toll key; wallet watches have their own cap (the key's tier).
   */
  async watchWallet(address: string, url: string): Promise<TollResult & { data: Record<string, unknown> | null }> {
    assertWallet(address);
    this.needKey("watchWallet");
    const r = await this.call("watch_wallet", { address, url: String(url) });
    return { ...r, data: this.watchData(r) };
  }

  /** Remove one wallet watch by its id (from myWatches' wallet_watches). */
  async unwatchWallet(id: string): Promise<TollResult & { data: Record<string, unknown> | null }> {
    this.needKey("unwatchWallet");
    const r = await this.call("unwatch_wallet", { id: String(id) });
    return { ...r, data: this.watchData(r) };
  }

  /**
   * A wallet's live token approvals on Robinhood Chain (ERC-20, NFT approval-for-all, Permit2) as text, over MCP: each
   * with its risk and the revoke call checked by check_tx. For the typed JSON use approvals().
   */
  async walletApprovals(wallet: string): Promise<TollResult> {
    assertWallet(wallet);
    return this.call("wallet_approvals", { wallet });
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
  /**
   * find_paid_api: paid APIs (x402) an agent can buy on Robinhood Chain, by what it needs ("weather", "stock quotes", or
   * nothing for every operator's best endpoint), verified payTo first. The answer as text; findPaidApis() for the JSON.
   */
  async findPaidApi(opts: { query?: string; limit?: number } = {}): Promise<TollResult> {
    const query = assertQuery(opts.query);
    assertLimit(opts.limit, 20);
    return this.call("find_paid_api", { ...(query ? { query } : {}), ...(opts.limit !== undefined ? { limit: opts.limit } : {}) });
  }

  async checkHook(address: string): Promise<TollResult> {
    assertAddress(address, "hook address");
    return this.call("check_hook", { address });
  }

  /**
   * Pre-sign check on Robinhood Chain: ALLOW / WARN / BLOCK with the reasons (an ERC-8265 RiskAssessment), for a
   * transaction (to, data, value, from; authorizationList for a type-4 one), an EIP-712 signature (typedData), a message
   * to sign (message, origin), the wallet request as sent (rpc), an ERC-4337 user operation (userOp, entryPoint) or an
   * x402 payment (x402).
   */
  async checkTx(req: CheckTxRequest): Promise<CheckTxResult> {
    // every kind of request the live check_tx reads (0.7.1): a transaction, a signature, a payment, an EIP-7702
    // authorization list (alone is a signAuthorization), a message to sign, the wallet request as sent, a user operation
    const has = isObject(req) && (req.to !== undefined || req.typedData !== undefined || req.x402 !== undefined
      || (Array.isArray(req.authorizationList) && req.authorizationList.length > 0) || isObject(req.message) || isObject(req.rpc) || isObject(req.userOp));
    if (!has) {
      throw new TollError("checkTx needs a transaction (to, data, value, from), typedData, x402, authorizationList, message, rpc or userOp.");
    }
    if (req.chainId !== undefined && String(req.chainId) !== "4663" && String(req.chainId).toLowerCase() !== "0x1237") {
      throw new TollError(`Invalid chainId "${req.chainId}": ${RH_ONLY} (chain id 4663)`);
    }
    const { ticket, ...rest } = req;
    const ask = ticketAskOf(ticket as CheckTxRequest["ticket"]);
    if (ask?.consumer !== undefined && !isValidAddress(ask.consumer)) throw new TollError("Invalid ticket.consumer: expected 0x + 40 hex characters.");
    if (ask?.scope !== undefined && ask.scope !== "call" && ask.scope !== "v4swap") throw new TollError('Invalid ticket.scope: use "call" or "v4swap".');
    const r = await this.call("check_tx", ask ? { ...rest, ticket: ask } : { ...rest });
    const assessment = assessmentOf(r.text);
    const a = assessment?.action;
    const tk = ticketOfAnswer(assessment);
    return { ...r, assessment, action: a === "ALLOW" || a === "WARN" || a === "BLOCK" ? a : null, ...(tk ? { ticket: tk } : {}) };
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

  /* -------------------------------------------------------------- REST (t0ll.xyz/api) */

  private restHeaders(auth: boolean, extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/json",
      "x-toll-client": this.clientId,
      ...(auth && this.tollKey ? { authorization: `Bearer ${this.tollKey}` } : {}),
      ...extra,
    };
  }

  private async rest(method: "GET" | "POST" | "DELETE", path: string, opts: { auth?: boolean; body?: unknown; headers?: Record<string, string> } = {}) {
    return this.request(`${this.baseUrl}${path}`, {
      method,
      headers: this.restHeaders(!!opts.auth, { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...(opts.headers ?? {}) }),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  }

  /**
   * GET /api/approvals/{wallet}: the wallet's live approvals on Robinhood Chain (ERC-20, NFT approval-for-all, Permit2),
   * newest first (at most 200, `more` counts the rest), each with its risk and a revoke call checked by check_tx.
   * `state: "not read"` (HTTP 503) means the logs could not be read this time, never that there are none: ask again
   * after retryAfterS. Throws TollError on a bad address, a rate limit (6 a minute) or when the list is unavailable.
   */
  async approvals(wallet: string): Promise<ApprovalsAnswer> {
    assertWallet(wallet);
    const { res, raw } = await this.rest("GET", `/api/approvals/${wallet.toLowerCase()}`);
    const json = tryJson(raw);
    if (res.ok && json?.state === "ok") return json as ApprovalsOk;
    if (json?.state === "not read") {
      const s = retryAfterOf(res);
      return { ...(json as ApprovalsNotRead), ...(s !== undefined ? { retryAfterS: s } : {}) };
    }
    throw restError(res, raw);
  }

  /** GET /api/approvals/{wallet}?format=text: the same list as plain lines ending with a t0ll.xyz link (also when not read). */
  async approvalsText(wallet: string): Promise<string> {
    assertWallet(wallet);
    const { res, raw } = await this.rest("GET", `/api/approvals/${wallet.toLowerCase()}?format=text`, { headers: { accept: "text/plain" } });
    if (res.ok || (res.status === 503 && /^Approvals of /.test(raw))) return raw;
    throw restError(res, raw);
  }

  private blocklistQuery(format: string | null, opts: BlocklistOptions): string {
    const q = new URLSearchParams();
    if (format) q.set("format", format);
    if (opts.since !== undefined) {
      const ms = opts.since instanceof Date ? opts.since.getTime() : Date.parse(String(opts.since));
      if (!Number.isFinite(ms)) throw new TollError("Invalid since: use a Date or an ISO time, e.g. 2026-11-08T00:00:00Z.");
      q.set("since", new Date(ms).toISOString());
    }
    if (opts.kind !== undefined) {
      if (!(BLOCKLIST_KINDS as readonly string[]).includes(opts.kind)) throw new TollError("Invalid kind: use token, contract or wallet.");
      q.set("kind", opts.kind);
    }
    const s = q.toString();
    return `/api/blocklist${s ? `?${s}` : ""}`;
  }

  /**
   * GET /api/blocklist: Toll's open Robinhood Chain blocklist (free, no key, open license with attribution). Each entry
   * names its reasons and the page with the facts. A coin that is not listed is not cleared. Pass `etag` from the last
   * pull to get `{ notModified: true }` when nothing changed; `since` for an incremental pull.
   */
  async blocklist(opts: BlocklistOptions = {}): Promise<BlocklistResult> {
    const path = this.blocklistQuery(null, opts);
    const { res, raw } = await this.rest("GET", path, { headers: opts.etag ? { "if-none-match": opts.etag } : {} });
    const etag = res.headers.get("etag");
    if (res.status === 304) return { notModified: true, etag: etag ?? opts.etag ?? "" };
    if (!res.ok) throw restError(res, raw);
    const list = tryJson(raw);
    if (!isObject(list) || !Array.isArray(list.entries)) throw new TollError("The blocklist answer was not the expected JSON.", { status: res.status });
    return { notModified: false, etag, list: list as unknown as Blocklist };
  }

  /** The blocklist as CSV (address,kind,reasons,first_seen,last_confirmed,evidence,tx,chain_id) or TXT (one address a line). */
  async blocklistFile(format: "csv" | "txt", opts: BlocklistOptions = {}): Promise<BlocklistFileResult> {
    if (format !== "csv" && format !== "txt") throw new TollError("Invalid format: use csv or txt (blocklist() returns the JSON).");
    const path = this.blocklistQuery(format, opts);
    const { res, raw } = await this.rest("GET", path, { headers: { accept: format === "csv" ? "text/csv" : "text/plain", ...(opts.etag ? { "if-none-match": opts.etag } : {}) } });
    const etag = res.headers.get("etag");
    if (res.status === 304) return { notModified: true, etag: etag ?? opts.etag ?? "" };
    if (!res.ok) throw restError(res, raw);
    return { notModified: false, etag, text: raw };
  }

  /**
   * GET /api/record/tx: the pre-sign record. Every check_tx call that named a coin, scored by how the coin stood 24 h
   * later (by action: rugged, dead, alive, not read), the weekly trend, the latest scored calls (never a wallet) and
   * the coin check's calibration re-run weekly beside the figures in code. Same numbers as t0ll.xyz/agents/record.
   */
  async txRecord(): Promise<TxRecord> {
    const { res, raw } = await this.rest("GET", "/api/record/tx");
    const json = tryJson(raw);
    if (!res.ok || !isObject(json) || !Array.isArray(json.actions)) throw restError(res, raw);
    return json as unknown as TxRecord;
  }

  /**
   * The facilitator's discovery catalog (x402 bazaar): GET /discovery/search?query= when `query` is given, else
   * GET /discovery/resources. Each item: resource, accepts, price, payTo, verified (payTo is its ERC-8004 agentWallet,
   * ERC-8478), settledViaToll, name, agentId, operator. Facts, not a recommendation: verified does not say it delivers.
   */
  async findPaidApis(opts: FindPaidApisOptions = {}): Promise<PaidApiList> {
    const query = assertQuery(opts.query);
    if (opts.type !== undefined && opts.type !== "http" && opts.type !== "mcp") throw new TollError('Invalid type: use "http" or "mcp".');
    if (opts.payTo !== undefined && !EVM.test(String(opts.payTo))) throw new TollError("Invalid payTo: expected 0x + 40 hex characters.");
    if (opts.operator !== undefined && (typeof opts.operator !== "string" || !/^[\x21-\x7e]{1,128}$/.test(opts.operator))) {
      throw new TollError("Invalid operator: use an operator key from a listing (for example agent:8654).");
    }
    assertLimit(opts.limit, 100);
    if (opts.offset !== undefined && (!Number.isInteger(opts.offset) || opts.offset < 0)) throw new TollError("Invalid offset: use a whole number from 0.");
    if (query && opts.offset) throw new TollError("Invalid offset: offset pages the list only, leave it out with query.");
    const q = new URLSearchParams();
    if (query) q.set("query", query);
    if (opts.type) q.set("type", opts.type);
    if (opts.payTo) q.set("payTo", opts.payTo.toLowerCase());
    if (opts.operator) q.set("operator", opts.operator);
    if (opts.limit !== undefined) q.set("limit", String(opts.limit));
    if (!query && opts.offset !== undefined) q.set("offset", String(opts.offset));
    const s = q.toString();
    const url = `${this.facilitatorUrl}/discovery/${query ? "search" : "resources"}${s ? `?${s}` : ""}`;
    const { res, raw } = await this.request(url, { method: "GET", headers: this.restHeaders(false) });
    const json = tryJson(raw);
    const items: unknown = isObject(json) ? (query ? json.resources : json.items) : null;
    if (!res.ok || !Array.isArray(items)) throw restError(res, raw);
    const p = json.pagination;
    return {
      x402Version: typeof json.x402Version === "number" ? json.x402Version : 2,
      items: items.filter(isObject) as PaidApi[],
      pagination: isObject(p) ? (p as PaidApiList["pagination"]) : null,
      ...(typeof json.partialResults === "boolean" ? { partialResults: json.partialResults } : {}),
    };
  }

  /**
   * GET /paid on the facilitator: whether `payer` already paid `payTo` through Toll's facilitator (settlements, escrow
   * captures, batch charges), optionally for one resource and after `since`. For sellers using sign-in-with-x: once a
   * wallet has proved it is the caller, a returning payer can be let in without a second charge. Facts already public on
   * chain (transaction, time, amount, receipt id). A 503 (the record could not be read) throws: never a false "not paid".
   */
  async paidBefore(opts: PaidBeforeOptions): Promise<PaidAnswer> {
    if (!isObject(opts)) throw new TollError("Invalid options: pass { payer, payTo, resource?, since? }.");
    const payer = addressOf(opts.payer, "payer");
    const payTo = addressOf(opts.payTo, "payTo");
    const q = new URLSearchParams({ payer: payer.toLowerCase(), payTo: payTo.toLowerCase() });
    if (opts.resource !== undefined) {
      if (typeof opts.resource !== "string" || opts.resource.length > 2048 || !/^https?:\/\/[^\s"\\]+$/.test(opts.resource)) {
        throw new TollError("Invalid resource: an http(s) URL of at most 2048 characters, exactly as the payment named it.");
      }
      q.set("resource", opts.resource);
    }
    if (opts.since !== undefined) {
      const s = opts.since instanceof Date ? Math.floor(opts.since.getTime() / 1000) : opts.since;
      if (!Number.isSafeInteger(s) || s < 0 || s > 9_999_999_999) throw new TollError("Invalid since: unix seconds (a whole number) or a Date.");
      q.set("since", String(s));
    }
    const { res, raw } = await this.request(`${this.facilitatorUrl}/paid?${q.toString()}`, { method: "GET", headers: this.restHeaders(false) });
    const json = tryJson(raw);
    if (!res.ok || !isObject(json) || typeof json.paid !== "boolean" || typeof json.count !== "number") throw facError(res, raw);
    return json as unknown as PaidAnswer;
  }

  /**
   * COMING (the facilitator's FAC_BUDGETS is off until launch; until then this throws HTTP 404 budgets_off).
   * POST /budget: set or replace (newer nonce) the payer's spending limits with Toll's facilitator. `signature` is the
   * payer's own EIP-712 signature of `budgetTypedData(budget)`; anyone may relay it. Once set, /verify and /settle refuse
   * any payment past it (budget_exceeded_per_payment, _per_day, _per_payto, budget_payto_not_allowed, ...).
   * 409 budget_nonce_stale: sign with a higher nonce. 403 invalid_budget_signature: not the payer's signature.
   */
  async setBudget(opts: { budget: BudgetInput; signature: string }): Promise<BudgetSetAnswer> {
    if (!isObject(opts)) throw new TollError("Invalid options: pass { budget, signature }.");
    const m = budgetMessageOf(opts.budget);
    return this.postBudget({ budget: budgetBody(m), signature: signatureOf(opts.signature) });
  }

  /** COMING (see setBudget). POST /budget { revoke }: refuse every payment until the payer signs a budget with a newer nonce. */
  async revokeBudget(opts: { payer: string; nonce: bigint | number | string; signature: string }): Promise<BudgetSetAnswer> {
    if (!isObject(opts)) throw new TollError("Invalid options: pass { payer, nonce, signature }.");
    const { message } = revokeTypedData(opts);
    return this.postBudget({ revoke: { payer: message.payer, nonce: message.nonce.toString() }, signature: signatureOf(opts.signature) });
  }

  /** COMING (see setBudget). GET /budget?payer=: the stored budget and today's (UTC) spend, USDG base units as decimal strings. */
  async getBudget(payer: string): Promise<BudgetState> {
    const p = addressOf(payer, "payer");
    const { res, raw } = await this.request(`${this.facilitatorUrl}/budget?payer=${p.toLowerCase()}`, { method: "GET", headers: this.restHeaders(false) });
    const json = tryJson(raw);
    if (!res.ok || !isObject(json) || typeof json.payer !== "string" || !("budget" in json)) throw facError(res, raw);
    return json as unknown as BudgetState;
  }

  private async postBudget(body: unknown): Promise<BudgetSetAnswer> {
    const { res, raw } = await this.request(`${this.facilitatorUrl}/budget`, {
      method: "POST",
      headers: this.restHeaders(false, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const json = tryJson(raw);
    if (!res.ok || !isObject(json) || json.ok !== true) throw facError(res, raw);
    return json as unknown as BudgetSetAnswer;
  }

  /** The "Checked by Toll" badge URL for a coin on this client's base URL (see coinBadgeUrl). */
  badgeUrl(token: string, opts: { size?: CoinBadgeSize } = {}): string {
    return coinBadgeUrl(token, { ...opts, baseUrl: this.baseUrl });
  }

  /** Copy-paste HTML / Markdown / React snippets for a coin's badge on this client's base URL (see coinBadgeEmbed). */
  badgeEmbed(token: string, opts: { size?: CoinBadgeSize } = {}): CoinBadgeEmbed {
    return coinBadgeEmbed(token, { ...opts, baseUrl: this.baseUrl });
  }

  private async watchRest<T>(method: "GET" | "POST" | "DELETE", path: string, what: string, body?: unknown): Promise<{ status: number; json: T }> {
    this.needKey(what);
    const { res, raw } = await this.rest(method, path, { auth: true, ...(body !== undefined ? { body } : {}) });
    const json = tryJson(raw);
    if (res.status === 404 && json?.open === false) {
      throw new TollError(`${what}: watches for agents are not open on this server yet (it answered 404 open: false; the site's WATCH_API is off).`, { status: 404 });
    }
    if (!res.ok || !isObject(json)) throw restError(res, raw);
    return { status: res.status, json: json as T };
  }

  /**
   * POST /api/watch {token, url}: watch a coin. Toll re-reads it about every 10 minutes (sooner after a trade or a
   * liquidity change) and POSTs a signed event to `url` (public https) on verdict_changed, new_against, dev_sold or
   * cluster_sold. `secret` comes back only when the watch is new (created: true); check events with verifyWebhook.
   * Needs a Toll key (sent as Authorization: Bearer); the cap is the key's tier.
   */
  async createCoinWatch(token: string, url: string): Promise<WatchAdded> {
    assertAddress(token, "token");
    const { status, json } = await this.watchRest<Omit<WatchAdded, "created">>("POST", "/api/watch", "createCoinWatch", { token, url: String(url) });
    return { ...json, created: status === 201 };
  }

  /** GET /api/watch: this key's coin watches (never the secret) and the cap. */
  async listCoinWatches(): Promise<WatchList> {
    return (await this.watchRest<WatchList>("GET", "/api/watch", "listCoinWatches")).json;
  }

  /** DELETE /api/watch?id=<uuid>: remove one coin watch. */
  async deleteCoinWatch(id: string): Promise<{ deleted: string }> {
    assertUuid(id);
    return (await this.watchRest<{ deleted: string }>("DELETE", `/api/watch?id=${encodeURIComponent(id)}`, "deleteCoinWatch")).json;
  }

  /**
   * POST /api/watch/wallet {address, url}: watch a wallet. Toll reads it about once a minute and POSTs a signed event
   * on a new approval, a new EIP-7702 delegation or a token received whose check is against (risky_token_in).
   * `secret` only when new (created: true). Needs a Toll key; wallet watches have their own cap.
   */
  async createWalletWatch(address: string, url: string): Promise<WatchAdded> {
    assertWallet(address);
    const { status, json } = await this.watchRest<Omit<WatchAdded, "created">>("POST", "/api/watch/wallet", "createWalletWatch", { address, url: String(url) });
    return { ...json, created: status === 201 };
  }

  /** GET /api/watch/wallet: this key's wallet watches (never the secret) and the cap. */
  async listWalletWatches(): Promise<WatchList> {
    return (await this.watchRest<WatchList>("GET", "/api/watch/wallet", "listWalletWatches")).json;
  }

  /** DELETE /api/watch/wallet?id=<uuid>: remove one wallet watch. */
  async deleteWalletWatch(id: string): Promise<{ deleted: string }> {
    assertUuid(id);
    return (await this.watchRest<{ deleted: string }>("DELETE", `/api/watch/wallet?id=${encodeURIComponent(id)}`, "deleteWalletWatch")).json;
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

/* ------------------------------------------------------------------ REST helpers */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(id: unknown): string {
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new TollError("Invalid watch id: expected the uuid from the list of your watches.");
  return id;
}

function retryAfterOf(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (h === null) return undefined;
  return clampSeconds(Number(h), 30);
}

/** A REST answer that is not the one asked for: the server's `error` text, the status, and Retry-After when sent. */
function restError(res: Response, raw: string): TollError {
  const json = tryJson(raw);
  const msg = isObject(json) && typeof json.error === "string" ? json.error : raw.slice(0, 200);
  const s = retryAfterOf(res);
  return new TollError(`Toll answered HTTP ${res.status}${msg ? `: ${msg}` : ""}`, { status: res.status, ...(s !== undefined ? { retryAfterS: s } : {}) });
}

/* ------------------------------------------------------------------ check_tx: the RiskAssessment and the ALLOW ticket */

const RA_MARK = "RiskAssessment (ERC-8265):";

/** The RiskAssessment JSON a check_tx answer ends with ("RiskAssessment (ERC-8265):" then one JSON line), or null. */
export function assessmentOf(text: string): Record<string, unknown> | null {
  const i = text.lastIndexOf(RA_MARK);
  if (i < 0) return null;
  const json = tryJson(text.slice(i + RA_MARK.length).trim());
  return isObject(json) ? json : null;
}

/** The ask as Toll reads it (`ticket: {consumer?, scope?}`), or null for none. Same as @tollxyz/guard. */
export function ticketAskOf(t: boolean | TicketAsk | undefined | null): TicketAsk | null {
  if (t === undefined || t === null || t === false) return null;
  if (t === true) return {};
  const o: TicketAsk = {};
  if (t.consumer !== undefined) o.consumer = t.consumer;
  if (t.scope !== undefined) o.scope = t.scope;
  return o;
}

/** x-toll.ticket of a RiskAssessment: a signed ticket or {why} none was issued; undefined when there is none. */
export function ticketOfAnswer(a: Record<string, unknown> | null | undefined): TicketResult | undefined {
  const x = a?.["x-toll"];
  const t = isObject(x) ? x.ticket : undefined;
  if (!isObject(t)) return undefined;
  if (typeof t.why === "string") return { why: t.why };
  if (isObject(t.ticket) && typeof t.signature === "string" && typeof t.signer === "string") {
    return { ticket: t.ticket as unknown as AllowTicket, signature: t.signature, signer: t.signer };
  }
  return undefined;
}

const hexBody = (h: string, what: string): string => {
  if (typeof h !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(h)) throw new TypeError(`${what} must be 0x hex with whole bytes`);
  return h.slice(2).toLowerCase();
};
const word = (n: bigint, bits: number, what: string): string => {
  if (n < 0n || n >= 1n << BigInt(bits)) throw new RangeError(`${what} does not fit in uint${bits}`);
  return n.toString(16).padStart(64, "0");
};
const uintWord = (v: number | bigint | string, bits: number, what: string): string => {
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    throw new TypeError(`${what} must be a whole number`);
  }
  return word(n, bits, what);
};
const addrWord = (a: string, what: string): string => {
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new TypeError(`${what} must be an address`);
  return a.slice(2).toLowerCase().padStart(64, "0");
};
const b32Word = (h: string, what: string): string => {
  if (typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h)) throw new TypeError(`${what} must be 32 bytes`);
  return h.slice(2).toLowerCase();
};

/**
 * The calldata a ticket-checking contract (toll-allow) reads: `data ‖ abi.encode(ticket, signature) ‖ uint32 len ‖
 * 0x900bc3e1`. Byte for byte the same as @tollxyz/guard's appendTicketSuffix and TollAllow.encodeSuffix.
 */
export function appendTicketSuffix(data: string, ticket: AllowTicket, signature: string): string {
  const body = hexBody(data, "data");
  const sig = hexBody(signature, "signature");
  const head =
    uintWord(ticket.scope, 8, "ticket.scope") +
    uintWord(ticket.verdict, 8, "ticket.verdict") +
    addrWord(ticket.account, "ticket.account") +
    addrWord(ticket.consumer, "ticket.consumer") +
    b32Word(ticket.subject, "ticket.subject") +
    uintWord(ticket.validAfter, 64, "ticket.validAfter") +
    uintWord(ticket.validUntil, 64, "ticket.validUntil") +
    b32Word(ticket.nonce, "ticket.nonce") +
    b32Word(ticket.reportHash, "ticket.reportHash");
  const tail = word(320n, 256, "offset") + word(BigInt(sig.length / 2), 256, "signature length") + sig + "0".repeat((64 - (sig.length % 64)) % 64);
  const encoded = head + tail;
  const n = encoded.length / 2;
  return `0x${body}${encoded}${n.toString(16).padStart(8, "0")}${TICKET_SUFFIX_MAGIC.slice(2)}`;
}

/* ------------------------------------------------------------------ coin badge */

export type CoinBadgeSize = "sm" | "lg";
export interface CoinBadgeEmbed {
  /** The SVG badge URL. */
  url: string;
  /** The coin's Toll check page the badge links to. */
  page: string;
  html: string;
  markdown: string;
  react: string;
}

/**
 * The "Checked by Toll" badge for a coin: an SVG (200x28, or 300x42 with size "lg") with the coin's verdict word from
 * the checks Toll already holds (AGAINST / CAREFUL / CLEAR / INCOMPLETE), or "not checked yet". A badge request never
 * starts a chain read.
 */
export function coinBadgeUrl(token: string, opts: { size?: CoinBadgeSize; baseUrl?: string } = {}): string {
  assertAddress(token, "token");
  if (opts.size !== undefined && opts.size !== "sm" && opts.size !== "lg") throw new TollError('Invalid size: use "sm" or "lg".');
  const base = (opts.baseUrl ?? "https://t0ll.xyz").replace(/\/+$/, "");
  return `${base}/badge/${token.toLowerCase()}${opts.size === "lg" ? "?size=lg" : ""}`;
}

/** Copy-paste snippets for a coin's badge, linking to its check page (the same snippets as t0ll.xyz/agents/embed). */
export function coinBadgeEmbed(token: string, opts: { size?: CoinBadgeSize; baseUrl?: string } = {}): CoinBadgeEmbed {
  const url = coinBadgeUrl(token, opts);
  const base = (opts.baseUrl ?? "https://t0ll.xyz").replace(/\/+$/, "");
  const page = `${base}/check/${token.toLowerCase()}`;
  const [w, h] = opts.size === "lg" ? [300, 42] : [200, 28];
  return {
    url,
    page,
    html: `<a href="${page}"><img src="${url}" alt="Toll check" width="${w}" height="${h}"></a>`,
    markdown: `[![Toll check](${url})](${page})`,
    react: `<a href="${page}"><img src="${url}" alt="Toll check" width={${w}} height={${h}} /></a>`,
  };
}

/* ------------------------------------------------------------------ webhooks */

const utf8 = new TextEncoder();

/**
 * Checks a watch event's x-toll-signature header: `sha256=<hex HMAC-SHA256(secret, raw body)>`, the secret being the
 * text Toll returned when the watch was added. Pass the raw body exactly as received (before any JSON parsing).
 * Constant-time compare; false on a missing or malformed header. Uses WebCrypto (Node >= 20, browsers, edge).
 */
export async function verifyWebhook(secret: string, rawBody: string | Uint8Array, signature: string | null | undefined): Promise<boolean> {
  if (typeof secret !== "string" || !secret || typeof signature !== "string") return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(signature.trim());
  if (!m) return false;
  const key = await globalThis.crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = typeof rawBody === "string" ? utf8.encode(rawBody) : Uint8Array.from(rawBody);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, data));
  const want = m[1].toLowerCase();
  let have = "";
  for (const b of mac) have += b.toString(16).padStart(2, "0");
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= have.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/**
 * verifyWebhook, then the parsed event. Throws TollError when the signature does not match or the body is not a Toll
 * watch event (type "toll.watch" or "toll.wallet_watch").
 */
export async function readWebhook(secret: string, rawBody: string | Uint8Array, signature: string | null | undefined): Promise<WatchEvent> {
  if (!(await verifyWebhook(secret, rawBody, signature))) throw new TollError("Webhook signature does not match: drop this request.");
  const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  const json = tryJson(text);
  if (!isObject(json) || (json.type !== "toll.watch" && json.type !== "toll.wallet_watch")) throw new TollError("Not a Toll watch event.");
  return json as unknown as WatchEvent;
}

/* ------------------------------------------------------------------ facilitator: budgets and offer-receipt helpers */

const MAX_U256 = (1n << 256n) - 1n;
const MAX_U64 = (1n << 64n) - 1n;

/** a uint as bigint (bigint, safe whole number or decimal string), checked against max */
function uintOf(v: unknown, name: string, max: bigint = MAX_U256): bigint {
  let n: bigint | null = null;
  if (typeof v === "bigint") n = v;
  else if (typeof v === "number" && Number.isSafeInteger(v)) n = BigInt(v);
  else if (typeof v === "string" && /^\d{1,78}$/.test(v.trim())) n = BigInt(v.trim());
  if (n === null || n < 0n || n > max) throw new TollError(`Invalid ${name}: use a whole number of USDG base units (bigint or decimal string) from 0.`);
  return n;
}

function addressOf(v: unknown, name: string): string {
  if (typeof v !== "string" || !EVM.test(v)) throw new TollError(`Invalid ${name}: expected 0x + 40 hex characters.`);
  return v;
}

/** the budget as the typed message, checked (caps in the order given: the signature covers that order) */
function budgetMessageOf(b: BudgetInput): BudgetMessage {
  if (!isObject(b)) throw new TollError("Invalid budget: pass { payer, perPayment, perDay, nonce, ... }.");
  const caps = b.payToCaps ?? [];
  const allowed = b.allowedPayTos ?? [];
  if (!Array.isArray(caps) || caps.length > BUDGET_MAX_PAYTOS) throw new TollError(`Invalid payToCaps: a list of at most ${BUDGET_MAX_PAYTOS}.`);
  if (!Array.isArray(allowed) || allowed.length > BUDGET_MAX_PAYTOS) throw new TollError(`Invalid allowedPayTos: a list of at most ${BUDGET_MAX_PAYTOS}.`);
  const seen = new Set<string>();
  const payToCaps = caps.map((c, i) => {
    if (!isObject(c)) throw new TollError(`Invalid payToCaps[${i}]: use { payTo, perDay }.`);
    const payTo = addressOf(c.payTo, `payToCaps[${i}].payTo`);
    if (seen.has(payTo.toLowerCase())) throw new TollError(`Invalid payToCaps: ${payTo} is listed twice (one cap per payTo).`);
    seen.add(payTo.toLowerCase());
    return { payTo, perDay: uintOf(c.perDay, `payToCaps[${i}].perDay`) };
  });
  return {
    payer: addressOf(b.payer, "payer"),
    perPayment: uintOf(b.perPayment, "perPayment"),
    perDay: uintOf(b.perDay, "perDay"),
    perPayTo: uintOf(b.perPayTo ?? 0, "perPayTo"),
    payToCaps,
    allowedPayTos: allowed.map((a, i) => addressOf(a, `allowedPayTos[${i}]`)),
    validUntil: uintOf(b.validUntil ?? 0, "validUntil", MAX_U64),
    nonce: uintOf(b.nonce, "nonce"),
  };
}

/**
 * The EIP-712 typed data of a per-payer budget, for the payer wallet to sign (viem: `account.signTypedData(td)`;
 * ethers: `signer.signTypedData(td.domain, td.types, td.message)`). Then `toll.setBudget({ budget, signature })`.
 * Throws TollError on a malformed budget, before anything is signed.
 */
export function budgetTypedData(budget: BudgetInput): TypedData<BudgetMessage> & { primaryType: "Budget" } {
  return { domain: { ...BUDGET_DOMAIN }, types: BUDGET_TYPES, primaryType: "Budget", message: budgetMessageOf(budget) };
}

/** The EIP-712 typed data of a budget revoke (refuses every payment until a budget with a newer nonce is set). */
export function revokeTypedData(r: { payer: string; nonce: bigint | number | string }): TypedData<{ payer: string; nonce: bigint }> & { primaryType: "Revoke" } {
  if (!isObject(r)) throw new TollError("Invalid revoke: pass { payer, nonce }.");
  return { domain: { ...BUDGET_DOMAIN }, types: REVOKE_TYPES, primaryType: "Revoke", message: { payer: addressOf(r.payer, "payer"), nonce: uintOf(r.nonce, "nonce") } };
}

/**
 * The EIP-712 typed data of the offer-receipt spec's receipt (domain "x402 receipt" / "1" / chainId 1), for the SELLER
 * to sign with its own key once it has delivered. The payload is used exactly as given (the spec forbids rebuilding it).
 */
export function receiptTypedData(payload: ReceiptPayload): TypedData<{ version: bigint; network: string; resourceUrl: string; payer: string; issuedAt: bigint; transaction: string }> & { primaryType: "Receipt" } {
  if (!isObject(payload)) throw new TollError("Invalid receipt payload.");
  for (const k of ["network", "resourceUrl", "payer"] as const) {
    if (typeof payload[k] !== "string") throw new TollError(`Invalid receipt payload: ${k} must be text.`);
  }
  if (payload.transaction !== undefined && typeof payload.transaction !== "string") throw new TollError("Invalid receipt payload: transaction must be text.");
  if (!Number.isSafeInteger(payload.version) || payload.version < 1) throw new TollError("Invalid receipt payload: version must be a whole number (1).");
  if (!Number.isSafeInteger(payload.issuedAt) || payload.issuedAt < 0) throw new TollError("Invalid receipt payload: issuedAt must be unix seconds.");
  return {
    domain: { ...RECEIPT_DOMAIN },
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: { version: BigInt(payload.version), network: payload.network, resourceUrl: payload.resourceUrl, payer: payload.payer,
      issuedAt: BigInt(payload.issuedAt), transaction: payload.transaction ?? "" },
  };
}

/** extensions["toll-offer-receipt"] of a settle answer, checked; null when absent or malformed (another facilitator). */
export function tollOfferReceiptOf(answer: unknown): TollOfferReceipt | null {
  const ext = isObject(answer) ? answer.extensions : null;
  const x = isObject(ext) ? ext["toll-offer-receipt"] : null;
  if (!isObject(x) || !isObject(x.offer) || typeof x.offer.read !== "string") return null;
  const p = x.receiptPayload;
  const ok = isObject(p) && typeof p.network === "string" && typeof p.resourceUrl === "string" && typeof p.payer === "string"
    && Number.isSafeInteger(p.version) && Number.isSafeInteger(p.issuedAt) && (p.transaction === undefined || typeof p.transaction === "string");
  return { offer: x.offer as OfferFacts, receiptPayload: ok ? (p as unknown as ReceiptPayload) : null };
}

/** the budget as POST /budget takes it: amounts as decimal strings, caps in the signed order */
function budgetBody(m: BudgetMessage) {
  return {
    payer: m.payer, perPayment: m.perPayment.toString(), perDay: m.perDay.toString(), perPayTo: m.perPayTo.toString(),
    payToCaps: m.payToCaps.map((c) => ({ payTo: c.payTo, perDay: c.perDay.toString() })), allowedPayTos: m.allowedPayTos,
    validUntil: m.validUntil.toString(), nonce: m.nonce.toString(),
  };
}

function signatureOf(v: unknown): string {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(v)) throw new TollError("Invalid signature: expected a 65-byte 0x hex signature from the payer.");
  return v;
}

/** a facilitator { error, message } answer as a TollError (404 budgets_off says so) */
function facError(res: Response, raw: string): TollError {
  const json = tryJson(raw);
  const code = isObject(json) && typeof json.error === "string" ? json.error : "";
  const msg = isObject(json) && typeof json.message === "string" ? json.message : "";
  const s = retryAfterOf(res);
  const note = code === "budgets_off" ? " Budgets are not switched on at this facilitator yet." : "";
  return new TollError(`Toll's facilitator answered HTTP ${res.status}${code ? `: ${code}` : raw ? `: ${raw.slice(0, 200)}` : ""}${msg ? ` (${msg})` : ""}.${note}`,
    { status: res.status, ...(s !== undefined ? { retryAfterS: s } : {}) });
}
