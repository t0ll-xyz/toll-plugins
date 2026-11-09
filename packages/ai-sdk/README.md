# @tollxyz/ai-sdk

[Vercel AI SDK](https://ai-sdk.dev) tools for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin, pays an agent or signs anything on Robinhood Chain (chain id 4663), it can check who is behind the coin (snipers, bundles, the dev's record, whether liquidity can be pulled), whether there is a real product behind it, and what the transaction or payment does. Facts read from the chain. Information only, not financial advice.

Toll reads Robinhood Chain only right now: `chain` is optional and takes only `rh`; a Solana mint or another chain is answered with "Toll reads Robinhood Chain only right now." and nothing is sent.

All 27 of Toll's live tools: `check_coin`, `pre_buy_check`, `check_coins`, `larp_check`, `dev_record`, `wallet_privacy`, `wallet_approvals`, `fresh_launches`, `chain_pulse`, `launch_record`, `check_agent`, `check_hook`, `check_tx`, `presign_risk_report`, for Robinhood Stock Tokens `stock_token` and `stock_tokens`, for the companies behind them `fundamentals`, `insider_trades`, `institutions` and `guidance`, US `macro`, the Stock Token event feed `stock_events`, and the webhook watches `watch_coin`, `my_watches`, `unwatch_coin`, `watch_wallet` and `unwatch_wallet`.

## Install

```sh
npm install @tollxyz/ai-sdk ai zod
```

`ai` (6 or 7) and `zod` (3.25+ or 4) are peer dependencies. ESM only, Node >= 22. Built and tested against `ai` 7.0.154 (Node >= 22), using `tool()` with `inputSchema`.

## Example

```ts
import { generateText } from "ai";
import { tollTools } from "@tollxyz/ai-sdk";

const { text } = await generateText({
  model,                       // any AI SDK model
  tools: tollTools(),          // or tollTools({ only: ["check_coin", "larp_check"], tollKey: process.env.TOLL_KEY })
  prompt: "Check 0xff9e86e6b21fd688027981bee4b64c8b6b804ed3 on Robinhood Chain before I buy.",
});
```

`tollTools(options?)` takes `{ tollKey?, fetch?, client?, only? }`. `Toll`, `TollError`, `verifyWebhook` and `readWebhook` are re-exported from `@tollxyz/sdk`.

## Robinhood Stock Tokens (Toll Markets)

`stock_token` takes `id`, a ticker as Robinhood lists it (`NVDA`, `BRK.B`) or the Stock Token's contract on Robinhood Chain, and returns the JSON of <https://t0ll.xyz/api/markets/stock/NVDA>: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier and any pending change, corporate actions, and the company's SEC facts, each with its source and time. `stock_tokens` takes an optional `query` and `limit` (1 to 250) and returns the list (<https://t0ll.xyz/api/markets/stocks?limit=3>).

Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.

## Company facts and US macro (Toll Markets)

`fundamentals` takes `id` (a Stock Token's ticker or contract, as above) and an optional `period` (`ttm`, `annual` or `quarterly`), and returns the JSON of <https://t0ll.xyz/api/markets/fundamentals/NVDA>: the company's revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation from its SEC filings, every figure with its filing and link. `insider_trades` takes `id` and an optional `limit` (1 to 100) and returns the JSON of <https://t0ll.xyz/api/markets/insiders/NVDA>: SEC Form 4 rows (who, role, transaction code, shares, price, owned after, the filing link), 90-day totals and 13D/13G holders. `macro` takes nothing and returns the JSON of <https://t0ll.xyz/api/markets/macro>: the US Treasury daily par yield curve, the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. Each JSON is returned unchanged.

Facts with their sources, not advice. The EFFR is subject to the Terms of Use posted at newyorkfed.org; Toll is not affiliated with the New York Fed.

`institutions` takes `id` and an optional `limit` (1 to 20) and returns the JSON of <https://t0ll.xyz/api/markets/institutions/NVDA>: the company's 13F institutional holders for the latest quarter, each manager's change vs the prior quarter, total institutional shares and the number of filers, with the quarter and the date SEC published the data set. `guidance` takes `id` and an optional `limit` (1 to 60 values per release) and returns the JSON of <https://t0ll.xyz/api/markets/guidance/NVDA>: forward guidance, KPIs and non-GAAP measures from the company's last 4 earnings releases (SEC 8-K Item 2.02), AI-extracted from cited filings, each value with its quote and filing link. `stock_events` (over Toll's MCP server) takes optional `since` (the last answer's `next`), `kind` and `limit` (1 to 100): what changed on the Stock Tokens (listings, multiplier changes, corporate actions, Chainlink feed state, SEC filings), oldest first. Without a Toll key it shows the last 10 events found an hour ago or more; Pro holders read it 15 minutes late, Team holders live.

## Before signing: check_tx and presign_risk_report

`check_tx` takes a transaction (`to`, `data`, `value`, `from`), an EIP-712 signature request (`typedData`) or an x402 payment (`x402`: the 402's PaymentRequired or one accepts entry; `agentId`, `registry`, `strict` optional) and answers ALLOW / WARN / BLOCK with the reasons, an ERC-8265 RiskAssessment. Pass on every warning; on BLOCK do not sign without the owner's say. `presign_risk_report` takes a PresignRequest (`version: "erc-presign/1"`, `subject`, optional `context` and `kinds`; ERC draft, ethereum/ERCs PR #2134) and returns typed facts about the unsigned request, EIP-712 signed by Toll, with no verdict. `check_agent` takes an ERC-8004 agent id on Robinhood Chain; `wallet_privacy` takes a wallet.

## Wallet approvals, watches and ALLOW tickets (0.4.0)

`wallet_approvals` takes a `wallet` and lists its live token approvals on Robinhood Chain (ERC-20, NFT approval-for-all, Permit2): the spender, the amount (unlimited flagged), a risk (high / medium / low) and the revoke transaction with check_tx's answer on it. `watch_coin` and `watch_wallet` take an `address` and your https webhook `url`: Toll POSTs a signed JSON event when the coin's verdict word changes or a new finding against appears, or when the wallet gives a new approval, signs an EIP-7702 delegation or receives a token whose check is against. The first answer carries the `secret` that signs every event. `my_watches` lists your watches; `unwatch_coin` and `unwatch_wallet` remove one by id. The watch tools need a Toll key (`tollKey`). `check_tx` also takes `ticket: true` (or `{ consumer, scope }`) for a signed single-use ALLOW ticket a contract can require; it comes back in the RiskAssessment's `x-toll.ticket`, and a BLOCK is never signed.

```ts
import { tollTools, verifyWebhook, Toll } from "@tollxyz/ai-sdk";

const tools = tollTools({ tollKey: process.env.TOLL_KEY, only: ["wallet_approvals", "watch_wallet", "unwatch_wallet", "check_tx"] });

// in your webhook handler: check the signature on the raw body before reading the event
const ok = await verifyWebhook(secret, rawBody, req.headers["x-toll-signature"]);

// Toll's open blocklist (free, no key) through the SDK client; a coin that is not listed is not cleared
const bl = await new Toll().blocklist();
if (!bl.notModified) console.log(bl.list.count, bl.list.entries[0]);
```

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the tool's answer ends with the x402 URL for that coin and tells the agent it can pay per check there (0.005 USDG on Robinhood Chain or USDC on Base), with the owner's consent; the tool never pays. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Holding $TOLL lifts the daily limits. Make a Toll key at <https://t0ll.xyz/toll#keys> and pass it as `tollKey`: it is sent as `x-toll-pass` on every t0ll.xyz call and carries the key wallet's tier.

| Per UTC day | Free | 1M $TOLL | 5M $TOLL | 20M $TOLL |
| --- | --- | --- | --- | --- |
| New coins (check_coin, larp_check) | 10 | 100 | 500 | 2,000 |
| Markets calls (stock_token, stock_tokens, fundamentals, insider_trades, institutions, guidance, macro) | 50 | 1,000 | 5,000 | 20,000 |

Past that, x402 per call: 0.005 USDG a coin check (`https://t0ll.xyz/api/x402/check/{token}`), 0.02 USDG a Stock Token (`https://t0ll.xyz/api/x402/stock/{id}`), on Robinhood Chain (or USDC on Base); 0.01 USDG on Robinhood Chain for fundamentals (`https://t0ll.xyz/api/x402/markets/fundamentals/{id}`), insider trades (`https://t0ll.xyz/api/x402/markets/insiders/{id}`), institutions (`https://t0ll.xyz/api/x402/markets/institutions/{id}`), guidance (`https://t0ll.xyz/api/x402/markets/guidance/{id}`), macro (`https://t0ll.xyz/api/x402/markets/macro`), the Stock Token list (`https://t0ll.xyz/api/x402/markets/stocks`) and the chain pulse (`https://t0ll.xyz/api/x402/pulse`). Over the Markets count, each Markets tool answers with the paid URL for that call and the tiers instead of the JSON; nothing here pays.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
