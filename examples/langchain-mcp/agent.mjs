// Toll in LangChain JS over MCP: Toll's remote MCP server through @langchain/mcp-adapters (v2 MCPAdapter).
//
//   npm install @langchain/mcp-adapters @langchain/core @langchain/langgraph
//   node agent.mjs 0xTOKEN
//
// No Toll package and no Toll key needed (10 new coins a day free; https://t0ll.xyz/llms.txt for more). Without a model
// key it calls pre_buy_check directly; with OPENAI_API_KEY set (npm install langchain @langchain/openai) it also runs an
// agent that must call pre_buy_check before it answers. Tested with @langchain/mcp-adapters 2.0.3.
import { MCPAdapter } from "@langchain/mcp-adapters";

// the core checks; drop this filter to hand the agent every Toll tool
const CORE = ["pre_buy_check", "check_coin", "check_coins", "check_tx", "check_agent", "wallet_approvals", "check_hook"];
const token = process.argv[2] ?? "0x2f009d7d6227f7c17d688d60ddc0e581c9c4fc02";

const adapter = new MCPAdapter({ servers: { toll: { url: "https://t0ll.xyz/mcp" } } });
try {
  const all = await adapter.listTools();
  // v2 names each tool after its server (toll_pre_buy_check); match on the end of the name
  const tools = all.filter((t) => CORE.some((n) => t.name === n || t.name.endsWith(`__${n}`) || t.name.endsWith(`_${n}`)));
  console.log(`Toll tools: ${all.length} served, ${tools.length} kept: ${tools.map((t) => t.name).join(", ")}`);
  const pre = tools.find((t) => t.name.endsWith("pre_buy_check"));
  const out = await pre.invoke({ address: token });
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));

  if (process.env.OPENAI_API_KEY) {
    const { createAgent } = await import("langchain");
    const { ChatOpenAI } = await import("@langchain/openai");
    const agent = createAgent({
      model: new ChatOpenAI({ model: "gpt-4.1-mini" }),
      tools,
      systemPrompt: "Before any buy on Robinhood Chain call pre_buy_check and report its Decision and reasons. On BLOCK do not buy. Facts, not advice.",
    });
    const r = await agent.invoke({ messages: [{ role: "user", content: `Should I buy ${token}?` }] });
    console.log(r.messages.at(-1)?.content);
  }
} finally {
  await adapter.close();
}
