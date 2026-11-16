"""Toll in LangChain (Python) over MCP: Toll's remote MCP server through langchain-mcp-adapters.

    pip install langchain-mcp-adapters
    python agent.py 0xTOKEN

No Toll package and no Toll key needed (10 new coins a day free; https://t0ll.xyz/llms.txt for more). Without a model
key it calls pre_buy_check directly; with OPENAI_API_KEY set (pip install langchain langchain-openai) it also runs an
agent that must call pre_buy_check before it answers. Tested with langchain-mcp-adapters 0.3.2.
For the core checks as plain LangChain tools instead (no MCP session): pip install "toll-sdk[langchain]" and
`from toll_sdk.langchain import toll_tools`.
"""
import asyncio
import os
import sys

from langchain_mcp_adapters.client import MultiServerMCPClient

# the core checks; drop this filter to hand the agent every Toll tool
CORE = {"pre_buy_check", "check_coin", "check_coins", "check_tx", "check_agent", "wallet_approvals", "check_hook"}


async def main(token: str) -> None:
    client = MultiServerMCPClient({"toll": {"url": "https://t0ll.xyz/mcp", "transport": "streamable_http"}})
    every = await client.get_tools()
    tools = [t for t in every if t.name in CORE]
    print(f"Toll tools: {len(every)} served, {len(tools)} kept: {', '.join(t.name for t in tools)}")
    pre = next(t for t in tools if t.name == "pre_buy_check")
    out = await pre.ainvoke({"address": token})
    print(out if isinstance(out, str) else "\n".join(c.get("text", "") for c in out if isinstance(c, dict)))

    if os.environ.get("OPENAI_API_KEY"):
        from langchain.agents import create_agent

        agent = create_agent(
            "openai:gpt-4.1-mini",
            tools=tools,
            system_prompt="Before any buy on Robinhood Chain call pre_buy_check and report its Decision and reasons. "
            "On BLOCK do not buy. Facts, not advice.",
        )
        r = await agent.ainvoke({"messages": [{"role": "user", "content": f"Should I buy {token}?"}]})
        print(r["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "0x2f009d7d6227f7c17d688d60ddc0e581c9c4fc02"))
