# Toll for Hermes Agent

A [Portable Agent Plugins v1](https://agent-plugins.org) package for [Hermes Agent](https://github.com/NousResearch/hermes-agent).
It gives a Hermes agent [Toll](https://t0ll.xyz)'s read-only safety checks: before it buys a coin, signs a transaction
or pays another agent, it can read who is behind the coin, the dev's record, whether the LP can be pulled, whether the
product the coin claims exists, what the transaction is about to do, and what an ERC-8004 agent's registration and x402
terms say. It also reads Robinhood Stock Token market data. Robinhood Chain (4663) only.

It bundles one MCP server and one skill, and nothing else (no Python, no executables, no local command):

| Part | What it is | Moves money |
|---|---|---|
| `toll` | the hosted, read-only Toll MCP server, `https://t0ll.xyz/mcp` (Streamable HTTP, no key, no sign-in) | no |
| `skills/toll` | when to call the tools (before buying, signing or paying), and how to treat the answers | no |

## Install

```bash
hermes plugins install toll       # once listed in Hermes's plugin catalog
hermes plugins enable toll        # portable packages install disabled
```

The tools arrive as `mcp__toll__check_coin`, `mcp__toll__larp_check`, `mcp__toll__check_tx`, `mcp__toll__check_agent`, `mcp__toll__check_hook`
and the rest (19 tools, all annotated `readOnlyHint`). If your `~/.hermes/config.yaml` already has an `mcp_servers.toll`
entry (Toll's older setup), that entry wins over the plugin's server; remove it to use the plugin's.

## What it does

| Need | Tool |
|---|---|
| Who is behind a coin: snipers, bundles, linked wallets, the dev's funding, holders, LP, the findings tally | `check_coin` |
| Is there a real product behind a coin (site, posts, code checked against the chain) | `larp_check` |
| A launching wallet's record: launched, graduated, sold | `dev_record` |
| What anyone can learn about a wallet | `wallet_privacy` |
| The newest coins, how busy Robinhood Chain is | `fresh_launches`, `chain_pulse` |
| The call Toll froze at launch and how it ended 24 hours later | `launch_record` |
| ALLOW / WARN / BLOCK before signing a transaction, an EIP-712 message or an x402 payment (ERC-8265 RiskAssessment) | `check_tx`, `presign_risk_report` |
| An ERC-8004 agent's card, whether it answers over MCP or x402, whether x402 pays its registered wallet | `check_agent` |
| A Uniswap v4 hook: its name, what it can do, whether its owner can change it, whether sells through it fail | `check_hook` |
| Robinhood Stock Tokens: reference and pool price, supply, corporate actions, SEC facts | `stock_token`, `stock_tokens` |
| The company behind a Stock Token: SEC fundamentals, Form 4 insider trades | `fundamentals`, `insider_trades` |
| 13F institutional holders; earnings-release guidance and KPIs (AI-extracted from cited filings) | `institutions`, `guidance` |
| What changed on the Stock Tokens: listings, multipliers, corporate actions, feed status, SEC filings | `stock_events` |
| US Treasury yields, the effective federal funds rate, CPI, jobs | `macro` |

Toll states facts with their sources, never advice, and never says a coin is safe. Robinhood Stock Tokens are debt
securities issued by Robinhood Assets (Jersey) Ltd, not shares. The EFFR is subject to the Terms of Use posted at
newyorkfed.org; Toll is not affiliated with the New York Fed.

## Free limit and the Toll key

Free, with no key: 10 new coins a day per caller (coins already read stay free; `check_agent` and `check_hook` use no coin), and 50
Markets calls a day (Stock Tokens, fundamentals, insider trades, institutions, guidance, macro). Past that, the answer gives a paid x402 URL on
Robinhood Chain; this plugin cannot pay it, and the skill tells the agent never to pay without the user's consent.

Holders of $TOLL get more with a Toll key from https://t0ll.xyz/toll#keys. The plugin itself is keyless and sends no
credential. To use a key, declare the server yourself in `~/.hermes/config.yaml` (it replaces the plugin's `toll`
server) and put the key in the profile's `.env` as `TOLL_KEY`:

```yaml
mcp_servers:
  toll:
    url: "https://t0ll.xyz/mcp"
    headers:
      Authorization: "Bearer ${TOLL_KEY}"
```

## Disclosure

- **Network calls:** to `https://t0ll.xyz/mcp` only, and only when the agent calls a Toll tool. The server receives the
  tool's arguments: token contracts, wallet addresses, agent ids, tickers, and for `check_tx` the unsigned transaction,
  typed data or x402 requirements the agent passes.
- **Read-only:** every tool is a lookup, annotated `readOnlyHint`. The plugin never signs, never sends a transaction,
  never holds or asks for a private key and never moves money. The server is still marked `untrusted`, so if a
  write-capable tool ever appeared on it, Hermes would ask before each call.
- **No credentials:** the plugin stores and reads none. An optional Toll key is set by the user in their own
  `config.yaml` and `.env`, as above.
- **No local side effects:** no shell commands, no background processes, no files read or written outside Hermes.
- **No telemetry:** the plugin reports nothing. To count the free daily quota, Toll's server keeps per caller and per
  day the list of coins counted, keyed by a code made from the IP address with a secret key that changes every day; the
  IP itself is not stored and the lists are deleted after 3 days ([privacy](https://t0ll.xyz/privacy)).
- **Not covered by the pin:** the tool set is served by Toll's hosted server at runtime, and the server's code is not
  public. A snapshot of its tool list (19 tools, all read-only, Robinhood Chain only) is in this repository at
  [`packages/mcp/tests/fixture_tools_list.json`](../../packages/mcp/tests/fixture_tools_list.json).

## Without the plugin

The same server by hand: merge [`config.yaml`](config.yaml) into `~/.hermes/config.yaml`, then `/reload-mcp`. Or
locally over stdio: `command: "npx"`, `args: ["-y", "@tollxyz/mcp"]`. The skill alone:
`hermes skills install https://t0ll.xyz/skill.md`, or this folder's older copy in [`toll/`](toll).

Information only, not financial advice. MIT.
