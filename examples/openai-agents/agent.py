"""Toll in the OpenAI Agents SDK (Python): the agent checks a Robinhood Chain coin before it buys.

    pip install openai-agents
    export OPENAI_API_KEY=...
    python agent.py 0xTOKEN

Toll is a remote MCP server (https://t0ll.xyz/mcp): no Toll package and no Toll key needed (10 new coins a day free;
pass a Toll key as a header for more, see https://t0ll.xyz/llms.txt). Tested with openai-agents 0.24.
"""
import asyncio
import sys

from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

INSTRUCTIONS = """You trade coins on Robinhood Chain for the user.
Before any buy, call Toll's pre_buy_check with the token address and follow its first line:
BLOCK: do not buy, say why. WAIT: do not buy yet, say when to ask again. WARN: tell the user the reasons and ask.
ALLOW: you may go ahead. Always pass on the full report link. Toll's answers are facts, not advice."""


async def main(token: str) -> None:
    async with MCPServerStreamableHttp(name="Toll", params={"url": "https://t0ll.xyz/mcp"}) as toll:
        agent = Agent(name="Trader", instructions=INSTRUCTIONS, mcp_servers=[toll])
        result = await Runner.run(agent, f"Should I buy {token}? Check it first.")
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3"))
