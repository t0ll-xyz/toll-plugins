/**
 * @tollxyz/ai-sdk - Toll coin checks as Vercel AI SDK tools.
 * Information only, not financial advice.
 */
import { tool, type Tool } from "ai";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { z } from "zod/v4";
import { formatResult } from "./format.js";

export { formatResult } from "./format.js";
export { Toll, TollError } from "@tollxyz/sdk";
export type { TollResult } from "@tollxyz/sdk";

export interface TollToolsOptions {
  /** A ready Toll client (for example with a custom fetch). Default: new Toll(). */
  client?: Toll;
  /** Which tools to return. Default: all six. */
  only?: TollToolName[];
}

export type TollToolName = "check_coin" | "larp_check" | "dev_record" | "launch_record" | "fresh_launches" | "chain_pulse";

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
  const toll = opts.client ?? new Toll();
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
  };
  if (!opts.only) return all;
  const picked: Partial<Record<TollToolName, Tool>> = {};
  for (const n of opts.only) picked[n] = all[n];
  return picked;
}
