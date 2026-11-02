# @tollxyz/mcp

A local stdio [MCP](https://modelcontextprotocol.io) server for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin or pays an agent, it can check who is behind the coin (snipers, bundles, the dev's record, whether liquidity can be pulled), whether there is a real product behind it, and what an ERC-8004 agent's registration and payment terms say. Robinhood Chain, Solana, BSC and Arc. Facts read from the chain. Information only, not financial advice.

It serves the tools of Toll's remote server (`https://t0ll.xyz/mcp`) one for one: `check_coin`, `larp_check`, `dev_record`, `check_agent`, `wallet_privacy`, `fresh_launches`, `chain_pulse`, `launch_record`, `check_tx`, `presign_risk_report`, and for Robinhood Stock Tokens `stock_token` (a ticker or the token's contract) and `stock_tokens` (the list). It holds no key, signs nothing and never pays.

The Stock Token tools answer with Robinhood's listing, Chainlink's reference price, the deepest pool's price and liquidity, supply, corporate actions and the company's SEC facts, each with its source and time. Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.

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

10 new coins a day per caller are free (coins already read stay free), and 50 Markets calls. Past that, Toll's answer is passed on unchanged and one separate note follows it: the free coins are used up, this server does not pay, and the owner can pay per check at the x402 URL in the answer (0.05 USDG on Robinhood Chain; 0.02 USDG a Stock Token at `https://t0ll.xyz/api/x402/stock/{id}`). To pay from code, see `pay()` in [`@tollxyz/sdk`](https://github.com/t0ll-xyz/toll-plugins/tree/main/packages/sdk-js).

Holding $TOLL lifts the daily limits, with a Toll key from <https://t0ll.xyz/toll#keys> sent as `x-toll-pass` or `Authorization: Bearer`:

| Per UTC day | Free | 1M $TOLL | 5M $TOLL | 20M $TOLL |
| --- | --- | --- | --- | --- |
| New coins (`check_coin`, `larp_check`) | 10 | 100 | 500 | 2,000 |
| Markets calls (`stock_token`, `stock_tokens`) | 50 | 1,000 | 5,000 | 20,000 |

This local server sends no key, so it runs at the free tier. For your tier, connect to Toll's remote server (`https://t0ll.xyz/mcp`) with the key in one of those headers, for example `claude mcp add --transport http toll https://t0ll.xyz/mcp --header "x-toll-pass: <your key>"`.

## In code

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTollMcpServer } from "@tollxyz/mcp";

const { server } = createTollMcpServer();   // { baseUrl, fetch, timeoutMs }
await server.connect(new StdioServerTransport());
```

Links: <https://t0ll.xyz/agents/mcp>, <https://t0ll.xyz/skill.md>, <https://t0ll.xyz/llms.txt>. MIT.
