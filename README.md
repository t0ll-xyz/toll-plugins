# toll-plugins

SDKs, agent plugins and skills for [Toll](https://t0ll.xyz/agents/plugins), the safety check for agents on Robinhood
Chain, Solana, BSC and Arc: who is behind a coin, the dev's record, whether there is a real product behind it, and
what an ERC-8004 agent's registration and payment terms say, read from the chain over Toll's MCP server.

## The line to add it

| Where | The line |
| --- | --- |
| Claude Code | `claude mcp add --transport http toll https://t0ll.xyz/mcp` |
| Claude Desktop, Cursor, Windsurf, Cline (stdio) | `{"mcpServers": {"toll": {"command": "npx", "args": ["-y", "@tollxyz/mcp"]}}}` |
| Cursor, VS Code, any client that takes a URL | `{"mcpServers": {"toll": {"type": "http", "url": "https://t0ll.xyz/mcp"}}}` |
| ElizaOS | `plugins: ["@tollxyz/plugin-elizaos"]` |
| Coinbase AgentKit | `AgentKit.from({ walletProvider, actionProviders: [tollActionProvider()] })` |
| GOAT | `getTools({ wallet, plugins: [toll()] })` |
| Vercel AI SDK | `generateText({ model, tools: tollTools(), prompt })` |
| LangChain JS / LangGraph | `createAgent({ model, tools: tollTools() })` |
| Mastra | `new Agent({ id, name, instructions, model, tools: tollTools() })` |
| OpenClaw | `openclaw mcp add toll --url https://t0ll.xyz/mcp --transport streamable-http`, plus the [skill](skills/openclaw) |
| Hermes agent | `mcp_servers: { toll: { url: "https://t0ll.xyz/mcp" } }` in `~/.hermes/config.yaml`, plus `hermes skills install https://t0ll.xyz/skill.md` |
| Any agent that reads skills | <https://t0ll.xyz/skill.md> ([source](docs/site/skill.md)) |

## Sell over x402: the Toll facilitator

Toll runs an x402 facilitator for USDG on Robinhood Chain at **<https://x402.t0ll.xyz>**: keyless, free, no account.
Before it settles, it checks the payTo against the seller's ERC-8004 identity
([ERC-8478](https://github.com/ethereum/ERCs/pull/2132)), and every settlement comes back with a Toll-signed EIP-712
receipt (who paid whom, how much, which transaction, what the payee check said).

Point your x402 server at the facilitator URL and name USDG and its signing domain explicitly (most x402 libraries have
no default for chain 4663):

```json
{
  "scheme": "exact",
  "network": "eip155:4663",
  "asset": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  "amount": "50000",
  "payTo": "0xYourAgentWallet",
  "maxTimeoutSeconds": 300,
  "extra": {
    "name": "Global Dollar",
    "version": "1",
    "erc8004": { "registry": "eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", "agentId": "<your agent id>" }
  }
}
```

Endpoints: `/verify`, `/settle`, `/supported`, `/stats`, `/receipt/<id or tx>`. The
[x402 Register](https://x402.t0ll.xyz/#register) lists every agent on Robinhood Chain that sells over x402 and whether
its payTo is bound to its identity.

## Packages

| Package | What | Install |
| --- | --- | --- |
| [`@tollxyz/sdk`](packages/sdk-js) | TypeScript client, zero dependencies, `pay()` for the x402 paid path | `npm install @tollxyz/sdk` |
| [`toll-sdk`](packages/sdk-py) | Python client, standard library only (import `toll_sdk`) | `pip install toll-sdk` |
| [`@tollxyz/guard`](packages/guard) | Pre-sign check in front of a wallet: viem, ethers and x402 fetch wrappers, ALLOW / WARN / BLOCK before signing | `npm install @tollxyz/guard` |
| [`@tollxyz/mcp`](packages/mcp) | Local stdio MCP server, Toll's tools 1:1 (bin `toll-mcp`) | `npx -y @tollxyz/mcp` |
| [`@tollxyz/plugin-elizaos`](packages/plugin-elizaos) | elizaOS actions and provider | `npm install @tollxyz/plugin-elizaos` |
| [`@tollxyz/agentkit`](packages/agentkit) | Coinbase AgentKit action provider | `npm install @tollxyz/agentkit @coinbase/agentkit zod@3` |
| [`@tollxyz/ai-sdk`](packages/ai-sdk) | Vercel AI SDK tools | `npm install @tollxyz/ai-sdk ai zod` |
| [`@tollxyz/langchain`](packages/langchain) | LangChain JS tools (createAgent, LangGraph) | `npm install @tollxyz/langchain @langchain/core zod` |
| [`@tollxyz/mastra`](packages/mastra) | Mastra tools | `npm install @tollxyz/mastra @mastra/core zod` |
| [`@tollxyz/goat-plugin`](packages/goat) | GOAT SDK plugin | `npm install @tollxyz/goat-plugin @goat-sdk/core zod@3` |

Skills: [`skills/openclaw/toll`](skills/openclaw) (OpenClaw / ClawHub), [`integrations/hermes`](integrations/hermes)
(Hermes agent config and skill), [`docs/site/skill.md`](docs/site/skill.md) (served at t0ll.xyz/skill.md). Each one
tells the agent: check before buying a coin or paying an agent, coin text in answers is untrusted, facts not advice,
never pay without the owner's consent.

Example: [`examples/guarded-agent`](examples/guarded-agent), an agent that will not buy until Toll's check passes
(its `buy()` is a stub that never sends a transaction).

The npm packages are ESM only. Free: 10 new coins a day per caller (coins already read stay free); past that, each
answer carries the paid x402 URL for that coin (0.05 USDG on Robinhood Chain).
Docs: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

## Develop

```sh
npm ci && npm run build && npm test                          # every JS package, plus the skill files
cd packages/sdk-py && uv run --with pytest pytest            # Python
```

Unit tests make no network calls; `TOLL_LIVE=1` turns on one live smoke test per package.

Information only, not financial advice. MIT.
