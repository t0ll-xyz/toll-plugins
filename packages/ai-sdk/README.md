# @tollxyz/ai-sdk

[Vercel AI SDK](https://ai-sdk.dev) tools for [Toll](https://t0ll.xyz/agents). Before your agent buys a coin on Robinhood Chain, Solana or BSC, it can check who is behind it (snipers, bundles, the dev's record, whether liquidity can be pulled) and whether there is a real product behind it. Facts read from the chain. Information only, not financial advice.

Tools: `check_coin`, `larp_check` (Robinhood Chain and Solana), `dev_record`, `launch_record`, `fresh_launches`, `chain_pulse`.

## Install

```sh
npm install @tollxyz/ai-sdk ai zod
```

`ai` (>= 6) and `zod` (3.25+ or 4) are peer dependencies. Built and tested against `ai` 7.0.154 (Node >= 22), using `tool()` with `inputSchema`.

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

Pass your own client for an x402-aware `payFetch`: `tollTools({ client: new Toll({ payFetch }) })` (`Toll` from `@tollxyz/sdk`).

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the tool's answer ends with the x402 URL for that coin and tells the agent it can pay per check there (0.05 USDG on Robinhood Chain) or hold 1M $TOLL. A LARP check that is still being read is awaited for you (up to 3 asks, 120 s).

Links: <https://t0ll.xyz/agents>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>. MIT.
