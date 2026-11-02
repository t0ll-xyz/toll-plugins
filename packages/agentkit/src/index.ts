/**
 * @tollxyz/agentkit - Toll coin checks as a Coinbase AgentKit action provider.
 * Information only, not financial advice.
 */
import { ActionProvider, CreateAction, type Network } from "@coinbase/agentkit";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { z } from "zod";
import { formatResult } from "./format.js";
import { MARKETS_NOTE, stockToken, stockTokens, withTollKey, type FetchLike } from "./markets.js";

export { formatResult } from "./format.js";
export { MARKETS_NOTE, LIMITS_NOTE, paidStockUrl, stockToken, stockTokens, type MarketsOptions } from "./markets.js";
export { Toll, TollError } from "@tollxyz/sdk";
export type { TollResult } from "@tollxyz/sdk";

const address = z.string().describe("Token contract address: 0x + 40 hex on Robinhood Chain or BSC, or a Solana base58 mint.");
const wallet = z.string().describe("Wallet address: 0x + 40 hex.");

export const CheckCoinSchema = z.object({
  address,
  chain: z.enum(["rh", "sol", "bsc"]).optional().describe("rh = Robinhood Chain, sol = Solana, bsc = BSC. Leave out and Toll finds the chain."),
});
export const LarpCheckSchema = z.object({
  token: address,
  chain: z.enum(["rh", "sol"]).optional().describe("rh = Robinhood Chain, sol = Solana."),
});
export const DevRecordSchema = z.object({
  wallet,
  chain: z.enum(["rh", "bsc"]).optional().describe("Default rh (Robinhood Chain)."),
});
export const LaunchRecordSchema = z.object({ address: z.string().describe("Token contract address on Robinhood Chain (0x + 40 hex).") });
export const FreshLaunchesSchema = z.object({ limit: z.number().int().min(1).max(20).optional().describe("How many coins, 1 to 20.") });
export const ChainPulseSchema = z.object({});
export const StockTokenSchema = z.object({
  id: z.string().describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract address on Robinhood Chain (0x + 40 hex)."),
});
export const StockTokensSchema = z.object({
  query: z.string().optional().describe("Optional: part of a ticker or company name to filter by (for example nvid)."),
  limit: z.number().int().min(1).max(250).optional().describe("How many Stock Tokens, 1 to 250."),
});

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
 * Action provider for Toll. Action names AgentKit shows the model are prefixed with the class name,
 * for example `TollActionProvider_check_coin`.
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
    this.client = o.client ?? new Toll({ fetch: withTollKey(this.fetchFn, o.tollKey) });
  }

  @CreateAction({
    name: "check_coin",
    description:
      "Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Information only, not advice.",
    schema: CheckCoinSchema,
  })
  async checkCoin(args: z.infer<typeof CheckCoinSchema>): Promise<string> {
    return run(() => this.client.checkCoin(args.address, args.chain ? { chain: args.chain } : {}));
  }

  @CreateAction({
    name: "larp_check",
    description:
      "Is there a real product behind this coin? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: product found, partly found, not found or not read. Robinhood Chain and Solana. Information only, not advice.",
    schema: LarpCheckSchema,
  })
  async larpCheck(args: z.infer<typeof LarpCheckSchema>): Promise<string> {
    return run(() => this.client.larpCheck(args.token, { wait: true, ...(args.chain ? { chain: args.chain } : {}) }));
  }

  @CreateAction({
    name: "dev_record",
    description:
      "A launcher wallet's record: how many coins it launched, how many graduated, and whether it sold. Robinhood Chain (default) or BSC. Information only, not advice.",
    schema: DevRecordSchema,
  })
  async devRecord(args: z.infer<typeof DevRecordSchema>): Promise<string> {
    return run(() => this.client.devRecord(args.wallet, args.chain ? { chain: args.chain } : {}));
  }

  @CreateAction({
    name: "launch_record",
    description:
      "The call Toll froze 3 minutes after a Robinhood Chain coin launched, and how it ended 24 hours later. It is not the coin now (use check_coin for that).",
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

  @CreateAction({
    name: "stock_token",
    description: `One Robinhood Stock Token on Robinhood Chain by ticker or contract: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier, corporate actions and the company's SEC facts, each with its source and time. ${MARKETS_NOTE}`,
    schema: StockTokenSchema,
  })
  async stockToken(args: z.infer<typeof StockTokenSchema>): Promise<string> {
    return stockToken(args.id, { fetch: this.fetchFn, tollKey: this.tollKey });
  }

  @CreateAction({
    name: "stock_tokens",
    description: `The Robinhood Stock Tokens on Robinhood Chain: ticker, name, contract, multiplier and Chainlink reference price, optionally filtered by a query. ${MARKETS_NOTE}`,
    schema: StockTokensSchema,
  })
  async stockTokens(args: z.infer<typeof StockTokensSchema>): Promise<string> {
    return stockTokens({ query: args.query, limit: args.limit }, { fetch: this.fetchFn, tollKey: this.tollKey });
  }

  /** Toll reads public chain data, so it works whatever network the agent's wallet is on. */
  supportsNetwork(_network: Network): boolean {
    return true;
  }
}

export const tollActionProvider = (clientOrOptions?: Toll | TollActionProviderOptions): TollActionProvider =>
  new TollActionProvider(clientOrOptions);
