# @tollxyz/agentkit

A [Coinbase AgentKit](https://github.com/coinbase/agentkit) action provider for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Actions: `check_coin`, `larp_check` (Robinhood Chain and Solana), `dev_record`, `launch_record`, `fresh_launches`, `chain_pulse`. AgentKit prefixes the names with the class, e.g. `TollActionProvider_check_coin`. `supportsNetwork` is true for every network: Toll reads public chain data, whatever chain the agent's wallet is on.

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
```

`Toll` and `TollError` are re-exported from `@tollxyz/sdk`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer ends with the x402 URL for that coin and the provider tells the agent it can pay per check there (0.05 USDG on Robinhood Chain or USDC on Base). Holding $TOLL does not lift this limit. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Note: AgentKit's own `@CreateAction` decorator sends AgentKit's usage analytics on each action call; that is AgentKit's behaviour, not Toll's. In AgentKit 0.10.4 that call is not awaited: if the analytics endpoint answers with an error (we saw HTTP 400 on every call, 2026-10-29) the rejection is unhandled and Node exits. Until AgentKit catches it, add `process.on("unhandledRejection", (e) => console.warn(e))` or similar in your app.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
