# @tollxyz/goat-plugin

A [GOAT SDK](https://github.com/goat-sdk/goat) plugin for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin, pays an agent or signs anything on Robinhood Chain (chain id 4663), it can check who is behind the coin (snipers, bundles, the dev's record, whether liquidity can be pulled), whether there is a real product behind it, and what the transaction or payment does. Facts read from the chain. Information only, not financial advice.

Toll reads Robinhood Chain only right now: `chain` is optional and takes only `rh`; a Solana mint or another chain is answered with "Toll reads Robinhood Chain only right now." and nothing is sent.

All 18 of Toll's live tools: `check_coin`, `larp_check`, `dev_record`, `wallet_privacy`, `fresh_launches`, `chain_pulse`, `launch_record`, `check_agent`, `check_tx`, `presign_risk_report`, for Robinhood Stock Tokens `stock_token` and `stock_tokens`, for the companies behind them `fundamentals`, `insider_trades`, `institutions` and `guidance`, US `macro`, and the Stock Token event feed `stock_events`. `supportsChain` is true for every chain: Toll reads public chain data.

## Install

```sh
npm install @tollxyz/goat-plugin @goat-sdk/core zod@3
```

`@goat-sdk/core` (0.5.x) and `zod` 3 are peer dependencies. ESM only, Node >= 20.19. Built and tested against `@goat-sdk/core` 0.5.0.

## Example

```ts
import { getTools } from "@goat-sdk/core";
import { toll } from "@tollxyz/goat-plugin";

const tools = await getTools({ wallet, plugins: [toll()] });
// with a Toll key (your $TOLL tier): toll({ tollKey: process.env.TOLL_KEY })
```

`toll(options?)` takes `{ tollKey?, fetch?, client? }`, or a ready `Toll` client as before. `Toll` and `TollError` are re-exported from `@tollxyz/sdk`.

## Robinhood Stock Tokens (Toll Markets)

`stock_token` takes `id`, a ticker as Robinhood lists it (`NVDA`, `BRK.B`) or the Stock Token's contract on Robinhood Chain, and returns the JSON of <https://t0ll.xyz/api/markets/stock/NVDA>: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier and any pending change, corporate actions, and the company's SEC facts, each with its source and time. `stock_tokens` takes an optional `query` and `limit` (1 to 250) and returns the list (<https://t0ll.xyz/api/markets/stocks?limit=3>).

Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.

## Company facts and US macro (Toll Markets)

`fundamentals` takes `id` (a Stock Token's ticker or contract, as above) and an optional `period` (`ttm`, `annual` or `quarterly`), and returns the JSON of <https://t0ll.xyz/api/markets/fundamentals/NVDA>: the company's revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation from its SEC filings, every figure with its filing and link. `insider_trades` takes `id` and an optional `limit` (1 to 100) and returns the JSON of <https://t0ll.xyz/api/markets/insiders/NVDA>: SEC Form 4 rows (who, role, transaction code, shares, price, owned after, the filing link), 90-day totals and 13D/13G holders. `macro` takes nothing and returns the JSON of <https://t0ll.xyz/api/markets/macro>: the US Treasury daily par yield curve, the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. Each JSON is returned unchanged.

Facts with their sources, not advice. The EFFR is subject to the Terms of Use posted at newyorkfed.org; Toll is not affiliated with the New York Fed.

`institutions` takes `id` and an optional `limit` (1 to 20) and returns the JSON of <https://t0ll.xyz/api/markets/institutions/NVDA>: the company's 13F institutional holders for the latest quarter, each manager's change vs the prior quarter, total institutional shares and the number of filers, with the quarter and the date SEC published the data set. `guidance` takes `id` and an optional `limit` (1 to 60 values per release) and returns the JSON of <https://t0ll.xyz/api/markets/guidance/NVDA>: forward guidance, KPIs and non-GAAP measures from the company's last 4 earnings releases (SEC 8-K Item 2.02), AI-extracted from cited filings, each value with its quote and filing link. `stock_events` (over Toll's MCP server) takes optional `since` (the last answer's `next`), `kind` and `limit` (1 to 100): what changed on the Stock Tokens (listings, multiplier changes, corporate actions, Chainlink feed state, SEC filings), oldest first. Without a Toll key it shows the last 10 events found an hour ago or more; Pro holders read it 15 minutes late, Team holders live.

## Before signing: check_tx and presign_risk_report

`check_tx` takes a transaction (`to`, `data`, `value`, `from`), an EIP-712 signature request (`typedData`) or an x402 payment (`x402`: the 402's PaymentRequired or one accepts entry; `agentId`, `registry`, `strict` optional) and answers ALLOW / WARN / BLOCK with the reasons, an ERC-8265 RiskAssessment. Pass on every warning; on BLOCK do not sign without the owner's say. `presign_risk_report` takes a PresignRequest (`version: "erc-presign/1"`, `subject`, optional `context` and `kinds`; ERC draft, ethereum/ERCs PR #2134) and returns typed facts about the unsigned request, EIP-712 signed by Toll, with no verdict. `check_agent` takes an ERC-8004 agent id on Robinhood Chain; `wallet_privacy` takes a wallet.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the plugin tells the agent it can pay per check there (0.05 USDG on Robinhood Chain or USDC on Base), with the owner's consent; the plugin never pays. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Holding $TOLL lifts the daily limits. Make a Toll key at <https://t0ll.xyz/toll#keys> and pass it as `tollKey`: it is sent as `x-toll-pass` on every t0ll.xyz call and carries the key wallet's tier.

| Per UTC day | Free | 1M $TOLL | 5M $TOLL | 20M $TOLL |
| --- | --- | --- | --- | --- |
| New coins (check_coin, larp_check) | 10 | 100 | 500 | 2,000 |
| Markets calls (stock_token, stock_tokens, fundamentals, insider_trades, institutions, guidance, macro) | 50 | 1,000 | 5,000 | 20,000 |

Past that, x402 per call: 0.05 USDG a coin check (`https://t0ll.xyz/api/x402/check/{token}`), 0.02 USDG a Stock Token (`https://t0ll.xyz/api/x402/stock/{id}`), on Robinhood Chain (or USDC on Base); 0.01 USDG on Robinhood Chain for fundamentals (`https://t0ll.xyz/api/x402/markets/fundamentals/{id}`), insider trades (`https://t0ll.xyz/api/x402/markets/insiders/{id}`), institutions (`https://t0ll.xyz/api/x402/markets/institutions/{id}`), guidance (`https://t0ll.xyz/api/x402/markets/guidance/{id}`), macro (`https://t0ll.xyz/api/x402/markets/macro`), the Stock Token list (`https://t0ll.xyz/api/x402/markets/stocks`) and the chain pulse (`https://t0ll.xyz/api/x402/pulse`). Over the Markets count, each Markets tool answers with the paid URL for that call and the tiers instead of the JSON; nothing here pays.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
