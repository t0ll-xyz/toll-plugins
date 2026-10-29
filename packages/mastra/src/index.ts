/**
 * @tollxyz/mastra - Toll coin and agent checks as Mastra tools (new Agent({ tools })).
 * Information only, not financial advice.
 */
import { createTool, type Tool } from "@mastra/core/tools";
import { Toll } from "@tollxyz/sdk";
import { descriptions, pick, runners, schemas, type TollToolName } from "./defs.js";

export { formatResult } from "./format.js";
export { TOOL_NAMES } from "./defs.js";
export type { TollToolName } from "./defs.js";
export { Toll, TollError } from "@tollxyz/sdk";
export type { TollResult } from "@tollxyz/sdk";

export interface TollToolsOptions {
  /** A ready Toll client (for example with a custom fetch). Default: new Toll(). */
  client?: Toll;
  /** Which tools to return. Default: all eight. */
  only?: TollToolName[];
}

export type TollMastraTool = Tool<any, any, any, any, any, string, any>;

/**
 * Returns a record of Mastra tools, keyed by Toll's tool names, to pass as `tools` to new Agent().
 * Each tool returns Toll's text; the model decides what it means.
 */
export function tollTools(opts: TollToolsOptions = {}): Partial<Record<TollToolName, TollMastraTool>> {
  const run = runners(opts.client ?? new Toll());
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
