/**
 * @tollxyz/goat-plugin - Toll's checks on Robinhood Chain as a GOAT SDK plugin.
 * Information only, not financial advice.
 */
import { PluginBase, Tool, createToolParameters, type Chain } from "@goat-sdk/core";
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
  type MarketsOptions,
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

export class CheckCoinParams extends createToolParameters(SCHEMAS.check_coin) {}
export class PreBuyCheckParams extends createToolParameters(SCHEMAS.pre_buy_check) {}
export class CheckCoinsParams extends createToolParameters(SCHEMAS.check_coins) {}
export class LarpCheckParams extends createToolParameters(SCHEMAS.larp_check) {}
export class DevRecordParams extends createToolParameters(SCHEMAS.dev_record) {}
export class WalletPrivacyParams extends createToolParameters(SCHEMAS.wallet_privacy) {}
export class LaunchRecordParams extends createToolParameters(SCHEMAS.launch_record) {}
export class FreshLaunchesParams extends createToolParameters(SCHEMAS.fresh_launches) {}
export class ChainPulseParams extends createToolParameters(SCHEMAS.chain_pulse) {}
export class CheckAgentParams extends createToolParameters(SCHEMAS.check_agent) {}
export class CheckHookParams extends createToolParameters(SCHEMAS.check_hook) {}
export class CheckTxParams extends createToolParameters(SCHEMAS.check_tx) {}
export class PresignRiskReportParams extends createToolParameters(SCHEMAS.presign_risk_report) {}
export class StockTokenParams extends createToolParameters(SCHEMAS.stock_token) {}
export class StockTokensParams extends createToolParameters(SCHEMAS.stock_tokens) {}
export class FundamentalsParams extends createToolParameters(SCHEMAS.fundamentals) {}
export class InsiderTradesParams extends createToolParameters(SCHEMAS.insider_trades) {}
export class InstitutionsParams extends createToolParameters(SCHEMAS.institutions) {}
export class GuidanceParams extends createToolParameters(SCHEMAS.guidance) {}
export class MacroParams extends createToolParameters(SCHEMAS.macro) {}
export class StockEventsParams extends createToolParameters(SCHEMAS.stock_events) {}

export interface TollPluginOptions {
  /** A ready Toll client for the MCP tools (its own fetch). Default: a client that sends tollKey. */
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
      "Before buying a token on Robinhood Chain, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Robinhood Chain (4663) only. Information only, not advice.",
  })
  async checkCoin(parameters: CheckCoinParams): Promise<string> {
    return run(() => this.client.checkCoin(parameters.address, parameters.chain ? { chain: parameters.chain } : {}));
  }

  @Tool({ name: "pre_buy_check", description: LIVE_DESCRIPTIONS.pre_buy_check })
  async preBuyCheck(parameters: PreBuyCheckParams): Promise<string> {
    return run(() => this.client.preBuyCheck(parameters.address));
  }

  @Tool({ name: "check_coins", description: LIVE_DESCRIPTIONS.check_coins })
  async checkCoins(parameters: CheckCoinsParams): Promise<string> {
    return run(() => this.client.checkCoins(parameters.addresses));
  }

  @Tool({
    name: "larp_check",
    description:
      "Is there a real product behind this coin on Robinhood Chain? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: product found, partly found, not found or not read. Information only, not advice.",
  })
  async larpCheck(parameters: LarpCheckParams): Promise<string> {
    return run(() => this.client.larpCheck(parameters.token, { wait: true, ...(parameters.chain ? { chain: parameters.chain } : {}) }));
  }

  @Tool({
    name: "dev_record",
    description:
      "A launcher wallet's record on Robinhood Chain: how many coins it launched, how many graduated, and whether it sold. Information only, not advice.",
  })
  async devRecord(parameters: DevRecordParams): Promise<string> {
    return run(() => this.client.devRecord(parameters.wallet, parameters.chain ? { chain: parameters.chain } : {}));
  }

  @Tool({ name: "wallet_privacy", description: LIVE_DESCRIPTIONS.wallet_privacy })
  async walletPrivacy(parameters: WalletPrivacyParams): Promise<string> {
    return run(() => this.client.walletPrivacy(parameters.wallet));
  }

  @Tool({
    name: "launch_record",
    description:
      "The call Toll froze a few minutes after a Robinhood Chain coin launched, and how it ended 24 hours later. It is not the coin now (use check_coin for that).",
  })
  async launchRecord(parameters: LaunchRecordParams): Promise<string> {
    return run(() => this.client.launchRecord(parameters.address));
  }

  @Tool({ name: "fresh_launches", description: "The newest coins launched on Robinhood Chain, with the first facts Toll reads about each." })
  async freshLaunches(parameters: FreshLaunchesParams): Promise<string> {
    return run(() => this.client.freshLaunches(parameters.limit));
  }

  @Tool({ name: "chain_pulse", description: "How busy Robinhood Chain is right now: launches, graduations and trades." })
  async chainPulse(_parameters: ChainPulseParams): Promise<string> {
    return run(() => this.client.chainPulse());
  }

  @Tool({ name: "check_agent", description: LIVE_DESCRIPTIONS.check_agent })
  async checkAgent(parameters: CheckAgentParams): Promise<string> {
    return run(() => this.client.checkAgent(parameters.id));
  }

  @Tool({ name: "check_hook", description: LIVE_DESCRIPTIONS.check_hook })
  async checkHook(parameters: CheckHookParams): Promise<string> {
    return run(() => this.client.checkHook(parameters.address));
  }

  @Tool({ name: "check_tx", description: LIVE_DESCRIPTIONS.check_tx })
  async checkTx(parameters: CheckTxParams): Promise<string> {
    return run(() => this.client.checkTx({ ...parameters }));
  }

  @Tool({ name: "presign_risk_report", description: LIVE_DESCRIPTIONS.presign_risk_report })
  async presignRiskReport(parameters: PresignRiskReportParams): Promise<string> {
    return run(() => this.client.presignRiskReport({ ...parameters }));
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

  @Tool({ name: "institutions", description: `${LIVE_DESCRIPTIONS.institutions} ${MARKETS_NOTE}` })
  async institutions(parameters: InstitutionsParams): Promise<string> {
    return institutions({ id: parameters.id, limit: parameters.limit }, this.markets);
  }

  @Tool({ name: "guidance", description: `${LIVE_DESCRIPTIONS.guidance} ${MARKETS_NOTE}` })
  async guidance(parameters: GuidanceParams): Promise<string> {
    return guidance({ id: parameters.id, limit: parameters.limit }, this.markets);
  }

  @Tool({
    name: "macro",
    description: `US macro facts: the Treasury daily par yield curve (latest day and 30 days), the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. ${MACRO_NOTE}`,
  })
  async macro(_parameters: MacroParams): Promise<string> {
    return macro(this.markets);
  }

  @Tool({ name: "stock_events", description: `${LIVE_DESCRIPTIONS.stock_events} ${MARKETS_NOTE}` })
  async stockEvents(parameters: StockEventsParams): Promise<string> {
    return run(() => this.client.stockEvents({ since: parameters.since, kind: parameters.kind, limit: parameters.limit }));
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
