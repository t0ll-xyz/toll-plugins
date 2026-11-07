// Toll in the OpenAI Agents SDK (JavaScript): the agent checks a Robinhood Chain coin before it buys.
//
//   npm install @openai/agents
//   OPENAI_API_KEY=... node agent.mjs 0xTOKEN
//
// Toll is a remote MCP server (https://t0ll.xyz/mcp): no Toll package and no Toll key needed (10 new coins a day
// free; see https://t0ll.xyz/llms.txt for more). Tested with @openai/agents 0.21.
import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";

const INSTRUCTIONS = `You trade coins on Robinhood Chain for the user.
Before any buy, call Toll's pre_buy_check with the token address and follow its first line:
BLOCK: do not buy, say why. WAIT: do not buy yet, say when to ask again. WARN: tell the user the reasons and ask.
ALLOW: you may go ahead. Always pass on the full report link. Toll's answers are facts, not advice.`;

const token = process.argv[2] ?? "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const toll = new MCPServerStreamableHttp({ url: "https://t0ll.xyz/mcp", name: "Toll" });
await toll.connect();
try {
  const agent = new Agent({ name: "Trader", instructions: INSTRUCTIONS, mcpServers: [toll] });
  const result = await run(agent, `Should I buy ${token}? Check it first.`);
  console.log(result.finalOutput);
} finally {
  await toll.close();
}
