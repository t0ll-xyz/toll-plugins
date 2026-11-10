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

Or start from a ready Next.js app: `npx degit t0ll-xyz/toll-plugins/templates/x402-starter my-api`
([templates/x402-starter](https://github.com/t0ll-xyz/toll-plugins/tree/main/templates/x402-starter)).

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
| `onSettled(settlement, req)` | called after each settlement: the transaction, the payer, the payee check, the receipt, `screen` |
| `appCode` | your ERC-8021 builder code (`^[a-z0-9_]{1,32}$`): each settlement's calldata names your app (0.2.0) |
| `bazaar` | describe the endpoint so it is listed in discovery (0.2.0, see below) |
| `facilitator` | another facilitator URL (default `https://x402.t0ll.xyz`) |

## Get listed: `bazaar` (0.2.0)

With `bazaar`, the 402 carries the [x402 bazaar extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md)
(`extensions.bazaar = { info, schema }`) and the payment sent to the facilitator carries it too, even when the buyer's
client does not echo it. Toll's facilitator records the endpoint once a payment settles, after `info` validates against
`schema`; it then shows in `https://x402.t0ll.xyz/discovery/resources`, `/discovery/search`, the `find_paid_api` tool and
<https://t0ll.xyz/x402/discover>, verified when your payTo is your ERC-8004 agent wallet.

```ts
export const GET = paywall(
  {
    payTo: "0xYourAgentWallet", price: "0.05", agentId: 12345, appCode: "forecast_app",
    bazaar: {
      description: "tomorrow's forecast for a city",
      input: { city: "Dubai" },                                        // query parameters (GET) or the body (POST)
      inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      output: { example: { forecast: "sunny" }, schema: { type: "object", properties: { forecast: { type: "string" } } } },
      serviceName: "Forecast Desk", tags: ["weather"], iconUrl: "https://your.site/icon.png",
    },
  },
  async (req) => Response.json({ forecast: "sunny" }),
);
```

`method` defaults to the request's method (`bodyType` to `json` for POST, PUT, PATCH). Schemas may only use `#...`
references (facilitators never fetch one) and the whole extension stays under 64 KB; a bad option throws when the
route loads. Keep your examples valid against your schemas, or the facilitator rejects the listing. `serviceName`,
`tags` and `iconUrl` follow the spec's rules (invalid ones are dropped). `bazaarExtension()` builds the object for
other x402 libraries.

## Builder code: `appCode` (0.2.0)

`appCode` rides in the 402 as `extensions["builder-code"].info.a` and in the payment sent to the facilitator (the
buyer's own service codes `s` are kept). Toll's facilitator appends the ERC-8021 suffix `{ a: your code, w: "toll", s }`
to the settlement's calldata, so sales are attributed to your app on chain. The transfer itself is unchanged.

## The safety screen (0.2.0)

Toll's facilitator reads every payment with `check_tx` and puts its word in `extensions.screen` of the verify and settle
answers: `{ outcome: "allow" | "warn" | "block" | "not-read", codes }`. It is yours, never forwarded to the buyer.

- `payment.screen` (the handler's second argument) is the verify answer's screen, before your handler runs: refuse a
  `block` with a 4xx and nothing is settled.
- `settlement.screen` (in `onSettled`) is the settle answer's screen.

`not-read` means the read did not finish in time; it is never a refusal. Another facilitator sends no screen (undefined).

```ts
export const GET = paywall({ payTo, price: "0.05", onSettled: (s) => log(s.transaction, s.screen) }, async (req, payment) => {
  if (payment.screen?.outcome === "block") return new Response("payment refused", { status: 403 }); // not charged
  return Response.json({ forecast: "sunny" });
});
```

## Using a stock x402 library instead

Point it at `https://x402.t0ll.xyz` as the facilitator and name the asset explicitly (most libraries have no default
for chain 4663): asset `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, network `eip155:4663` (v1: `robinhood`),
`extra: { name: "Global Dollar", version: "1" }`. `requirement()` and `paymentRequired()` from this package build
those objects for you.

## Links

[x402.t0ll.xyz](https://x402.t0ll.xyz) · [x402 Register](https://x402.t0ll.xyz/#register) ·
[ERC-8478](https://github.com/ethereum/ERCs/pull/2132) · [t0ll.xyz](https://t0ll.xyz)
