/**
 * @tollxyz/mastra - Toll's checks on Robinhood Chain (coins, agents, pre-sign, Stock Token data) as Mastra tools (new Agent({ tools })).
 * Information only, not financial advice.
 */
import { createTool, type Tool } from "@mastra/core/tools";
import { Toll } from "@tollxyz/sdk";
import { descriptions, pick, runners, schemas, type TollToolName } from "./defs.js";

export { formatResult } from "./format.js";
export { TOOL_NAMES } from "./defs.js";
export type { TollToolName } from "./defs.js";
export { Toll, TollError, verifyWebhook, readWebhook } from "@tollxyz/sdk";
export type { TollResult, WatchEvent } from "@tollxyz/sdk";

export interface TollToolsOptions {
  /** A ready Toll client (for example with a custom fetch). Default: new Toll({ tollKey }). */
  client?: Toll;
  /**
   * A Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every call: carries the key wallet's daily tier
   * (more new coins and Markets calls a day, the live stock_events feed). Ignored when client is given.
   */
  tollKey?: string;
  /** Which tools to return. Default: all twenty-eight. */
  only?: TollToolName[];
}

export type TollMastraTool = Tool<any, any, any, any, any, string, any>;

/**
 * Returns a record of Mastra tools, keyed by Toll's tool names, to pass as `tools` to new Agent().
 * Each tool returns Toll's text; the model decides what it means.
 */
export function tollTools(opts: TollToolsOptions = {}): Partial<Record<TollToolName, TollMastraTool>> {
  const run = runners(opts.client ?? new Toll({ tollKey: opts.tollKey }));
  const out: Partial<Record<TollToolName, TollMastraTool>> = {};
  for (const name of pick(opts.only)) {
    out[name] = createTool({
      id: name,
      description: descriptions[name],
      inputSchema: schemas[name] as any,
      execute: async (input: any) => (run[name] as (i: any) => Promise<string>)(input),
    }) as TollMastraTool;
  }
  return out;
}
