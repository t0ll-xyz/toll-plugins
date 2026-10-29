# @tollxyz/mcp

A local stdio [MCP](https://modelcontextprotocol.io) server for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin or pays an agent, it can check who is behind the coin (snipers, bundles, the dev's record, whether liquidity can be pulled), whether there is a real product behind it, and what an ERC-8004 agent's registration and payment terms say. Robinhood Chain, Solana, BSC and Arc. Facts read from the chain. Information only, not financial advice.

It serves the tools of Toll's remote server (`https://t0ll.xyz/mcp`) one for one: `check_coin`, `larp_check`, `dev_record`, `check_agent`, `wallet_privacy`, `fresh_launches`, `chain_pulse`, `launch_record`. It holds no key, signs nothing and never pays.

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

10 new coins a day per caller are free (coins already read stay free). This server is the free tier only. Past that, Toll's answer is passed on unchanged and one separate note follows it: the free coins are used up, this server does not pay, and the owner can pay per check at the x402 URL in the answer (0.05 USDG on Robinhood Chain). Over MCP the free coins are counted per caller, so holding $TOLL does not lift them. To pay from code, see `pay()` in [`@tollxyz/sdk`](https://github.com/t0ll-xyz/toll-plugins/tree/main/packages/sdk-js).

## In code

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTollMcpServer } from "@tollxyz/mcp";

const { server } = createTollMcpServer();   // { baseUrl, fetch, timeoutMs }
await server.connect(new StdioServerTransport());
```

Links: <https://t0ll.xyz/agents/mcp>, <https://t0ll.xyz/skill.md>, <https://t0ll.xyz/llms.txt>. MIT.
