/**
 * @tollxyz/goat-plugin - Toll coin checks as a GOAT SDK plugin.
 * Information only, not financial advice.
 */
import { PluginBase, Tool, createToolParameters, type Chain } from "@goat-sdk/core";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { z } from "zod";
import { formatResult } from "./format.js";
import { MACRO_NOTE, MARKETS_NOTE, fundamentals, insiderTrades, macro, stockToken, stockTokens, withTollKey, type FetchLike, type MarketsOptions } from "./markets.js";

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

const address = z.string().describe("Token contract address: 0x + 40 hex on Robinhood Chain or BSC, or a Solana base58 mint.");

export class CheckCoinParams extends createToolParameters(
  z.object({
    address,
    chain: z.enum(["rh", "sol", "bsc"]).optional().describe("rh = Robinhood Chain, sol = Solana, bsc = BSC. Leave out and Toll finds the chain."),
  }),
) {}
export class LarpCheckParams extends createToolParameters(
  z.object({
    token: address,
    chain: z.enum(["rh", "sol"]).optional().describe("rh = Robinhood Chain, sol = Solana."),
  }),
) {}
export class DevRecordParams extends createToolParameters(
  z.object({
    wallet: z.string().describe("Wallet address: 0x + 40 hex."),
    chain: z.enum(["rh", "bsc"]).optional().describe("Default rh (Robinhood Chain)."),
  }),
) {}

export class StockTokenParams extends createToolParameters(
  z.object({
    id: z.string().describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract address on Robinhood Chain (0x + 40 hex)."),
  }),
) {}
export class StockTokensParams extends createToolParameters(
  z.object({
    query: z.string().optional().describe("Optional: part of a ticker or company name to filter by (for example nvid)."),
    limit: z.number().int().min(1).max(250).optional().describe("How many Stock Tokens, 1 to 250."),
  }),
) {}
export class FundamentalsParams extends createToolParameters(
  z.object({
    id: z.string().describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract address on Robinhood Chain (0x + 40 hex)."),
    period: z.enum(["ttm", "annual", "quarterly"]).optional().describe("Optional period: ttm = trailing twelve months, annual = fiscal years, quarterly = quarters."),
  }),
) {}
export class InsiderTradesParams extends createToolParameters(
  z.object({
    id: z.string().describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract address on Robinhood Chain (0x + 40 hex)."),
    limit: z.number().int().min(1).max(100).optional().describe("How many Form 4 rows, 1 to 100, newest first."),
  }),
) {}
export class MacroParams extends createToolParameters(z.object({})) {}

export interface TollPluginOptions {
  /** A ready Toll client for the coin tools (its own fetch). Default: a client that sends tollKey. */
  client?: Toll;
  /** A Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every t0ll.xyz call: carries the key wallet's daily tier. */
  tollKey?: string;
  /** fetch for t0ll.xyz calls. Default: global fetch. */
  fetch?: FetchLike;
}

async function run(fn: () => Promise<TollResult>): Promise<string> {
  try {
    return formatResult(await fn());
  } catch (e) {
    return `Toll could not answer: ${e instanceof TollError ? e.message : "request failed"}`;
  }
}

export class TollService {
  constructor(
    private readonly client: Toll,
    private readonly markets: MarketsOptions = {},
  ) {}

  @Tool({
    name: "check_coin",
    description:
      "Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Information only, not advice.",
  })
  async checkCoin(parameters: CheckCoinParams): Promise<string> {
    return run(() => this.client.checkCoin(parameters.address, parameters.chain ? { chain: parameters.chain } : {}));
  }

  @Tool({
    name: "larp_check",
    description:
      "Is there a real product behind this coin? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: product found, partly found, not found or not read. Robinhood Chain and Solana. Information only, not advice.",
  })
  async larpCheck(parameters: LarpCheckParams): Promise<string> {
    return run(() => this.client.larpCheck(parameters.token, { wait: true, ...(parameters.chain ? { chain: parameters.chain } : {}) }));
  }

  @Tool({
    name: "dev_record",
    description:
      "A launcher wallet's record: how many coins it launched, how many graduated, and whether it sold. Robinhood Chain (default) or BSC. Information only, not advice.",
  })
  async devRecord(parameters: DevRecordParams): Promise<string> {
    return run(() => this.client.devRecord(parameters.wallet, parameters.chain ? { chain: parameters.chain } : {}));
  }

  @Tool({
    name: "stock_token",
    description: `One Robinhood Stock Token on Robinhood Chain by ticker or contract: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier, corporate actions and the company's SEC facts, each with its source and time. ${MARKETS_NOTE}`,
  })
  async stockToken(parameters: StockTokenParams): Promise<string> {
    return stockToken(parameters.id, this.markets);
  }

  @Tool({
    name: "stock_tokens",
    description: `The Robinhood Stock Tokens on Robinhood Chain: ticker, name, contract, multiplier and Chainlink reference price, optionally filtered by a query. ${MARKETS_NOTE}`,
  })
  async stockTokens(parameters: StockTokensParams): Promise<string> {
    return stockTokens({ query: parameters.query, limit: parameters.limit }, this.markets);
  }

  @Tool({
    name: "fundamentals",
    description: `A company's fundamentals from its SEC filings, by the ticker or contract of its Robinhood Stock Token: revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation at the reference price, every figure with its filing and link. ${MARKETS_NOTE}`,
  })
  async fundamentals(parameters: FundamentalsParams): Promise<string> {
    return fundamentals({ id: parameters.id, period: parameters.period }, this.markets);
  }

  @Tool({
    name: "insider_trades",
    description: `Insider trades from SEC Form 4 filings for the company behind a Robinhood Stock Token: who traded, their role, the transaction code, shares, price and shares owned after, each with its filing link, plus 90-day totals and 13D/13G holders. ${MARKETS_NOTE}`,
  })
  async insiderTrades(parameters: InsiderTradesParams): Promise<string> {
    return insiderTrades({ id: parameters.id, limit: parameters.limit }, this.markets);
  }

  @Tool({
    name: "macro",
    description: `US macro facts: the Treasury daily par yield curve (latest day and 30 days), the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. ${MACRO_NOTE}`,
  })
  async macro(_parameters: MacroParams): Promise<string> {
    return macro(this.markets);
  }
}

export class TollPlugin extends PluginBase {
  /** Takes a Toll client (as before) or options with a tollKey. */
  constructor(clientOrOptions: Toll | TollPluginOptions = {}) {
    const o: TollPluginOptions = clientOrOptions instanceof Toll ? { client: clientOrOptions } : clientOrOptions;
    const fetchFn: FetchLike = o.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const client = o.client ?? new Toll({ fetch: withTollKey(fetchFn, o.tollKey) });
    super("toll", [new TollService(client, { fetch: fetchFn, tollKey: o.tollKey })]);
  }

  /** Toll reads public chain data, so it works whatever chain the agent's wallet is on. */
  supportsChain(_chain: Chain): boolean {
    return true;
  }
}

export const toll = (clientOrOptions?: Toll | TollPluginOptions): TollPlugin => new TollPlugin(clientOrOptions);
