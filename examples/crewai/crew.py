"""Toll in CrewAI: a crew whose analyst checks a Robinhood Chain coin before the trader acts.

    pip install crewai "crewai-tools[mcp]"
    export OPENAI_API_KEY=...        # or any LLM CrewAI supports
    python crew.py 0xTOKEN

Toll is a remote MCP server (https://t0ll.xyz/mcp): no Toll package and no Toll key needed (10 new coins a day free;
see https://t0ll.xyz/llms.txt for more). Tested with crewai / crewai-tools 1.15.
"""
import sys

from crewai import Agent, Crew, Task
from crewai_tools import MCPServerAdapter

TOLL = {"url": "https://t0ll.xyz/mcp", "transport": "streamable-http"}


def main(token: str) -> None:
    with MCPServerAdapter(TOLL) as tools:
        analyst = Agent(
            role="Robinhood Chain coin analyst",
            goal="Say whether a coin is safe enough to buy, from Toll's chain facts only",
            backstory="You never guess: you call Toll's pre_buy_check and report its decision and reasons.",
            tools=tools,
        )
        task = Task(
            description=f"Run pre_buy_check on {token}. Report the decision (BLOCK / WAIT / WARN / ALLOW), up to three reasons and the full report link.",
            expected_output="The decision, the reasons, the link. Facts, not advice.",
            agent=analyst,
        )
        print(Crew(agents=[analyst], tasks=[task]).kickoff())


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3")
