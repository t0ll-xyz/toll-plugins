/**
 * @tollxyz/langchain - Toll's checks on Robinhood Chain (coins, agents, pre-sign, Stock Token data) as LangChain JS tools (createAgent, LangGraph ToolNode).
 * Information only, not financial advice.
 */
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
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

/**
 * Returns LangChain tools to pass as `tools` to createAgent, a LangGraph ToolNode, or model.bindTools().
 * Each tool returns Toll's text; the model decides what it means.
 */
export function tollTools(opts: TollToolsOptions = {}): StructuredToolInterface[] {
  const run = runners(opts.client ?? new Toll({ tollKey: opts.tollKey }));
  return pick(opts.only).map(
    (name) =>
      tool(run[name] as (input: any) => Promise<string>, {
        name,
        description: descriptions[name],
        schema: schemas[name],
      }) as unknown as StructuredToolInterface,
  );
}
