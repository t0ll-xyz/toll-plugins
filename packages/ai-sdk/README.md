# @tollxyz/ai-sdk

[Vercel AI SDK](https://ai-sdk.dev) tools for [Toll](https://t0ll.xyz/agents/plugins). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Tools: `check_coin`, `larp_check` (Robinhood Chain and Solana), `dev_record`, `launch_record`, `fresh_launches`, `chain_pulse`.

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
  tools: tollTools(),          // or tollTools({ only: ["check_coin", "larp_check"] })
  prompt: "Check 0xff9e86e6b21fd688027981bee4b64c8b6b804ed3 on Robinhood Chain before I buy.",
});
```

`Toll` and `TollError` are re-exported from `@tollxyz/sdk`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the tool's answer ends with the x402 URL for that coin and tells the agent it can pay per check there (0.05 USDG on Robinhood Chain or USDC on Base). Holding $TOLL does not lift this limit. A LARP check that is still being read, or a busy Toll, is awaited for you (up to 3 asks, 120 s). When part of an answer is still being read, the text says so and gives the seconds to wait.

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
