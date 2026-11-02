# @tollxyz/agentkit

A [Coinbase AgentKit](https://github.com/coinbase/agentkit) action provider for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Actions: `check_coin`, `larp_check` (Robinhood Chain and Solana), `dev_record`, `launch_record`, `fresh_launches`, `chain_pulse`, and for Robinhood Stock Tokens `stock_token` and `stock_tokens`. AgentKit prefixes the names with the class, e.g. `TollActionProvider_check_coin`. `supportsNetwork` is true for every network: Toll reads public chain data, whatever chain the agent's wallet is on.

## Install

```sh
npm install @tollxyz/agentkit @coinbase/agentkit zod@3
```

`@coinbase/agentkit` (^0.10.4) and `zod` 3 are peer dependencies. ESM only, Node >= 20.19. Built and tested against `@coinbase/agentkit` 0.10.4.

## Example

```ts
import { AgentKit } from "@coinbase/agentkit";
import { tollActionProvider } from "@tollxyz/agentkit";

const agentKit = await AgentKit.from({ walletProvider, actionProviders: [tollActionProvider()] });
// with a Toll key (your $TOLL tier): tollActionProvider({ tollKey: process.env.TOLL_KEY })
```

`tollActionProvider(options?)` takes `{ tollKey?, fetch?, client? }`, or a ready `Toll` client as before. `Toll` and `TollError` are re-exported from `@tollxyz/sdk`.

## Robinhood Stock Tokens (Toll Markets)

`stock_token` takes `id`, a ticker as Robinhood lists it (`NVDA`, `BRK.B`) or the Stock Token's contract on Robinhood Chain, and returns the JSON of <https://t0ll.xyz/api/markets/stock/NVDA>: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier and any pending change, corporate actions, and the company's SEC facts, each with its source and time. `stock_tokens` takes an optional `query` and `limit` (1 to 250) and returns the list (<https://t0ll.xyz/api/markets/stocks?limit=3>).

Facts with their sources, not advice. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd, not shares.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the provider tells the agent it can pay per check there (0.05 USDG on Robinhood Chain or USDC on Base), with the owner's consent; the provider never pays. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Holding $TOLL lifts the daily limits. Make a Toll key at <https://t0ll.xyz/toll#keys> and pass it as `tollKey`: it is sent as `x-toll-pass` on every t0ll.xyz call and carries the key wallet's tier.

| Per UTC day | Free | 1M $TOLL | 5M $TOLL | 20M $TOLL |
| --- | --- | --- | --- | --- |
| New coins (check_coin, larp_check) | 10 | 100 | 500 | 2,000 |
| Markets calls (stock_token, stock_tokens) | 50 | 1,000 | 5,000 | 20,000 |

Past that, x402 per call: 0.05 USDG a coin check (`https://t0ll.xyz/api/x402/check/{token}`), 0.02 USDG a Stock Token (`https://t0ll.xyz/api/x402/stock/{id}`), on Robinhood Chain (or USDC on Base). Over the Markets count, `stock_token` answers with the paid URL for that token and the tiers instead of the JSON.

Note: AgentKit's own `@CreateAction` decorator sends AgentKit's usage analytics on each action call; that is AgentKit's behaviour, not Toll's. In AgentKit 0.10.4 that call is not awaited: if the analytics endpoint answers with an error (we saw HTTP 400 on every call, 2026-10-29) the rejection is unhandled and Node exits. Until AgentKit catches it, add `process.on("unhandledRejection", (e) => console.warn(e))` or similar in your app.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
