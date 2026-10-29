/**
 * @tollxyz/langchain - Toll coin and agent checks as LangChain JS tools (createAgent, LangGraph ToolNode).
 * Information only, not financial advice.
 */
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
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

/**
 * Returns LangChain tools to pass as `tools` to createAgent, a LangGraph ToolNode, or model.bindTools().
 * Each tool returns Toll's text; the model decides what it means.
 */
export function tollTools(opts: TollToolsOptions = {}): StructuredToolInterface[] {
  const run = runners(opts.client ?? new Toll());
  return pick(opts.only).map(
    (name) =>
      tool(run[name] as (input: any) => Promise<string>, {
        name,
        description: descriptions[name],
        schema: schemas[name],
      }) as unknown as StructuredToolInterface,
  );
}
