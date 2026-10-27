# @t0ll/plugin-elizaos

An [elizaOS](https://docs.elizaos.ai) plugin for [Toll](https://t0ll.xyz/agents). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Actions: `TOLL_CHECK_COIN`, `TOLL_LARP_CHECK` (Robinhood Chain and Solana), `TOLL_DEV_RECORD`. Each one runs when the message holds an address, and answers with Toll's text. A provider adds a one-line hint to the context only when a message contains a token address.

## Install

```sh
npm install @t0ll/plugin-elizaos
```

`@elizaos/core` (>= 1.6) is a peer dependency. Built and typed against `@elizaos/core` 1.7.2.

## Example

```ts
import { tollPlugin } from "@t0ll/plugin-elizaos";

export const character = {
  name: "Trader",
  plugins: [tollPlugin],   // or: plugins: ["@t0ll/plugin-elizaos"]
};
```

Custom client (your own `fetch`, or an x402-aware `payFetch`):

```ts
import { Toll } from "@t0ll/sdk";
import { createTollPlugin } from "@t0ll/plugin-elizaos";

const plugin = createTollPlugin({ client: new Toll({ payFetch }) });
```

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the plugin tells the agent it can pay per check there (0.05 USDG on Robinhood Chain) or hold 1M $TOLL. A LARP check that is still being read is awaited for you (up to 3 asks, 120 s).

Links: <https://t0ll.xyz/agents>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
