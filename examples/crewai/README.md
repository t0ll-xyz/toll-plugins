# Toll in CrewAI

Toll is a remote MCP server, so CrewAI's MCP adapter loads its tools directly. You don't need a Toll package or a key
to start.

```python
from crewai import Agent
from crewai_tools import MCPServerAdapter   # pip install "crewai-tools[mcp]"

CORE = ("pre_buy_check", "check_coin", "check_coins", "check_tx", "check_agent", "wallet_approvals", "check_hook")
with MCPServerAdapter({"url": "https://t0ll.xyz/mcp", "transport": "streamable-http"}, *CORE) as tools:
    analyst = Agent(role="Coin analyst", goal="Check coins with Toll before a buy",
                    backstory="You call pre_buy_check and report its decision.", tools=tools)
```

Full example: `crew.py`. Written against crewai-tools 1.15 (`MCPServerAdapter(serverparams, *tool_names)`, the names
filter the server's tools). The server serves 29 tools (2026-11-16); the example keeps the core checks: `pre_buy_check`,
`check_coin`, `check_coins`, `check_tx` (pre-sign), `check_agent`, `wallet_approvals` and `check_hook`. Leave the names
out to load all of them.

**Toll's guard:** this example never signs or pays (it reads Toll's tools over MCP and holds no wallet), so there is nothing
for the guard to check. When you give the agent a wallet, put [`@tollxyz/guard`](../../packages/guard) in front of it (`strict: true` and a `budgetMs`): on by default, off only with
`TOLL_GUARD=off`. `npm test` at the repo root fails on a signing or paying call that skips it.

Free: 10 new coins a day. More: a Toll key, or pay per check over x402. See <https://t0ll.xyz/llms.txt>.
