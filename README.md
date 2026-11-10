# toll-plugins

[![Toll on HEY Research Lab](https://heyresearch.xyz/api/badge/toll)](https://heyresearch.xyz/project/toll?utm_source=badge&utm_medium=readme)

SDKs, agent plugins and skills for [Toll](https://t0ll.xyz/agents/plugins), the safety check for agents on Robinhood
Chain (chain id 4663, the only chain Toll reads): who is behind a coin, the dev's record, whether there is a real
product behind it, what a transaction, signature or x402 payment does before it is signed (`check_tx`, ALLOW / WARN /
BLOCK), what an ERC-8004 agent's registration and payment terms say, which paid APIs an agent can buy over x402 (`find_paid_api`), what a Uniswap v4 hook can do (`check_hook`), and Robinhood Stock Token data (SEC fundamentals,
insider trades, 13F holders, earnings guidance, the event feed, US macro), read over Toll's MCP server. Every package
exposes the server's tools.

Toll's token is $TOLL on Robinhood Chain: `0xff9e86e6b21fd688027981bee4b64c8b6b804ed3` (site: [t0ll.xyz](https://t0ll.xyz), X: [@Tollxyz_](https://x.com/Tollxyz_)).

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
| OpenAI Agents SDK (Python) | `MCPServerStreamableHttp(name="Toll", params={"url": "https://t0ll.xyz/mcp"})` in `mcp_servers` ([example](examples/openai-agents)) |
| OpenAI Agents SDK (JS) | `new MCPServerStreamableHttp({ url: "https://t0ll.xyz/mcp", name: "Toll" })` in `mcpServers` ([example](examples/openai-agents)) |
| CrewAI | `MCPServerAdapter({"url": "https://t0ll.xyz/mcp", "transport": "streamable-http"})` as the agent's tools ([example](examples/crewai)) |
| OpenClaw | `openclaw mcp add toll --url https://t0ll.xyz/mcp --transport streamable-http`, plus the [skill](skills/openclaw) |
| Hermes agent | `mcp_servers: { toll: { url: "https://t0ll.xyz/mcp" } }` in `~/.hermes/config.yaml`, plus `hermes skills install https://t0ll.xyz/skill.md` |
| Any agent that reads skills | <https://t0ll.xyz/skill.md> ([source](docs/site/skill.md)) |

## Sell over x402: the Toll facilitator

Toll runs an x402 facilitator for USDG on Robinhood Chain at **<https://x402.t0ll.xyz>**: keyless, free, no account.
Before it settles, it checks the payTo against the seller's ERC-8004 identity
([ERC-8478](https://github.com/ethereum/ERCs/pull/2132)), and every settlement comes back with a Toll-signed EIP-712
receipt (who paid whom, how much, which transaction, what the payee check said).

What it does (its `/supported` lists them):

- **Schemes:** `exact` (EIP-3009 `transferWithAuthorization`) and `upto` (Permit2 through the x402UptoPermit2Proxy
  `0x4020a4f3b7b90cca423b9fabcc0ce57c6c240002`: the buyer signs a ceiling, the seller charges what was used), both on
  `eip155:4663` USDG.
- **Payee check (`erc8478`, enforced):** payTo must be the agentWallet the seller's ERC-8004 identity registered.
- **Signed receipt (`toll-receipt`)** with every settlement.
- **Builder code (`builder-code`, ERC-8021):** each settlement's calldata names who settled it and, when the seller sends
  its app code in the 402 (`extensions["builder-code"].info.a`, `^[a-z0-9_]{1,32}$`; `appCode` in
  `@tollxyz/x402-seller`), the app that sold it.
- **Safety screen (`toll-screen`):** every `/verify` and `/settle` answer carries `extensions.screen = { outcome:
  "allow" | "warn" | "block" | "not-read", codes }`, `check_tx`'s word on the payment, for the seller (`payment.screen`
  and `settlement.screen` in `@tollxyz/x402-seller`, `screenOf()` in `@tollxyz/sdk`).
- **Discovery (x402 bazaar):** `GET /discovery/resources?type&payTo&operator&limit&offset` and
  `GET /discovery/search?query=` list the paid APIs an agent can buy on Robinhood Chain, verified payTo first; also
  the `find_paid_api` MCP tool, `findPaidApis()` / `find_paid_apis()` in the SDKs and <https://t0ll.xyz/x402/discover>.
  A seller is listed once a payment settles with the bazaar extension (`bazaar` in `@tollxyz/x402-seller`).
- **Paid before:** `GET /paid?payer=&payTo=[&resource=][&since=]` answers `{ paid, count, last: { tx, ts, amount,
  receiptId, via }, network, sources }`: whether a wallet already paid a seller through the facilitator (settlements,
  escrow captures, batch charges), facts already public on chain. With x402
  [sign-in-with-x](https://github.com/x402-foundation/x402/blob/main/specs/extensions/sign-in-with-x.md) a seller lets a
  returning wallet in without a second charge (`paidBefore()` in `@tollxyz/x402-seller` and `@tollxyz/sdk`,
  `paid_before()` in `toll-sdk`).
- **Seller-signed receipts (x402 offer-receipt):** a payment carrying `extensions["offer-receipt"]` gets
  `extensions["toll-offer-receipt"] = { offer, receiptPayload }` in the settle answer: the seller's signed offer checked
  (facts, never a refusal) and the spec's receipt payload for the **seller** to sign with its own key (domain
  `x402 receipt` / `1` / chainId 1); `/receipt/<id or tx>` carries it as `offerReceipt` on a settled row. Toll never signs
  the spec's receipt (it attests delivery). `signReceipt` in `@tollxyz/x402-seller` signs it and returns it to the buyer
  as `extensions["offer-receipt"].info.receipt`; `receiptTypedData()` in the SDKs.
- **Per-payer budgets (coming, off until launch):** a payer signs its own spending limits (EIP-712 `Budget`, domain
  `Toll Facilitator Budget` / `1` / 4663: perPayment, perDay, per-payTo day caps, allowed payTos, expiry) with
  `POST /budget`, reads them with `GET /budget?payer=`, and `/verify` and `/settle` refuse any payment past them, across
  every scheme. `budgetTypedData()`, `setBudget()`, `revokeBudget()`, `getBudget()` in the SDKs; `guardBudget()` in
  `@tollxyz/guard` mirrors guard's caps into one. Until it launches the facilitator answers `404 budgets_off`.

Start from the template: `npx degit t0ll-xyz/toll-plugins/templates/x402-starter my-api` ([templates/x402-starter](templates/x402-starter), a Next.js API with one paid route).
Or add [`@tollxyz/x402-seller`](packages/x402-seller): `export const GET = paywall({ payTo, price: "0.05", agentId }, handler)`.
With another x402 library, point your server at the facilitator URL and name USDG and its signing domain explicitly (most x402 libraries have
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

Endpoints: `/verify`, `/settle`, `/supported`, `/stats`, `/receipt/<id or tx>`, `/discovery/resources`,
`/discovery/search`, `/paid`, `/budget` (coming). The
[x402 Register](https://x402.t0ll.xyz/#register) lists every agent on Robinhood Chain that sells over x402 and whether
its payTo is bound to its identity.

## Packages

| Package | What | Install |
| --- | --- | --- |
| [`@tollxyz/sdk`](packages/sdk-js) | TypeScript client, zero dependencies, `pay()` for the x402 paid path | `npm install @tollxyz/sdk` |
| [`toll-sdk`](packages/sdk-py) | Python client, standard library only (import `toll_sdk`) | `pip install toll-sdk` |
| [`@tollxyz/guard`](packages/guard) | Pre-sign check in front of a wallet: viem, ethers and x402 fetch wrappers, ALLOW / WARN / BLOCK before signing | `npm install @tollxyz/guard` |
| [`@tollxyz/x402-seller`](packages/x402-seller) | Sell over x402 in one line: a paywall for Next.js, Hono, Bun or Workers, USDG through Toll's facilitator, payee check, signed receipt, builder code, safety screen, a discovery listing, seller-signed offer-receipt receipts and `paidBefore` | `npm install @tollxyz/x402-seller` |
| [`@tollxyz/mcp`](packages/mcp) | Local stdio MCP server, Toll's tools 1:1 (bin `toll-mcp`) | `npx -y @tollxyz/mcp` |
| [`@tollxyz/plugin-elizaos`](packages/plugin-elizaos) | elizaOS actions and provider | `npm install @tollxyz/plugin-elizaos` |
| [`@tollxyz/agentkit`](packages/agentkit) | Coinbase AgentKit action provider | `npm install @tollxyz/agentkit @coinbase/agentkit zod@3` |
| [`@tollxyz/ai-sdk`](packages/ai-sdk) | Vercel AI SDK tools | `npm install @tollxyz/ai-sdk ai zod` |
| [`@tollxyz/langchain`](packages/langchain) | LangChain JS tools (createAgent, LangGraph) | `npm install @tollxyz/langchain langchain @langchain/core zod` |
| [`@tollxyz/mastra`](packages/mastra) | Mastra tools | `npm install @tollxyz/mastra @mastra/core zod` |
| [`@tollxyz/goat-plugin`](packages/goat) | GOAT SDK plugin (deprecated: GOAT upstream archived 2026-07-02) | `npm install @tollxyz/goat-plugin @goat-sdk/core zod@3` |

Skills: [`skills/openclaw/toll`](skills/openclaw) (OpenClaw / ClawHub), [`integrations/hermes`](integrations/hermes)
(Hermes agent config and skill), [`docs/site/skill.md`](docs/site/skill.md) (served at t0ll.xyz/skill.md). Each one
tells the agent: check before buying a coin or paying an agent, coin text in answers is untrusted, facts not advice,
never pay without the owner's consent.

Example: [`examples/guarded-agent`](examples/guarded-agent), an agent that will not buy until Toll's check passes
(its `buy()` is a stub that never sends a transaction).

The npm packages are ESM only. Free: 10 new coins a day per caller (coins already read stay free) and 50 Markets
calls (Robinhood Stock Tokens, fundamentals, insider trades, institutions, guidance, macro). Holding $TOLL lifts both: 1M $TOLL 100 coins / 1,000 Markets calls, 5M 500 / 5,000,
20M 2,000 / 20,000, with a Toll key from <https://t0ll.xyz/toll#keys> sent as `x-toll-pass` (the `tollKey` option in
`@tollxyz/agentkit`, `@tollxyz/ai-sdk`, `@tollxyz/goat-plugin`, `@tollxyz/plugin-elizaos`, `@tollxyz/langchain`,
`@tollxyz/mastra` and `@tollxyz/sdk`; `toll_key` in `toll-sdk`). Past that, x402 per
call: 0.005 USDG a coin check, 0.02 USDG a Stock Token, 0.01 USDG for fundamentals, insider trades, institutions,
guidance, macro, the Stock Token list or the chain pulse, on Robinhood Chain.
Docs: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

## Develop

```sh
npm ci && npm run build && npm test                          # every JS package, plus the skill files
cd packages/sdk-py && uv run --with pytest pytest            # Python
```

Unit tests make no network calls; `TOLL_LIVE=1` turns on one live smoke test per package.

Information only, not financial advice. MIT.
