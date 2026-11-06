/**
 * @tollxyz/ai-sdk - Toll's checks on Robinhood Chain as Vercel AI SDK tools.
 * Information only, not financial advice.
 */
import { tool, type Tool } from "ai";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { formatResult } from "./format.js";
import { LIVE_DESCRIPTIONS } from "./live.js";
import {
  MACRO_NOTE,
  MARKETS_NOTE,
  fundamentals,
  guidance,
  insiderTrades,
  institutions,
  macro,
  stockToken,
  stockTokens,
  withTollKey,
  type FetchLike,
} from "./markets.js";
import { SCHEMAS } from "./schemas.js";

export { formatResult } from "./format.js";
export { LIVE_DESCRIPTIONS, STOCK_EVENT_KINDS } from "./live.js";
export { SCHEMAS } from "./schemas.js";
export {
  FACTS_NOTE,
  MACRO_NOTE,
  MARKETS_NOTE,
  LIMITS_NOTE,
  FUNDAMENTALS_PERIODS,
  paidStockUrl,
  paidMarketsUrl,
  stockToken,
  stockTokens,
  fundamentals,
  insiderTrades,
  institutions,
  guidance,
  macro,
  type FundamentalsPeriod,
  type MarketsOptions,
  type PaidMarketsKind,
} from "./markets.js";
export { Toll, TollError } from "@tollxyz/sdk";
export type { TollResult } from "@tollxyz/sdk";

export interface TollToolsOptions {
  /** A ready Toll client for the MCP tools (for example with a custom fetch). Default: a client that sends tollKey. */
  client?: Toll;
  /** A Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every t0ll.xyz call: carries the key wallet's daily tier. */
  tollKey?: string;
  /** fetch for t0ll.xyz calls. Default: global fetch. */
  fetch?: FetchLike;
  /** Which tools to return. Default: all twenty-one. */
  only?: TollToolName[];
}

export type TollToolName =
  | "check_coin"
  | "pre_buy_check"
  | "check_coins"
  | "larp_check"
  | "dev_record"
  | "wallet_privacy"
  | "launch_record"
  | "fresh_launches"
  | "chain_pulse"
  | "check_agent"
  | "check_hook"
  | "check_tx"
  | "presign_risk_report"
  | "stock_token"
  | "stock_tokens"
  | "fundamentals"
  | "insider_trades"
  | "institutions"
  | "guidance"
  | "macro"
  | "stock_events";

async function run(fn: () => Promise<TollResult>): Promise<string> {
  try {
    return formatResult(await fn());
  } catch (e) {
    return `Toll could not answer: ${e instanceof TollError ? e.message : "request failed"}`;
  }
}

/**
 * Returns a record of AI SDK tools to pass as `tools` to generateText / streamText (Robinhood Chain, chain id 4663).
 * Each tool returns Toll's text; the model decides what it means.
 */
