# @tollxyz/plugin-elizaos

An [elizaOS](https://docs.elizaos.ai) plugin for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin, pays an agent or signs anything on Robinhood Chain (chain id 4663), it can check who is behind the coin (snipers, bundles, the dev's record, whether liquidity can be pulled), whether there is a real product behind it, and what the transaction or payment does. Facts read from the chain. Information only, not financial advice.

Toll reads Robinhood Chain only right now: actions read 0x addresses only; a message with only a Solana mint or another chain's address gets "Toll reads Robinhood Chain only right now." and nothing is sent.

23 actions, each run when the message text holds what it needs:

- `TOLL_CHECK_COIN`, `TOLL_LARP_CHECK`: a token's 0x address. `TOLL_DEV_RECORD`: a deployer wallet. `TOLL_WALLET_PRIVACY`: a word like privacy or exposed and a wallet. `TOLL_WALLET_APPROVALS`: a word like approvals, allowances or revoke and a wallet. `TOLL_BLOCKLIST`: the word blocklist (with a 0x address to look one up). `TOLL_LAUNCH_RECORD`: the words launch record or at launch and a token. `TOLL_FRESH_LAUNCHES`: new coins or fresh launches (`top 5` sets how many). `TOLL_CHAIN_PULSE`: how busy the chain is. These answer with Toll's text.
- `TOLL_CHECK_AGENT`: an ERC-8004 agent id (`agent 20030` or `agent #20030`).
- `TOLL_CHECK_TX`: the request pasted as JSON in the message: `{to, data, value, from}`, `{typedData: {...}}`, `{x402: {...}}` or a 402 body with `accepts`; add `"ticket": true` for an ALLOW ticket. `TOLL_PRESIGN_RISK_REPORT`: a PresignRequest pasted as JSON with `"version": "erc-presign/1"`.
- For Robinhood Stock Tokens: `TOLL_STOCK_TOKEN` (the word stock and a ticker, `$NVDA` or `NVDA`, or the token's contract) and `TOLL_STOCK_TOKENS` (the list); for the companies behind them `TOLL_FUNDAMENTALS` (a word like fundamentals, financials, revenue, earnings or P/E, and a ticker), `TOLL_INSIDER_TRADES` (insider or Form 4, and a ticker), `TOLL_INSTITUTIONS` (13F or institutions, and a ticker) and `TOLL_GUIDANCE` (guidance, outlook or KPIs, and a ticker); `TOLL_STOCK_EVENTS` (stock token events, listings, multiplier changes, corporate actions or filings; a kind named in the message filters); and `TOLL_MACRO` (macro, rates, inflation, the yield curve or jobs). The Markets ones answer with Toll's JSON.

A provider adds a one-line hint to the context only when a message contains a token address.

## Install

```sh
npm install @tollxyz/plugin-elizaos
```

`@elizaos/core` (^1.6.0) is a peer dependency. ESM only, Node >= 20.19. Built and typed against `@elizaos/core` 1.7.2. Type-check with `"moduleResolution": "bundler"` (as elizaOS projects do): under `nodenext`, `@elizaos/core` 1.7.2's own type files resolve to nothing and `Character`/`Project` show as missing.

## Example

A character names its plugins by package:

```ts
import type { Character } from "@elizaos/core";

export const character: Character = {
  name: "Trader",
  bio: "Checks who is behind a coin before it trades.",
  plugins: ["@tollxyz/plugin-elizaos"],
};
```

In a project, hand the plugin object to the agent instead:

```ts
import type { Project, ProjectAgent } from "@elizaos/core";
import { tollPlugin } from "@tollxyz/plugin-elizaos";

const agent: ProjectAgent = {
  character: { name: "Trader", bio: "Checks who is behind a coin before it trades." },
  plugins: [tollPlugin],
};
const project: Project = { agents: [agent] };
export default project;
```

With a Toll key (your $TOLL tier): set `TOLL_KEY` in the agent's settings or secrets, or `createTollPlugin({ tollKey })`. With your own client (for example a custom `fetch`): `createTollPlugin({ client: new Toll({ fetch }) })`, or `createTollPlugin({ fetch, tollKey })`. `Toll`, `TollError`, `verifyWebhook` and `readWebhook` are re-exported from `@tollxyz/sdk`.

## Robinhood Stock Tokens (Toll Markets)

`TOLL_STOCK_TOKEN` reads a ticker as Robinhood lists it (`NVDA`, `BRK.B`) or the Stock Token's contract on Robinhood Chain, and returns the JSON of <https://t0ll.xyz/api/markets/stock/NVDA>: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier and any pending change, corporate actions, and the company's SEC facts, each with its source and time. `TOLL_STOCK_TOKENS` returns the list (<https://t0ll.xyz/api/markets/stocks?limit=3>). In a message, a quoted word filters the list (`"nvid"`) and `top 10` sets how many (default 20).

Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.

## Company facts and US macro (Toll Markets)

`TOLL_FUNDAMENTALS` reads a ticker or contract from the message (`quarterly`, `annual` or `ttm` in the message picks the period), and returns the JSON of <https://t0ll.xyz/api/markets/fundamentals/NVDA>: the company's revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation from its SEC filings, every figure with its filing and link. `TOLL_INSIDER_TRADES` reads a ticker or contract (`last 10` sets how many rows, 1 to 100) and returns the JSON of <https://t0ll.xyz/api/markets/insiders/NVDA>: SEC Form 4 rows (who, role, transaction code, shares, price, owned after, the filing link), 90-day totals and 13D/13G holders. `TOLL_MACRO` returns the JSON of <https://t0ll.xyz/api/markets/macro>: the US Treasury daily par yield curve, the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. Each JSON is returned unchanged.

Facts with their sources, not advice. The EFFR is subject to the Terms of Use posted at newyorkfed.org; Toll is not affiliated with the New York Fed.

`TOLL_INSTITUTIONS` (`top 5` sets how many, 1 to 20) returns the JSON of <https://t0ll.xyz/api/markets/institutions/NVDA>: the company's 13F institutional holders for the latest quarter, each manager's change vs the prior quarter, total institutional shares and the number of filers, with the quarter and the date SEC published the data set. `TOLL_GUIDANCE` returns the JSON of <https://t0ll.xyz/api/markets/guidance/NVDA>: forward guidance, KPIs and non-GAAP measures from the company's last 4 earnings releases (SEC 8-K Item 2.02), AI-extracted from cited filings, each value with its quote and filing link. `TOLL_STOCK_EVENTS` (over Toll's MCP server) lists what changed on the Stock Tokens (listings, multiplier changes, corporate actions, Chainlink feed state, SEC filings), oldest first. Without a Toll key it shows the last 10 events found an hour ago or more; Pro holders read it 15 minutes late, Team holders live.

## Before signing: TOLL_CHECK_TX and TOLL_PRESIGN_RISK_REPORT

`TOLL_CHECK_TX` sends the pasted transaction, EIP-712 signature request or x402 payment to Toll's `check_tx`, which answers ALLOW / WARN / BLOCK with the reasons, an ERC-8265 RiskAssessment. Pass on every warning; on BLOCK do not sign without the owner's say. `TOLL_PRESIGN_RISK_REPORT` sends a PresignRequest (ERC draft, ethereum/ERCs PR #2134) to `presign_risk_report`, which returns typed facts about the unsigned request, EIP-712 signed by Toll, with no verdict.

## Wallet approvals, the blocklist and ALLOW tickets (0.4.0)

`TOLL_WALLET_APPROVALS` runs Toll's `wallet_approvals` for the wallet in the message: its live token approvals on Robinhood Chain (ERC-20, NFT approval-for-all, Permit2), each with the spender, the amount (unlimited flagged), a risk (high / medium / low) and the revoke transaction with check_tx's answer on it. `TOLL_BLOCKLIST` reads Toll's open blocklist (<https://t0ll.xyz/api/blocklist>, free, no key): with a 0x address it says whether that address is listed, with its reasons, dates and evidence page; without one it lists the 10 newest entries. A coin that is not listed is not cleared. `TOLL_CHECK_TX` passes `"ticket": true` (or `{"consumer", "scope"}`) through to `check_tx`, which then returns a signed single-use ALLOW ticket in the RiskAssessment's `x-toll.ticket` (never for a BLOCK).

```text
user:  what approvals has 0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc given? anything to revoke?
agent: (TOLL_WALLET_APPROVALS) Here are that wallet's live approvals Toll read, each with its risk and the revoke call.
user:  is 0xff9e86e6b21fd688027981bee4b64c8b6b804ed3 on the Toll blocklist?
agent: (TOLL_BLOCKLIST) ... is not on the list. A coin that is not listed is not cleared: check it with TOLL_CHECK_COIN.
```

The same blocklist is a function too: `blocklistText(new Toll(), address?)`. Webhook watches are in the SDK (`new Toll({ tollKey }).watchWallet(address, url)`, events checked with the re-exported `verifyWebhook`).

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the plugin tells the agent it can pay per check there (0.005 USDG on Robinhood Chain or USDC on Base), with the owner's consent; the plugin never pays. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Holding $TOLL lifts the daily limits. Make a Toll key at <https://t0ll.xyz/toll#keys> and set it as `TOLL_KEY` (or pass `tollKey`): it is sent as `x-toll-pass` on every t0ll.xyz call and carries the key wallet's tier.

| Per UTC day | Free | 1M $TOLL | 5M $TOLL | 20M $TOLL |
| --- | --- | --- | --- | --- |
| New coins (TOLL_CHECK_COIN, TOLL_LARP_CHECK) | 10 | 100 | 500 | 2,000 |
| Markets calls (TOLL_STOCK_TOKEN, TOLL_STOCK_TOKENS, TOLL_FUNDAMENTALS, TOLL_INSIDER_TRADES, TOLL_INSTITUTIONS, TOLL_GUIDANCE, TOLL_MACRO) | 50 | 1,000 | 5,000 | 20,000 |

Past that, x402 per call: 0.005 USDG a coin check (`https://t0ll.xyz/api/x402/check/{token}`), 0.02 USDG a Stock Token (`https://t0ll.xyz/api/x402/stock/{id}`), on Robinhood Chain (or USDC on Base); 0.01 USDG on Robinhood Chain for fundamentals (`https://t0ll.xyz/api/x402/markets/fundamentals/{id}`), insider trades (`https://t0ll.xyz/api/x402/markets/insiders/{id}`), institutions (`https://t0ll.xyz/api/x402/markets/institutions/{id}`), guidance (`https://t0ll.xyz/api/x402/markets/guidance/{id}`), macro (`https://t0ll.xyz/api/x402/markets/macro`), the Stock Token list (`https://t0ll.xyz/api/x402/markets/stocks`) and the chain pulse (`https://t0ll.xyz/api/x402/pulse`). Over the Markets count, each Markets action answers with the paid URL for that call and the tiers instead of the JSON; nothing here pays.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
