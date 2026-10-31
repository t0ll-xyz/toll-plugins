# x402 starter for Robinhood Chain

Sell an API to agents in a few minutes. Every call costs a price you set, paid in USDG on Robinhood Chain over
[x402](https://x402.org), and settled by [Toll's facilitator](https://x402.t0ll.xyz): keyless, free, no account.

- **Payee check (ERC-8478):** set your ERC-8004 agent id and buyers can check that the money goes to your registered
  agent wallet. Verified sellers are listed in the [x402 Register](https://x402.t0ll.xyz/#register).
- **Signed receipt** for every settled payment, in the `PAYMENT-RESPONSE` header.
- **Charged only for a real answer:** your code runs only for a verified payment, and the payment settles only when
  your code answers below 400.

## Start

```
npx degit t0ll-xyz/toll-plugins/templates/x402-starter my-api
cd my-api
cp .env.example .env      # set PAY_TO (and AGENT_ID if you have one)
npm install
npm run dev
```

Then:

```
curl -i http://localhost:3000/api/forecast?city=Dubai
```

answers `402 Payment Required` with the price in the body (x402 v1) and in the `PAYMENT-REQUIRED` header (x402 v2).
An x402 client (x402-fetch, x402-axios, an agent with an x402 wallet) pays and gets the answer.

## Make it yours

Edit `app/api/forecast/route.ts`: replace `forecast()` with what you sell. Add more paid routes the same way, one
`paywall(...)` each, each with its own price.

## Settings (.env)

| | |
| --- | --- |
| `PAY_TO` | the wallet paid. To be verified in the x402 Register, the agentWallet your ERC-8004 identity registered |
| `PRICE` | USDG per call, e.g. `0.01` (0.001 to 100) |
| `AGENT_ID` | your ERC-8004 agent id on Robinhood Chain (optional, recommended) |

## Get listed

1. Deploy anywhere that runs Next.js (Vercel, Railway, your own server).
2. Put your paid endpoint in your ERC-8004 registration file as an `x402` service. Toll's agent census reads every
   registered agent daily, and you appear in the [x402 Register](https://x402.t0ll.xyz/#register).
3. When your payTo is your agent wallet, add the badge to your site or README:

   `[![checked by Toll](https://t0ll.xyz/agents/census/<agent id>/badge.svg)](https://t0ll.xyz/agents/census/<agent id>)`

   It reads *payTo verified*, and *payTo verified · settles via Toll* once a payment settles through Toll.

Built on [`@tollxyz/x402-seller`](https://www.npmjs.com/package/@tollxyz/x402-seller). MIT.
