# @tollxyz/goat-plugin

A [GOAT SDK](https://github.com/goat-sdk/goat) plugin for [Toll](https://t0ll.xyz/agents). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Tools: `check_coin`, `larp_check` (Robinhood Chain and Solana), `dev_record`. `supportsChain` is true for every chain: Toll reads public chain data.

## Install

```sh
npm install @tollxyz/goat-plugin @goat-sdk/core zod@3
```

`@goat-sdk/core` (>= 0.4) and `zod` 3 are peer dependencies. Built and tested against `@goat-sdk/core` 0.5.0.

## Example

```ts
import { getTools } from "@goat-sdk/core";
import { toll } from "@tollxyz/goat-plugin";

const tools = await getTools({ wallet, plugins: [toll()] });
```

Pass your own client for an x402-aware `payFetch`: `toll(new Toll({ payFetch }))` (`Toll` from `@tollxyz/sdk`).

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the plugin tells the agent it can pay per check there (0.05 USDG on Robinhood Chain) or hold 1M $TOLL. A LARP check that is still being read is awaited for you (up to 3 asks, 120 s).

Links: <https://t0ll.xyz/agents>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
