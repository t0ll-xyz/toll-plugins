# @tollxyz/plugin-elizaos

An [elizaOS](https://docs.elizaos.ai) plugin for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Actions: `TOLL_CHECK_COIN`, `TOLL_LARP_CHECK` (Robinhood Chain and Solana; for a message that names BSC it says so and sends nothing), `TOLL_DEV_RECORD` (a deployer wallet). Each one runs when the message holds an address, and answers with Toll's text. For Robinhood Stock Tokens: `TOLL_STOCK_TOKEN` (the word stock and a ticker, `$NVDA` or `NVDA`, or the token's contract) and `TOLL_STOCK_TOKENS` (the list); for the companies behind them `TOLL_FUNDAMENTALS` (a word like fundamentals, financials, revenue, earnings or P/E, and a ticker) and `TOLL_INSIDER_TRADES` (insider or Form 4, and a ticker); and `TOLL_MACRO` (macro, rates, inflation, the yield curve or jobs). These answer with Toll's JSON. A provider adds a one-line hint to the context only when a message contains a token address.

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

With a Toll key (your $TOLL tier): set `TOLL_KEY` in the agent's settings or secrets, or `createTollPlugin({ tollKey })`. With your own client (for example a custom `fetch`): `createTollPlugin({ client: new Toll({ fetch }) })`, or `createTollPlugin({ fetch, tollKey })`. `Toll` and `TollError` are re-exported from `@tollxyz/sdk`.

## Robinhood Stock Tokens (Toll Markets)

`TOLL_STOCK_TOKEN` reads a ticker as Robinhood lists it (`NVDA`, `BRK.B`) or the Stock Token's contract on Robinhood Chain, and returns the JSON of <https://t0ll.xyz/api/markets/stock/NVDA>: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier and any pending change, corporate actions, and the company's SEC facts, each with its source and time. `TOLL_STOCK_TOKENS` returns the list (<https://t0ll.xyz/api/markets/stocks?limit=3>). In a message, a quoted word filters the list (`"nvid"`) and `top 10` sets how many (default 20).

Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.

## Company facts and US macro (Toll Markets)

`TOLL_FUNDAMENTALS` reads a ticker or contract from the message (`quarterly`, `annual` or `ttm` in the message picks the period), and returns the JSON of <https://t0ll.xyz/api/markets/fundamentals/NVDA>: the company's revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation from its SEC filings, every figure with its filing and link. `TOLL_INSIDER_TRADES` reads a ticker or contract (`last 10` sets how many rows, 1 to 100) and returns the JSON of <https://t0ll.xyz/api/markets/insiders/NVDA>: SEC Form 4 rows (who, role, transaction code, shares, price, owned after, the filing link), 90-day totals and 13D/13G holders. `TOLL_MACRO` returns the JSON of <https://t0ll.xyz/api/markets/macro>: the US Treasury daily par yield curve, the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. Each JSON is returned unchanged.

Facts with their sources, not advice. The EFFR is subject to the Terms of Use posted at newyorkfed.org; Toll is not affiliated with the New York Fed.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the plugin tells the agent it can pay per check there (0.05 USDG on Robinhood Chain or USDC on Base), with the owner's consent; the plugin never pays. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Holding $TOLL lifts the daily limits. Make a Toll key at <https://t0ll.xyz/toll#keys> and set it as `TOLL_KEY` (or pass `tollKey`): it is sent as `x-toll-pass` on every t0ll.xyz call and carries the key wallet's tier.

| Per UTC day | Free | 1M $TOLL | 5M $TOLL | 20M $TOLL |
| --- | --- | --- | --- | --- |
| New coins (TOLL_CHECK_COIN, TOLL_LARP_CHECK) | 10 | 100 | 500 | 2,000 |
| Markets calls (TOLL_STOCK_TOKEN, TOLL_STOCK_TOKENS, TOLL_FUNDAMENTALS, TOLL_INSIDER_TRADES, TOLL_MACRO) | 50 | 1,000 | 5,000 | 20,000 |

Past that, x402 per call: 0.05 USDG a coin check (`https://t0ll.xyz/api/x402/check/{token}`), 0.02 USDG a Stock Token (`https://t0ll.xyz/api/x402/stock/{id}`), on Robinhood Chain (or USDC on Base); 0.01 USDG on Robinhood Chain for fundamentals (`https://t0ll.xyz/api/x402/markets/fundamentals/{id}`), insider trades (`https://t0ll.xyz/api/x402/markets/insiders/{id}`), macro (`https://t0ll.xyz/api/x402/markets/macro`), the Stock Token list (`https://t0ll.xyz/api/x402/markets/stocks`) and the chain pulse (`https://t0ll.xyz/api/x402/pulse`). Over the Markets count, each Markets action answers with the paid URL for that call and the tiers instead of the JSON; nothing here pays.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
