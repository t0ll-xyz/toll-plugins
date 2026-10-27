# toll-plugins

SDKs and agent plugins for [Toll](https://t0ll.xyz/agents/plugins): coin checks read from the chain
(Robinhood Chain, Solana, BSC) over Toll's remote MCP server. Who is behind a coin, the dev's record,
and whether there is a real product behind it.

| Package | What | Install |
| --- | --- | --- |
| [`@tollxyz/sdk`](packages/sdk-js) | TypeScript client, zero dependencies, `pay()` for the x402 paid path | `npm install @tollxyz/sdk` |
| [`toll-sdk`](packages/sdk-py) | Python client, standard library only (import `toll_sdk`) | `pip install toll-sdk` |
| [`@tollxyz/plugin-elizaos`](packages/plugin-elizaos) | elizaOS actions and provider | `npm install @tollxyz/plugin-elizaos` |
| [`@tollxyz/agentkit`](packages/agentkit) | Coinbase AgentKit action provider | `npm install @tollxyz/agentkit @coinbase/agentkit zod@3` |
| [`@tollxyz/ai-sdk`](packages/ai-sdk) | Vercel AI SDK tools | `npm install @tollxyz/ai-sdk ai zod` |
| [`@tollxyz/goat-plugin`](packages/goat) | GOAT SDK plugin | `npm install @tollxyz/goat-plugin @goat-sdk/core zod@3` |

Example: [`examples/guarded-agent`](examples/guarded-agent), an agent that will not buy until Toll's check passes
(its `buy()` is a stub that never sends a transaction).

The npm packages are ESM only. Free: 10 new coins a day per caller (coins already read stay free); past that, each
answer carries the paid x402 URL for that coin (0.05 USDG on Robinhood Chain), or hold 1M $TOLL.
Docs: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

## Develop

```sh
npm ci && npm run build && npm test                          # every JS package
cd packages/sdk-py && uv run --with pytest pytest            # Python
```

Unit tests make no network calls; `TOLL_LIVE=1` turns on one live smoke test per package.

Information only, not financial advice. MIT.