export function tollTools(opts: TollToolsOptions = {}): Partial<Record<TollToolName, Tool>> {
  const fetchFn: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const toll = opts.client ?? new Toll({ fetch: withTollKey(fetchFn, opts.tollKey) });
  const markets = { fetch: fetchFn, tollKey: opts.tollKey };
  const all = {
    check_coin: tool({
      description:
        "Before buying a token on Robinhood Chain, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Robinhood Chain (4663) only. Information only, not advice.",
      inputSchema: SCHEMAS.check_coin,
      execute: async ({ address, chain }) => run(() => toll.checkCoin(address, chain ? { chain } : {})),
    }),
    pre_buy_check: tool({
      description: LIVE_DESCRIPTIONS.pre_buy_check,
      inputSchema: SCHEMAS.pre_buy_check,
      execute: async ({ address }) => run(() => toll.preBuyCheck(address)),
    }),
    check_coins: tool({
      description: LIVE_DESCRIPTIONS.check_coins,
      inputSchema: SCHEMAS.check_coins,
      execute: async ({ addresses }) => run(() => toll.checkCoins(addresses)),
    }),
    larp_check: tool({
      description:
        "Is there a real product behind this coin on Robinhood Chain? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: product found, partly found, not found or not read. Information only, not advice.",
      inputSchema: SCHEMAS.larp_check,
      execute: async ({ token, chain }) => run(() => toll.larpCheck(token, { wait: true, ...(chain ? { chain } : {}) })),
    }),
    dev_record: tool({
      description:
        "A launcher wallet's record on Robinhood Chain: how many coins it launched, how many graduated, and whether it sold. Information only, not advice.",
      inputSchema: SCHEMAS.dev_record,
      execute: async ({ wallet, chain }) => run(() => toll.devRecord(wallet, chain ? { chain } : {})),
    }),
    wallet_privacy: tool({
      description: LIVE_DESCRIPTIONS.wallet_privacy,
      inputSchema: SCHEMAS.wallet_privacy,
      execute: async ({ wallet }) => run(() => toll.walletPrivacy(wallet)),
    }),
    launch_record: tool({
      description:
        "The call Toll froze a few minutes after a Robinhood Chain coin launched, and how it ended 24 hours later. It is not the coin now (use check_coin for that).",
      inputSchema: SCHEMAS.launch_record,
      execute: async ({ address }) => run(() => toll.launchRecord(address)),
    }),
    fresh_launches: tool({
      description: "The newest coins launched on Robinhood Chain, with the first facts Toll reads about each.",
      inputSchema: SCHEMAS.fresh_launches,
      execute: async ({ limit }) => run(() => toll.freshLaunches(limit)),
    }),
    chain_pulse: tool({
      description: "How busy Robinhood Chain is right now: launches, graduations and trades.",
      inputSchema: SCHEMAS.chain_pulse,
      execute: async () => run(() => toll.chainPulse()),
    }),
    check_agent: tool({
      description: LIVE_DESCRIPTIONS.check_agent,
      inputSchema: SCHEMAS.check_agent,
      execute: async ({ id }) => run(() => toll.checkAgent(id)),
    }),
    check_hook: tool({
      description: LIVE_DESCRIPTIONS.check_hook,
      inputSchema: SCHEMAS.check_hook,
      execute: async ({ address }) => run(() => toll.checkHook(address)),
    }),
    check_tx: tool({
      description: LIVE_DESCRIPTIONS.check_tx,
      inputSchema: SCHEMAS.check_tx,
      execute: async (args) => run(() => toll.checkTx(args)),
    }),
    presign_risk_report: tool({
      description: LIVE_DESCRIPTIONS.presign_risk_report,
      inputSchema: SCHEMAS.presign_risk_report,
      execute: async (args) => run(() => toll.presignRiskReport(args)),
    }),
    stock_token: tool({
      description: `One Robinhood Stock Token on Robinhood Chain by ticker or contract: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier, corporate actions and the company's SEC facts, each with its source and time. ${MARKETS_NOTE}`,
      inputSchema: SCHEMAS.stock_token,
      execute: async ({ id }) => stockToken(id, markets),
    }),
    stock_tokens: tool({
      description: `The Robinhood Stock Tokens on Robinhood Chain: ticker, name, contract, multiplier and Chainlink reference price, optionally filtered by a query. ${MARKETS_NOTE}`,
      inputSchema: SCHEMAS.stock_tokens,
      execute: async ({ query, limit }) => stockTokens({ query, limit }, markets),
    }),
    fundamentals: tool({
      description: `A company's fundamentals from its SEC filings, by the ticker or contract of its Robinhood Stock Token: revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation at the reference price, every figure with its filing and link. ${MARKETS_NOTE}`,
      inputSchema: SCHEMAS.fundamentals,
      execute: async ({ id, period }) => fundamentals({ id, period }, markets),
    }),
    insider_trades: tool({
      description: `Insider trades from SEC Form 4 filings for the company behind a Robinhood Stock Token: who traded, their role, the transaction code, shares, price and shares owned after, each with its filing link, plus 90-day totals and 13D/13G holders. ${MARKETS_NOTE}`,
      inputSchema: SCHEMAS.insider_trades,
      execute: async ({ id, limit }) => insiderTrades({ id, limit }, markets),
    }),
    institutions: tool({
      description: `${LIVE_DESCRIPTIONS.institutions} ${MARKETS_NOTE}`,
      inputSchema: SCHEMAS.institutions,
      execute: async ({ id, limit }) => institutions({ id, limit }, markets),
    }),
    guidance: tool({
      description: `${LIVE_DESCRIPTIONS.guidance} ${MARKETS_NOTE}`,
      inputSchema: SCHEMAS.guidance,
      execute: async ({ id, limit }) => guidance({ id, limit }, markets),
    }),
    macro: tool({
      description: `US macro facts: the Treasury daily par yield curve (latest day and 30 days), the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. ${MACRO_NOTE}`,
      inputSchema: SCHEMAS.macro,
      execute: async () => macro(markets),
    }),
    stock_events: tool({
      description: `${LIVE_DESCRIPTIONS.stock_events} ${MARKETS_NOTE}`,
      inputSchema: SCHEMAS.stock_events,
      execute: async (args) => run(() => toll.stockEvents(args)),
    }),
  };
  if (!opts.only) return all;
  const picked: Partial<Record<TollToolName, Tool>> = {};
  for (const n of opts.only) picked[n] = all[n];
  return picked;
}
