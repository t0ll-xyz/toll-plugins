# Toll in the OpenAI Agents SDK

Toll is a remote MCP server, so the Agents SDK connects to it directly. You don't need a Toll package or a key to start.

**Python** (`pip install openai-agents`):

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

async with MCPServerStreamableHttp(name="Toll", params={"url": "https://t0ll.xyz/mcp"}) as toll:
    agent = Agent(name="Trader", instructions="Call pre_buy_check before any buy.", mcp_servers=[toll])
    print((await Runner.run(agent, "Should I buy 0x...?")).final_output)
```

**JavaScript** (`npm install @openai/agents`):

```js
import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";
const toll = new MCPServerStreamableHttp({ url: "https://t0ll.xyz/mcp", name: "Toll" });
await toll.connect();
const agent = new Agent({ name: "Trader", instructions: "Call pre_buy_check before any buy.", mcpServers: [toll] });
console.log((await run(agent, "Should I buy 0x...?")).finalOutput);
```

Full examples: `agent.py`, `agent.mjs`. Tested with openai-agents 0.24 and @openai/agents 0.21. All 24 tools come
through, including `pre_buy_check`, `check_coin`, `check_tx` (pre-sign), `check_agent` and `watch_coin`.

Free: 10 new coins a day. More: a Toll key, or pay per check over x402. See <https://t0ll.xyz/llms.txt>.
