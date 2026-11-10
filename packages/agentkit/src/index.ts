/**
 * @tollxyz/agentkit - Toll's checks on Robinhood Chain as a Coinbase AgentKit action provider.
 * Information only, not financial advice.
 */
import { ActionProvider, CreateAction, type Network } from "@coinbase/agentkit";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { z } from "zod";
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
import {
  ChainPulseSchema,
  CheckAgentSchema,
  CheckHookSchema,
  FindPaidApiSchema,
  CheckCoinSchema,
  CheckCoinsSchema,
  PreBuyCheckSchema,
  CheckTxSchema,
  DevRecordSchema,
  FreshLaunchesSchema,
  FundamentalsSchema,
  GuidanceSchema,
  InsiderTradesSchema,
  InstitutionsSchema,
  LarpCheckSchema,
  LaunchRecordSchema,
  MacroSchema,
  PresignRiskReportSchema,
  StockEventsSchema,
  StockTokenSchema,
  StockTokensSchema,
  UnwatchCoinSchema,
  UnwatchWalletSchema,
  WalletApprovalsSchema,
  WalletPrivacySchema,
  WatchCoinSchema,
  WatchWalletSchema,
  MyWatchesSchema,
} from "./schemas.js";

export { formatResult } from "./format.js";
export { LIVE_DESCRIPTIONS, STOCK_EVENT_KINDS } from "./live.js";
export * from "./schemas.js";
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
export { Toll, TollError, verifyWebhook, readWebhook } from "@tollxyz/sdk";
export type { TollResult, WatchEvent } from "@tollxyz/sdk";

export interface TollActionProviderOptions {
  /** A ready Toll client for the MCP actions (its own fetch). Default: a client that sends tollKey. */
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

/**
 * Action provider for Toll (Robinhood Chain, chain id 4663). Action names AgentKit shows the model are prefixed with the
 * class name, for example `TollActionProvider_check_coin`.
 */
export class TollActionProvider extends ActionProvider {
  private readonly client: Toll;
  private readonly fetchFn: FetchLike;
  private readonly tollKey?: string;

  /** Takes a Toll client (as before) or options with a tollKey. */
  constructor(clientOrOptions: Toll | TollActionProviderOptions = {}) {
    super("toll", []);
    const o: TollActionProviderOptions = clientOrOptions instanceof Toll ? { client: clientOrOptions } : clientOrOptions;
    this.tollKey = o.tollKey;
    this.fetchFn = o.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.client = o.client ?? new Toll({ fetch: withTollKey(this.fetchFn, o.tollKey), ...(o.tollKey ? { tollKey: o.tollKey } : {}) });
  }

  private get markets() {
    return { fetch: this.fetchFn, tollKey: this.tollKey };
  }

  @CreateAction({
    name: "check_coin",
    description:
      "Before buying a token on Robinhood Chain, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Robinhood Chain (4663) only. Information only, not advice.",
    schema: CheckCoinSchema,
  })
  async checkCoin(args: z.infer<typeof CheckCoinSchema>): Promise<string> {
    return run(() => this.client.checkCoin(args.address, args.chain ? { chain: args.chain } : {}));
  }

  @CreateAction({ name: "pre_buy_check", description: LIVE_DESCRIPTIONS.pre_buy_check, schema: PreBuyCheckSchema })
  async preBuyCheck(args: z.infer<typeof PreBuyCheckSchema>): Promise<string> {
    return run(() => this.client.preBuyCheck(args.address));
  }

  @CreateAction({ name: "check_coins", description: LIVE_DESCRIPTIONS.check_coins, schema: CheckCoinsSchema })
  async checkCoins(args: z.infer<typeof CheckCoinsSchema>): Promise<string> {
    return run(() => this.client.checkCoins(args.addresses));
  }

  @CreateAction({
    name: "larp_check",
    description:
      "Is there a real product behind this coin on Robinhood Chain? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: product found, partly found, not found or not read. Information only, not advice.",
    schema: LarpCheckSchema,
  })
  async larpCheck(args: z.infer<typeof LarpCheckSchema>): Promise<string> {
    return run(() => this.client.larpCheck(args.token, { wait: true, ...(args.chain ? { chain: args.chain } : {}) }));
  }

