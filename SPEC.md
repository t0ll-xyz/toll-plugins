# Toll plugins — build spec (2026-10-27)

Goal: any agent, bot or app can find Toll, use it in one line, and pay for it past the free coins.
Owner approved: npm + PyPI accounts (he creates them), Coinbase developer account for USDC on Base/Solana
(later step), public PRs from the t0ll-xyz GitHub org.

## The one backend everything wraps

Toll's remote MCP server: `POST https://t0ll.xyz/mcp`, JSON-RPC 2.0, stateless, no auth, no session needed.
Headers: `content-type: application/json`, `accept: application/json, text/event-stream`.
- `{"method":"tools/list"}` -> `result.tools[]` (name, title, description, inputSchema)
- `{"method":"tools/call","params":{"name":<tool>,"arguments":{...}}}` -> `result.content[0].text` (markdown text),
  `result.isError` on bad input.

Tools (names and arguments are the server's; check `tools/list` before coding, never guess):
- `check_coin(address, chain?)` chain in rh|sol|bsc (arc exists but is parked: do not advertise it)
- `larp_check(address, chain?)` rh|sol: is there a real product behind the coin. Labels: found / partly found / not found /
  not read. May answer "still reading, ask again in N s" for a coin read for the first time.
- `dev_record(wallet, chain?)`, `launch_record(address)`, `wallet_privacy(wallet)`, `fresh_launches(limit?)`, `chain_pulse()`

Free: 10 new coins a day per caller (coins already read stay free). Past it, the answer text ends with the paid x402 URL:
`https://t0ll.xyz/api/x402/check/{token}?chain=..` or `https://t0ll.xyz/api/x402/larp/{token}?chain=..` (0.05 USDG on
Robinhood Chain, eip155:4663, Priors facilitator; JSON answer; charged only for a whole answer; 402 `{"pending":true}`
-> resend the same payment header after Retry-After). Docs: https://t0ll.xyz/llms.txt, https://t0ll.xyz/agents/x402.

## Packages (monorepo C:\Users\soliman\toll-plugins, npm workspaces, MIT, author "Toll")

1. `packages/sdk-js` -> npm `@t0ll/sdk`. Zero runtime deps (global fetch, Node >= 18). ESM + types (tsc).
   `new Toll({ baseUrl?, fetch?, payFetch?, timeoutMs? })`. Methods: `checkCoin`, `larpCheck`, `devRecord`, `launchRecord`,
   `walletPrivacy`, `freshLaunches`, `chainPulse`, `tools()`, `call(name, args)`. Each returns
   `{ text: string, paidUrl: string | null, pending: { retryAfterS: number } | null }`.
   `paidUrl` parsed from the text (only https://t0ll.xyz/api/x402/...). `larpCheck(addr, { wait: true })` re-asks after the
   given seconds until done (max 3 tries, max 120 s total). `pay(paidUrl)`: GET with the caller's `payFetch` (an x402-aware
   fetch the caller brings, e.g. from x402-fetch); without one it throws a clear error; handles 402 pending + Retry-After;
   returns the JSON. Input validation: 0x + 40 hex or base58 32-44 chars; never send anything else.
2. `packages/sdk-py` -> PyPI `toll-sdk` (import `toll`). Stdlib only (urllib), Python >= 3.9, same API in snake_case,
   `pay(url, session)` takes any callable that does an x402 GET. pytest tests.
3. `packages/plugin-elizaos` -> npm `@t0ll/plugin-elizaos`. Current elizaOS plugin shape (read docs.elizaos.ai/plugins/development
   and an official plugin in github.com/elizaOS before writing): actions TOLL_CHECK_COIN, TOLL_LARP_CHECK, TOLL_DEV_RECORD
   (validate: message holds an address; handler: sdk call, callback with the text), a provider that adds nothing unless
   an address is in the message. Uses `@t0ll/sdk`.
4. `packages/agentkit` -> npm `@t0ll/agentkit`. Coinbase AgentKit `ActionProvider` subclass, `@CreateAction` per tool with
   zod schemas, `supportsNetwork` true (reads are chain-agnostic). Read the current coinbase/agentkit source for the exact
   base class / decorator / export names before writing.
5. `packages/ai-sdk` -> npm `@t0ll/ai-sdk`. Vercel AI SDK `tool()` objects (`tollTools(opts)` returns a record), zod inputs.
6. `packages/goat` -> npm `@t0ll/goat-plugin`. GOAT SDK plugin (repo goat-sdk/goat, last push 2026-07: low priority, keep tiny).
7. `examples/guarded-agent`: a plain TS script "an agent that won't buy until Toll's check passes": takes a token, runs
   checkCoin + larpCheck, prints the decision rule outcome (e.g. refuses when the tally has "against" findings or the
   product is "not found"), and a stub `buy()` that never sends a transaction. README with how to run.

## Rules for every package

- Words: Toll states facts; never "safe", "buy", "scam", "rug" as our verdict in our own text; every README says
  "information only, not financial advice". The LARP labels are exactly found / partly found / not found / not read.
- Never print or log keys; no network in unit tests (mock fetch); one opt-in live smoke test per package behind
  `TOLL_LIVE=1`.
- README per package: one-paragraph what, install, 5-line example, the free limit + paid path, links to t0ll.xyz/agents.
- Package metadata: license MIT, author "Toll", repository github.com/t0ll-xyz/toll-plugins, homepage https://t0ll.xyz/agents,
  keywords incl. robinhood-chain, solana, bsc, x402, mcp, ai-agent, rug-check, larp.
- Nothing is published or pushed by a builder. Publishing is the owner's accounts, later.
