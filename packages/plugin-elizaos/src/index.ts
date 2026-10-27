/**
 * @tollxyz/plugin-elizaos - Toll coin checks for elizaOS agents.
 * Information only, not financial advice.
 */
import type { Action, HandlerCallback, IAgentRuntime, Memory, Plugin, Provider, State } from "@elizaos/core";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { extractAddress, extractWallet, formatResult } from "./format.js";

export { extractAddress, extractWallet, formatResult } from "./format.js";
export { Toll, TollError } from "@tollxyz/sdk";
export type { TollResult } from "@tollxyz/sdk";

export interface TollPluginOptions {
  /** A ready Toll client (for example with a custom fetch). Default: new Toll(). */
  client?: Toll;
}

const textOf = (m: Memory): string => (typeof m?.content?.text === "string" ? m.content.text : "");

function makeAction(
  client: Toll,
  spec: {
    name: string;
    similes: string[];
    description: string;
    canRun: (text: string) => boolean;
    run: (client: Toll, text: string) => Promise<TollResult>;
    example: [string, string];
  },
): Action {
  return {
    name: spec.name,
    similes: spec.similes,
    description: spec.description,
    validate: async (_rt: IAgentRuntime, message: Memory) => spec.canRun(textOf(message)),
    handler: async (_rt: IAgentRuntime, message: Memory, _state?: State, _options?: unknown, callback?: HandlerCallback) => {
      try {
        const text = formatResult(await spec.run(client, textOf(message)));
        await callback?.({ text, actions: [spec.name], source: message.content?.source });
        return { success: true, text, data: { actionName: spec.name } };
      } catch (e) {
        const msg = e instanceof TollError ? e.message : "Toll could not be reached. Try again later.";
        await callback?.({ text: msg, actions: [spec.name], source: message.content?.source });
        return { success: false, text: msg, error: msg };
      }
    },
    examples: [
      [
        { name: "{{user1}}", content: { text: spec.example[0] } },
        { name: "{{agent}}", content: { text: spec.example[1], actions: [spec.name] } },
      ],
    ],
  };
}

export function createTollActions(client: Toll): Action[] {
  const CA = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
  return [
    makeAction(client, {
      name: "TOLL_CHECK_COIN",
      similes: ["CHECK_COIN", "CHECK_TOKEN", "WHO_IS_BEHIND_COIN", "TOLL_CHECK"],
      description:
        "Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Needs the token contract address in the message. Information only, not advice.",
      canRun: (t) => extractAddress(t) !== null,
      run: (c, t) => {
        const a = extractAddress(t)!;
        return c.checkCoin(a.address, a.chain ? { chain: a.chain } : {});
      },
      example: [`check this coin before I buy ${CA}`, "Here is what Toll read from the chain for that token."],
    }),
    makeAction(client, {
      name: "TOLL_LARP_CHECK",
      similes: ["LARP_CHECK", "IS_THERE_A_PRODUCT", "PRODUCT_CHECK"],
      description:
        "Is there a real product behind this coin? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: found, partly found, not found or not read. Robinhood Chain and Solana. Information only, not advice.",
      canRun: (t) => extractAddress(t) !== null,
      run: (c, t) => {
        const a = extractAddress(t)!;
        const chain = a.chain === "sol" ? "sol" : a.chain === "rh" ? "rh" : undefined;
        return c.larpCheck(a.address, { wait: true, ...(chain ? { chain } : {}) });
      },
      example: [`is there a real product behind ${CA}?`, "Here is Toll's LARP check for that coin."],
    }),
    makeAction(client, {
      name: "TOLL_DEV_RECORD",
      similes: ["DEV_RECORD", "DEV_HISTORY", "WALLET_LAUNCH_HISTORY"],
      description:
        "A launcher wallet's record: how many coins it launched, how many graduated, and whether it sold. Needs a 0x wallet address in the message. Robinhood Chain (default) or BSC. Information only, not advice.",
      canRun: (t) => extractWallet(t) !== null,
      run: (c, t) => {
        const w = extractWallet(t)!;
        return c.devRecord(w.wallet, w.chain ? { chain: w.chain } : {});
      },
      example: [`what has the dev ${CA} launched before?`, "Here is that wallet's launch record from Toll."],
    }),
  ];
}

/** Adds Toll's note to the context only when the message holds a token address; otherwise nothing. */
export function createTollProvider(): Provider {
  return {
    name: "TOLL_COIN_HINT",
    description: "When a message contains a token address, tells the agent Toll can check who is behind it.",
    get: async (_rt: IAgentRuntime, message: Memory) => {
      const a = extractAddress(textOf(message));
      if (!a) return { text: "", values: {}, data: {} };
      return {
        text: `A token address (${a.address}) is in the message. Toll can check who is behind it (actions TOLL_CHECK_COIN, TOLL_LARP_CHECK). Information only, not advice.`,
        values: { tollAddress: a.address },
        data: { address: a.address, ...(a.chain ? { chain: a.chain } : {}) },
      };
    },
  };
}

export function createTollPlugin(opts: TollPluginOptions = {}): Plugin {
  const client = opts.client ?? new Toll();
  return {
    name: "toll",
    description:
      "Toll coin checks for Robinhood Chain, Solana and BSC: who is behind a coin, the dev's record, whether there is a real product. Information only, not advice.",
    actions: createTollActions(client),
    providers: [createTollProvider()],
  };
}

export const tollPlugin: Plugin = createTollPlugin();
export default tollPlugin;
