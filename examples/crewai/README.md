# Toll in CrewAI

Toll is a remote MCP server, so CrewAI's MCP adapter loads its tools directly. You don't need a Toll package or a key
to start.

```python
from crewai import Agent
from crewai_tools import MCPServerAdapter   # pip install "crewai-tools[mcp]"

with MCPServerAdapter({"url": "https://t0ll.xyz/mcp", "transport": "streamable-http"}) as tools:
    analyst = Agent(role="Coin analyst", goal="Check coins with Toll before a buy",
                    backstory="You call pre_buy_check and report its decision.", tools=tools)
```

Full example: `crew.py`. Tested with crewai / crewai-tools 1.15. All 24 tools come through, including
`pre_buy_check`, `check_coin`, `check_tx` (pre-sign), `check_agent` and `watch_coin`.

Free: 10 new coins a day. More: a Toll key, or pay per check over x402. See <https://t0ll.xyz/llms.txt>.
