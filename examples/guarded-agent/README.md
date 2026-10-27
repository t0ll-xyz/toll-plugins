# guarded-agent

A pattern for agent builders: an agent that will not buy until [Toll](https://t0ll.xyz/agents/plugins)'s check passes. Information only, not financial advice. This is an example of how to wire a check into an agent, not a recommendation to buy or not buy anything. `buy()` is a stub that prints a line and never signs or sends a transaction.

## Run

From the repo root, once: `npm install && npm run build -w @tollxyz/sdk`. Then:

```sh
npm start -w @tollxyz/example-guarded-agent -- 0xff9e86e6b21fd688027981bee4b64c8b6b804ed3 --chain rh
# Solana mint:  ... -- <mint> --chain sol
# BSC:          ... -- 0x... --chain bsc     (the LARP check does not cover BSC, so its label counts as "not read")
```

Exit code 0 = would proceed, 1 = refuse, 2 = error.

## The decision rule (src/rule.ts)

1. Toll's tally (`Findings: N against, M careful, K clear`) shows any "against" finding: refuse.
2. The product label (LARP check) is "not found": refuse.
3. The tally or the label could not be read (for example the free coins are used up and the answer carries a paid URL): refuse. No answer is not a pass.
4. Otherwise: "would proceed". "partly found" and "not read" are listed in the output but do not refuse on their own.

Change the rule to fit your own risk. The tally is parsed from Toll's text, with a fallback that counts the `- against:` lines; both are unit-tested against the real answer text.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, Toll's answer ends with the x402 URL for that coin (0.05 USDG on Robinhood Chain), or hold 1M $TOLL. The script prints that URL; paying it from code is in the [`@tollxyz/sdk`](../../packages/sdk-js) README (`pay()`).

Links: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>. MIT.
