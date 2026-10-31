# @tollxyz/x402-seller

Sell over x402 on Robinhood Chain in one line. Buyers pay in USDG; the payment is verified and settled by
[Toll's facilitator](https://x402.t0ll.xyz): keyless, free, no account.

- **Payee check (ERC-8478):** name your ERC-8004 agent id and payers can check that your payTo is your registered
  agent wallet. Verified sellers are marked in the [x402 Register](https://x402.t0ll.xyz/#register).
- **Signed receipt:** every settled payment comes back with a Toll-signed EIP-712 receipt in `PAYMENT-RESPONSE`.
- **Charged only for a real answer:** your handler runs only for a verified payment, and the payment settles only
  when your handler answered below 400.
- Zero runtime dependencies. Works with any Web-standard handler: Next.js, Hono, Bun, Deno, Cloudflare Workers.

```
npm i @tollxyz/x402-seller
```

## Next.js (App Router)

```ts
// app/api/forecast/route.ts
import { paywall } from "@tollxyz/x402-seller";

export const GET = paywall(
  { payTo: "0xYourAgentWallet", price: "0.05", agentId: 12345, description: "tomorrow's forecast" },
  async (req) => Response.json({ forecast: "sunny" }),
);
```

## Hono

```ts
import { Hono } from "hono";
import { paywall } from "@tollxyz/x402-seller";

const forecast = paywall({ payTo: "0xYourAgentWallet", price: "0.05", agentId: 12345 }, async () => Response.json({ forecast: "sunny" }));
const app = new Hono();
app.get("/forecast", (c) => forecast(c.req.raw));
```

## Options

| Option | |
| --- | --- |
| `payTo` | the wallet paid; for the payee check, the agentWallet your ERC-8004 identity registered |
| `price` | USDG as a decimal, e.g. `"0.05"` (Toll's facilitator takes 0.001 to 100 USDG a payment) |
| `agentId` | your ERC-8004 agent id on Robinhood Chain (optional, recommended) |
| `description`, `mimeType` | what is sold, shown in the 402 |
| `maxTimeoutSeconds` | how long a signed payment stays valid (default 300) |
| `onSettled(settlement, req)` | called after each settlement: the transaction, the payer, the payee check, the receipt |
| `facilitator` | another facilitator URL (default `https://x402.t0ll.xyz`) |

## Using a stock x402 library instead

Point it at `https://x402.t0ll.xyz` as the facilitator and name the asset explicitly (most libraries have no default
for chain 4663): asset `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, network `eip155:4663` (v1: `robinhood`),
`extra: { name: "Global Dollar", version: "1" }`. `requirement()` and `paymentRequired()` from this package build
those objects for you.

## Links

[x402.t0ll.xyz](https://x402.t0ll.xyz) · [x402 Register](https://x402.t0ll.xyz/#register) ·
[ERC-8478](https://github.com/ethereum/ERCs/pull/2132) · [t0ll.xyz](https://t0ll.xyz)
