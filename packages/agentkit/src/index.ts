/**
 * @tollxyz/agentkit - Toll coin checks as a Coinbase AgentKit action provider.
 * Information only, not financial advice.
 */
import { ActionProvider, CreateAction, type Network } from "@coinbase/agentkit";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { z } from "zod";
import { formatResult } from "./format.js";

export { formatResult } from "./format.js";
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

  constructor(client: Toll = new Toll()) {
    super("toll", []);
    this.client = client;
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

  /** Toll reads public chain data, so it works whatever network the agent's wallet is on. */
  supportsNetwork(_network: Network): boolean {
    return true;
  }
}

export const tollActionProvider = (client?: Toll): TollActionProvider => new TollActionProvider(client);
