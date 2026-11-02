/**
 * @tollxyz/ai-sdk - Toll coin checks as Vercel AI SDK tools.
 * Information only, not financial advice.
 */
import { tool, type Tool } from "ai";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { z } from "zod/v4";
import { formatResult } from "./format.js";
import { MACRO_NOTE, MARKETS_NOTE, fundamentals, insiderTrades, macro, stockToken, stockTokens, withTollKey, type FetchLike } from "./markets.js";

export { formatResult } from "./format.js";
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
  macro,
  type FundamentalsPeriod,
  type MarketsOptions,
  type PaidMarketsKind,
} from "./markets.js";
export { Toll, TollError } from "@tollxyz/sdk";
export type { TollResult } from "@tollxyz/sdk";

export interface TollToolsOptions {
  /** A ready Toll client for the coin tools (for example with a custom fetch). Default: a client that sends tollKey. */
  client?: Toll;
  /** A Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every t0ll.xyz call: carries the key wallet's daily tier. */
  tollKey?: string;
  /** fetch for t0ll.xyz calls. Default: global fetch. */
  fetch?: FetchLike;
  /** Which tools to return. Default: all eleven. */
  only?: TollToolName[];
}

export type TollToolName =
  | "check_coin"
  | "larp_check"
  | "dev_record"
  | "launch_record"
  | "fresh_launches"
  | "chain_pulse"
  | "stock_token"
  | "stock_tokens"
  | "fundamentals"
  | "insider_trades"
  | "macro";

async function run(fn: () => Promise<TollResult>): Promise<string> {
  try {
    return formatResult(await fn());
  } catch (e) {
    return `Toll could not answer: ${e instanceof TollError ? e.message : "request failed"}`;
  }
}

const address = z.string().describe("Token contract address: 0x + 40 hex on Robinhood Chain or BSC, or a Solana base58 mint.");

/**
 * Returns a record of AI SDK tools to pass as `tools` to generateText / streamText.
 * Each tool returns Toll's text; the model decides what it means.
 */
export function tollTools(opts: TollToolsOptions = {}): Partial<Record<TollToolName, Tool>> {
  const fetchFn: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const toll = opts.client ?? new Toll({ fetch: withTollKey(fetchFn, opts.tollKey) });
  const markets = { fetch: fetchFn, tollKey: opts.tollKey };
  const all = {
    check_coin: tool({
      description:
        "Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Information only, not advice.",
      inputSchema: z.object({
        address,
        chain: z.enum(["rh", "sol", "bsc"]).optional().describe("rh = Robinhood Chain, sol = Solana, bsc = BSC. Leave out and Toll finds the chain."),
      }),
      execute: async ({ address, chain }) => run(() => toll.checkCoin(address, chain ? { chain } : {})),
    }),
    larp_check: tool({
      description:
        "Is there a real product behind this coin? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: product found, partly found, not found or not read. Robinhood Chain and Solana. Information only, not advice.",
      inputSchema: z.object({
        token: address,
        chain: z.enum(["rh", "sol"]).optional().describe("rh = Robinhood Chain, sol = Solana."),
      }),
      execute: async ({ token, chain }) => run(() => toll.larpCheck(token, { wait: true, ...(chain ? { chain } : {}) })),
    }),
    dev_record: tool({
      description:
        "A launcher wallet's record: how many coins it launched, how many graduated, and whether it sold. Robinhood Chain (default) or BSC. Information only, not advice.",
      inputSchema: z.object({
        wallet: z.string().describe("Wallet address: 0x + 40 hex."),
        chain: z.enum(["rh", "bsc"]).optional().describe("Default rh (Robinhood Chain)."),
      }),
      execute: async ({ wallet, chain }) => run(() => toll.devRecord(wallet, chain ? { chain } : {})),
    }),
    launch_record: tool({
      description:
        "The call Toll froze 3 minutes after a Robinhood Chain coin launched, and how it ended 24 hours later. It is not the coin now (use check_coin for that).",
      inputSchema: z.object({ address: z.string().describe("Token contract address on Robinhood Chain (0x + 40 hex).") }),
      execute: async ({ address }) => run(() => toll.launchRecord(address)),
    }),
    fresh_launches: tool({
      description: "The newest coins launched on Robinhood Chain, with the first facts Toll reads about each.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional().describe("How many coins, 1 to 20.") }),
      execute: async ({ limit }) => run(() => toll.freshLaunches(limit)),
    }),
    chain_pulse: tool({
      description: "How busy Robinhood Chain is right now: launches, graduations and trades.",
      inputSchema: z.object({}),
      execute: async () => run(() => toll.chainPulse()),
    }),
    stock_token: tool({
      description: `One Robinhood Stock Token on Robinhood Chain by ticker or contract: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier, corporate actions and the company's SEC facts, each with its source and time. ${MARKETS_NOTE}`,
      inputSchema: z.object({
        id: z.string().describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract address on Robinhood Chain (0x + 40 hex)."),
      }),
      execute: async ({ id }) => stockToken(id, markets),
    }),
    stock_tokens: tool({
      description: `The Robinhood Stock Tokens on Robinhood Chain: ticker, name, contract, multiplier and Chainlink reference price, optionally filtered by a query. ${MARKETS_NOTE}`,
      inputSchema: z.object({
        query: z.string().optional().describe("Optional: part of a ticker or company name to filter by (for example nvid)."),
        limit: z.number().int().min(1).max(250).optional().describe("How many Stock Tokens, 1 to 250."),
      }),
      execute: async ({ query, limit }) => stockTokens({ query, limit }, markets),
    }),
    fundamentals: tool({
      description: `A company's fundamentals from its SEC filings, by the ticker or contract of its Robinhood Stock Token: revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation at the reference price, every figure with its filing and link. ${MARKETS_NOTE}`,
      inputSchema: z.object({
        id: z.string().describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract address on Robinhood Chain (0x + 40 hex)."),
        period: z.enum(["ttm", "annual", "quarterly"]).optional().describe("Optional period: ttm = trailing twelve months, annual = fiscal years, quarterly = quarters."),
      }),
      execute: async ({ id, period }) => fundamentals({ id, period }, markets),
    }),
    insider_trades: tool({
      description: `Insider trades from SEC Form 4 filings for the company behind a Robinhood Stock Token: who traded, their role, the transaction code, shares, price and shares owned after, each with its filing link, plus 90-day totals and 13D/13G holders. ${MARKETS_NOTE}`,
      inputSchema: z.object({
        id: z.string().describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract address on Robinhood Chain (0x + 40 hex)."),
        limit: z.number().int().min(1).max(100).optional().describe("How many Form 4 rows, 1 to 100, newest first."),
      }),
      execute: async ({ id, limit }) => insiderTrades({ id, limit }, markets),
    }),
    macro: tool({
      description: `US macro facts: the Treasury daily par yield curve (latest day and 30 days), the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. ${MACRO_NOTE}`,
      inputSchema: z.object({}),
      execute: async () => macro(markets),
    }),
  };
  if (!opts.only) return all;
  const picked: Partial<Record<TollToolName, Tool>> = {};
  for (const n of opts.only) picked[n] = all[n];
  return picked;
}
