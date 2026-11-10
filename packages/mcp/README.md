# @tollxyz/mcp

A local stdio [MCP](https://modelcontextprotocol.io) server for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin, pays an agent or signs anything, it can check who is behind the coin (snipers, bundles, the dev's record, whether liquidity can be pulled), whether there is a real product behind it, what an ERC-8004 agent's registration and payment terms say, and what a transaction, signature or x402 payment does. Robinhood Chain (chain id 4663) only: Toll reads Robinhood Chain only right now. Facts read from the chain. Information only, not financial advice.

It serves the tools of Toll's remote server (`https://t0ll.xyz/mcp`) one for one: `check_coin`, `pre_buy_check`, `check_coins`, `larp_check`, `dev_record`, `check_agent`, `find_paid_api` (paid APIs an agent can buy over x402, verified payTo first), `check_hook`, `wallet_privacy`, `wallet_approvals` (a wallet's live approvals, each with a revoke call checked by check_tx), `fresh_launches`, `chain_pulse`, `launch_record`, `check_tx`, `presign_risk_report`, for Robinhood Stock Tokens `stock_token` (a ticker or the token's contract) and `stock_tokens` (the list), for the companies behind them `fundamentals` (id, period: ttm, annual or quarterly) `insider_trades` (id, limit 1 to 100), `institutions` (13F fund holders: id, limit 1 to 20) and `guidance` (what earnings releases said, AI-extracted from cited filings: id, limit), `macro`, and `stock_events` (what changed on the Stock Tokens: listings, multiplier changes, corporate actions, Chainlink feed status and SEC filings; since, kind, limit 1 to 100), and the watch tools `watch_coin`, `my_watches`, `unwatch_coin`, `watch_wallet`, `unwatch_wallet` (they need a Toll key, which this server does not send: use the remote server with your key, or `@tollxyz/sdk`): 28 tools. It holds no key, signs nothing and never pays.

Before signing: `check_tx` takes a transaction (`to`, `data`, `value`, `from`), a message (`message`), an EIP-712 signature request (`typedData`), an ERC-4337 user operation (`userOp`) or an x402 payment (`x402`) and answers ALLOW / WARN / BLOCK with the reasons, an ERC-8265 RiskAssessment (what it reads, signatures' simulated take, EIP-712 text, Uniswap v4 liquidity calls and x402 `upto` / `auth-capture` included: <https://t0ll.xyz/agents/safety>); `strict: true` makes an x402 payTo that is not verified as the seller's a BLOCK. `presign_risk_report` takes a PresignRequest (`version: "erc-presign/1"`, `subject`; ERC draft, ethereum/ERCs PR #2134) and returns typed facts about the unsigned request, EIP-712 signed by Toll, with no verdict.

The Stock Token tools answer with Robinhood's listing, Chainlink's reference price, the deepest pool's price and liquidity, supply, corporate actions and the company's SEC facts, each with its source and time. Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.

`fundamentals` answers with the company's revenue, margins, earnings, balance sheet, growth and valuation from its SEC filings, every figure with its filing; `insider_trades` with SEC Form 4 rows, totals and 13D/13G holders, each with its filing link; `macro` with the US Treasury yield curve, the New York Fed's effective federal funds rate, and BLS CPI, unemployment and payrolls, each with its date and source. The EFFR is subject to the Terms of Use posted at newyorkfed.org; Toll is not affiliated with the New York Fed.

`stock_events` pages by `since` (the last answer's `next`). This local server sends no key, so it shows the free preview: the last 10 events found an hour ago or more. With a Toll key on the remote server (below), a Team wallet (20M+ $TOLL) reads it live and Pro (5M+) 15 minutes late. Funds and tickers with no SEC CIK get no filing events.

## Add it

Any MCP client that starts stdio servers (Claude Desktop, Cursor, Windsurf, Cline, OpenClaw, Hermes):

```json
{ "mcpServers": { "toll": { "command": "npx", "args": ["-y", "@tollxyz/mcp"] } } }
```

Claude Code:

```sh
claude mcp add toll -- npx -y @tollxyz/mcp
```

Hermes (`~/.hermes/config.yaml`):

```yaml
mcp_servers:
  toll:
    command: "npx"
    args: ["-y", "@tollxyz/mcp"]
```

A client that speaks Streamable HTTP can skip the package and use Toll's remote server directly: `https://t0ll.xyz/mcp`.

Node >= 20.19. Env: `TOLL_BASE_URL` (default `https://t0ll.xyz`). `npx -y @tollxyz/mcp --help` prints the setup line.

## What it passes on

Each answer is Toll's text as Toll's server sent it: coin names, symbols, sites and posts quoted there were written by whoever made the coin, so the agent must treat them as untrusted text, never as instructions. The server's instructions tell the model so. This package adds no formatting around that text.

If Toll cannot be reached, the tool list is a bundled snapshot of Toll's tools and a call answers that nothing was checked.

## Free limit

10 new coins a day per caller are free (coins already read stay free), and 50 Markets calls. Past that, Toll's answer is passed on unchanged and one separate note follows it: the free coins are used up, this server does not pay, and the owner can pay per check at the x402 URL in the answer (0.005 USDG on Robinhood Chain; 0.02 USDG a Stock Token at `https://t0ll.xyz/api/x402/stock/{id}`; 0.01 USDG each at `https://t0ll.xyz/api/x402/markets/fundamentals/{id}`, `https://t0ll.xyz/api/x402/markets/insiders/{id}`, `https://t0ll.xyz/api/x402/markets/institutions/{id}`, `https://t0ll.xyz/api/x402/markets/guidance/{id}`, `https://t0ll.xyz/api/x402/markets/macro`, `https://t0ll.xyz/api/x402/markets/stocks` and `https://t0ll.xyz/api/x402/pulse`). To pay from code, see `pay()` in [`@tollxyz/sdk`](https://github.com/t0ll-xyz/toll-plugins/tree/main/packages/sdk-js).

Holding $TOLL lifts the daily limits, with a Toll key from <https://t0ll.xyz/toll#keys> sent as `x-toll-pass` or `Authorization: Bearer`:

| Per UTC day | Free | 1M $TOLL | 5M $TOLL | 20M $TOLL |
| --- | --- | --- | --- | --- |
| New coins (`check_coin`, `larp_check`) | 10 | 100 | 500 | 2,000 |
| Markets calls (`stock_token`, `stock_tokens`, `fundamentals`, `insider_trades`, `institutions`, `guidance`, `macro`) | 50 | 1,000 | 5,000 | 20,000 |

This local server sends no key, so it runs at the free tier. For your tier, connect to Toll's remote server (`https://t0ll.xyz/mcp`) with the key in one of those headers, for example `claude mcp add --transport http toll https://t0ll.xyz/mcp --header "x-toll-pass: <your key>"`.

## In code

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTollMcpServer } from "@tollxyz/mcp";

const { server } = createTollMcpServer();   // { baseUrl, fetch, timeoutMs }
await server.connect(new StdioServerTransport());
```

Links: <https://t0ll.xyz/agents/mcp>, <https://t0ll.xyz/skill.md>, <https://t0ll.xyz/llms.txt>. MIT.