  @CreateAction({
    name: "dev_record",
    description:
      "A launcher wallet's record on Robinhood Chain: how many coins it launched, how many graduated, and whether it sold. Information only, not advice.",
    schema: DevRecordSchema,
  })
  async devRecord(args: z.infer<typeof DevRecordSchema>): Promise<string> {
    return run(() => this.client.devRecord(args.wallet, args.chain ? { chain: args.chain } : {}));
  }

  @CreateAction({ name: "wallet_privacy", description: LIVE_DESCRIPTIONS.wallet_privacy, schema: WalletPrivacySchema })
  async walletPrivacy(args: z.infer<typeof WalletPrivacySchema>): Promise<string> {
    return run(() => this.client.walletPrivacy(args.wallet));
  }

  @CreateAction({ name: "wallet_approvals", description: LIVE_DESCRIPTIONS.wallet_approvals, schema: WalletApprovalsSchema })
  async walletApprovals(args: z.infer<typeof WalletApprovalsSchema>): Promise<string> {
    return run(() => this.client.walletApprovals(args.wallet));
  }

  @CreateAction({
    name: "launch_record",
    description:
      "The call Toll froze a few minutes after a Robinhood Chain coin launched, and how it ended 24 hours later. It is not the coin now (use check_coin for that).",
    schema: LaunchRecordSchema,
  })
  async launchRecord(args: z.infer<typeof LaunchRecordSchema>): Promise<string> {
    return run(() => this.client.launchRecord(args.address));
  }

  @CreateAction({
    name: "fresh_launches",
    description: "The newest coins launched on Robinhood Chain, with the first facts Toll reads about each.",
    schema: FreshLaunchesSchema,
  })
  async freshLaunches(args: z.infer<typeof FreshLaunchesSchema>): Promise<string> {
    return run(() => this.client.freshLaunches(args.limit));
  }

  @CreateAction({
    name: "chain_pulse",
    description: "How busy Robinhood Chain is right now: launches, graduations and trades.",
    schema: ChainPulseSchema,
  })
  async chainPulse(_args: z.infer<typeof ChainPulseSchema>): Promise<string> {
    return run(() => this.client.chainPulse());
  }

  @CreateAction({ name: "check_agent", description: LIVE_DESCRIPTIONS.check_agent, schema: CheckAgentSchema })
  async checkAgent(args: z.infer<typeof CheckAgentSchema>): Promise<string> {
    return run(() => this.client.checkAgent(args.id));
  }

  @CreateAction({ name: "find_paid_api", description: LIVE_DESCRIPTIONS.find_paid_api, schema: FindPaidApiSchema })
  async findPaidApi(args: z.infer<typeof FindPaidApiSchema>): Promise<string> {
    return run(() => this.client.findPaidApi(args));
  }

  @CreateAction({ name: "check_hook", description: LIVE_DESCRIPTIONS.check_hook, schema: CheckHookSchema })
  async checkHook(args: z.infer<typeof CheckHookSchema>): Promise<string> {
    return run(() => this.client.checkHook(args.address));
  }

  @CreateAction({ name: "check_tx", description: LIVE_DESCRIPTIONS.check_tx, schema: CheckTxSchema })
  async checkTx(args: z.infer<typeof CheckTxSchema>): Promise<string> {
    return run(() => this.client.checkTx(args));
  }

  @CreateAction({ name: "presign_risk_report", description: LIVE_DESCRIPTIONS.presign_risk_report, schema: PresignRiskReportSchema })
  async presignRiskReport(args: z.infer<typeof PresignRiskReportSchema>): Promise<string> {
    return run(() => this.client.presignRiskReport(args));
  }

  @CreateAction({
    name: "stock_token",
    description: `One Robinhood Stock Token on Robinhood Chain by ticker or contract: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier, corporate actions and the company's SEC facts, each with its source and time. ${MARKETS_NOTE}`,
    schema: StockTokenSchema,
  })
  async stockToken(args: z.infer<typeof StockTokenSchema>): Promise<string> {
    return stockToken(args.id, this.markets);
  }

  @CreateAction({
    name: "stock_tokens",
    description: `The Robinhood Stock Tokens on Robinhood Chain: ticker, name, contract, multiplier and Chainlink reference price, optionally filtered by a query. ${MARKETS_NOTE}`,
    schema: StockTokensSchema,
  })
  async stockTokens(args: z.infer<typeof StockTokensSchema>): Promise<string> {
    return stockTokens({ query: args.query, limit: args.limit }, this.markets);
  }

