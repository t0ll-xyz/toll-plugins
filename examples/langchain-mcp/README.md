# Toll in LangChain over MCP

Toll is a remote MCP server (`https://t0ll.xyz/mcp`), so LangChain's MCP adapters load its tools directly. You don't
need a Toll package or a key to start (10 new coins a day free).

**Python** (`pip install langchain-mcp-adapters`):

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({"toll": {"url": "https://t0ll.xyz/mcp", "transport": "streamable_http"}})
tools = await client.get_tools()            # pass to create_agent(model, tools=tools)
```

**JavaScript** (`npm install @langchain/mcp-adapters @langchain/core @langchain/langgraph`):

```js
import { MCPAdapter } from "@langchain/mcp-adapters";
const adapter = new MCPAdapter({ servers: { toll: { url: "https://t0ll.xyz/mcp" } } });
const tools = await adapter.listTools();    // pass to createAgent({ model, tools }); adapter.close() when done
```

Full examples: `agent.py`, `agent.mjs`. Each keeps the core checks (`pre_buy_check`, `check_coin`, `check_coins`,
`check_tx`, `check_agent`, `wallet_approvals`, `check_hook`) and calls `pre_buy_check` once; with `OPENAI_API_KEY` set
it also runs an agent. Tested 2026-11-16 against the live server with langchain-mcp-adapters 0.3.2 (29 tools served,
names as the server names them) and @langchain/mcp-adapters 2.0.3 (29 tools, named `toll_<tool>` after the server).

Without MCP: the same core checks as plain tools, `pip install "toll-sdk[langchain]"` then
`from toll_sdk.langchain import toll_tools` (Python), or `npm install @tollxyz/langchain` then
`tollTools({ budgetMs: 1100 })` (JS). Both take a time budget for pre_buy_check and check_tx; the MCP route does not.

**Toll's guard:** this example never signs or pays (it reads Toll's tools over MCP and holds no wallet), so there is nothing
for the guard to check. When you give the agent a wallet, put [`@tollxyz/guard`](../../packages/guard) in front of it (`strict: true` and a `budgetMs`): on by default, off only with
`TOLL_GUARD=off`. `npm test` at the repo root fails on a signing or paying call that skips it.

Not read and WARN are never clear: pass every warning on, and on BLOCK do not buy or sign without the user's say.
See <https://t0ll.xyz/llms.txt>.
