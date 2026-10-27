/**
 * @tollxyz/goat-plugin - Toll coin checks as a GOAT SDK plugin.
 * Information only, not financial advice.
 */
import { PluginBase, Tool, createToolParameters, type Chain } from "@goat-sdk/core";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { z } from "zod";
import { formatResult } from "./format.js";

export { formatResult } from "./format.js";

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

async function run(fn: () => Promise<TollResult>): Promise<string> {
  try {
    return formatResult(await fn());
  } catch (e) {
    return `Toll could not answer: ${e instanceof TollError ? e.message : "request failed"}`;
  }
}

export class TollService {
  constructor(private readonly client: Toll) {}

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
}

export class TollPlugin extends PluginBase {
  constructor(client: Toll = new Toll()) {
    super("toll", [new TollService(client)]);
  }

  /** Toll reads public chain data, so it works whatever chain the agent's wallet is on. */
  supportsChain(_chain: Chain): boolean {
    return true;
  }
}

export const toll = (client?: Toll): TollPlugin => new TollPlugin(client);