  @CreateAction({
    name: "fundamentals",
    description: `A company's fundamentals from its SEC filings, by the ticker or contract of its Robinhood Stock Token: revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation at the reference price, every figure with its filing and link. ${MARKETS_NOTE}`,
    schema: FundamentalsSchema,
  })
  async fundamentals(args: z.infer<typeof FundamentalsSchema>): Promise<string> {
    return fundamentals({ id: args.id, period: args.period }, this.markets);
  }

  @CreateAction({
    name: "insider_trades",
    description: `Insider trades from SEC Form 4 filings for the company behind a Robinhood Stock Token: who traded, their role, the transaction code, shares, price and shares owned after, each with its filing link, plus 90-day totals and 13D/13G holders. ${MARKETS_NOTE}`,
    schema: InsiderTradesSchema,
  })
  async insiderTrades(args: z.infer<typeof InsiderTradesSchema>): Promise<string> {
    return insiderTrades({ id: args.id, limit: args.limit }, this.markets);
  }

  @CreateAction({ name: "institutions", description: `${LIVE_DESCRIPTIONS.institutions} ${MARKETS_NOTE}`, schema: InstitutionsSchema })
  async institutions(args: z.infer<typeof InstitutionsSchema>): Promise<string> {
    return institutions({ id: args.id, limit: args.limit }, this.markets);
  }

  @CreateAction({ name: "guidance", description: `${LIVE_DESCRIPTIONS.guidance} ${MARKETS_NOTE}`, schema: GuidanceSchema })
  async guidance(args: z.infer<typeof GuidanceSchema>): Promise<string> {
    return guidance({ id: args.id, limit: args.limit }, this.markets);
  }

  @CreateAction({
    name: "macro",
    description: `US macro facts: the Treasury daily par yield curve (latest day and 30 days), the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. ${MACRO_NOTE}`,
    schema: MacroSchema,
  })
  async macro(_args: z.infer<typeof MacroSchema>): Promise<string> {
    return macro(this.markets);
  }

  @CreateAction({ name: "stock_events", description: `${LIVE_DESCRIPTIONS.stock_events} ${MARKETS_NOTE}`, schema: StockEventsSchema })
  async stockEvents(args: z.infer<typeof StockEventsSchema>): Promise<string> {
    return run(() => this.client.stockEvents(args));
  }

  @CreateAction({ name: "watch_coin", description: LIVE_DESCRIPTIONS.watch_coin, schema: WatchCoinSchema })
  async watchCoin(args: z.infer<typeof WatchCoinSchema>): Promise<string> {
    return run(() => this.client.watchCoin(args.address, args.url));
  }

  @CreateAction({ name: "my_watches", description: LIVE_DESCRIPTIONS.my_watches, schema: MyWatchesSchema })
  async myWatches(_args: z.infer<typeof MyWatchesSchema>): Promise<string> {
    return run(() => this.client.myWatches());
  }

  @CreateAction({ name: "unwatch_coin", description: LIVE_DESCRIPTIONS.unwatch_coin, schema: UnwatchCoinSchema })
  async unwatchCoin(args: z.infer<typeof UnwatchCoinSchema>): Promise<string> {
    return run(() => this.client.unwatchCoin(args.id));
  }

  @CreateAction({ name: "watch_wallet", description: LIVE_DESCRIPTIONS.watch_wallet, schema: WatchWalletSchema })
  async watchWallet(args: z.infer<typeof WatchWalletSchema>): Promise<string> {
    return run(() => this.client.watchWallet(args.address, args.url));
  }

  @CreateAction({ name: "unwatch_wallet", description: LIVE_DESCRIPTIONS.unwatch_wallet, schema: UnwatchWalletSchema })
  async unwatchWallet(args: z.infer<typeof UnwatchWalletSchema>): Promise<string> {
    return run(() => this.client.unwatchWallet(args.id));
  }

  /** Toll reads public chain data, so it works whatever network the agent's wallet is on. */
  supportsNetwork(_network: Network): boolean {
    return true;
  }
}

export const tollActionProvider = (clientOrOptions?: Toll | TollActionProviderOptions): TollActionProvider =>
  new TollActionProvider(clientOrOptions);
