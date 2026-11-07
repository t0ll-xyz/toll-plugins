# @tollxyz/priors-guard

Toll's free pre-sign check as a [Priors](https://priors.trade) payer's `beforePay`. Before an agent pays an x402
seller on Robinhood Chain, and before it borrows to pay one, Toll checks who gets paid.

```js
import { createPayer } from "@priors/x402";
import { tollPayer } from "@tollxyz/priors-guard";

const payer = tollPayer(createPayer, { signer, pool, agentId: 1234, maxBorrow: "$5" }, {
  agentId: { "https://api.seller.xyz": 20030 },   // the seller you mean to pay, per origin
  refuse: ["WARN"],                               // BLOCK is always refused; WARN too here
});
// a refused payment: PayError TOLL_REFUSED { action, codes, link }; nothing was read, borrowed or signed
```

Needs `@priors/x402` with `beforePay` (a peer dependency, the release after 0.8.8). An older `@priors/x402` ignores
the option and would pay every 402 unchecked, so `tollPayer` (or `requireBeforePay(createPayer)` before
`createPayer({ beforePay: tollCheck() })`) checks first and throws `TOLL_GUARD_UNSUPPORTED` when the hook is not there.

## What Toll checks

`POST https://t0ll.xyz/api/tx/check`, free and keyless, answers an
[ERC-8265](https://github.com/ethereum/ERCs/pull/1753) RiskAssessment: ALLOW / WARN / BLOCK with reason codes. For an
x402 payment Toll reads the seller's ERC-8004 identity and checks `payTo` against its registered agent wallet or a
payee delegation ([ERC-8478](https://github.com/ethereum/ERCs/pull/2132) draft), then the asset and the amount.

- A `payTo` that is not the seller's: **BLOCK** (`x402-payee-mismatch`), refused by default.
- A seller Toll cannot identify (no `extra.erc8004`, no `agentId`): `x402-seller-unknown`, which **pays by default**.
  `refuse: ["WARN"]` refuses a WARN; `requireAgent: true` refuses any origin you named no `agentId` for.
- **Which seller is checked.** Your `agentId` wins: a 402 naming another identity comes back WARN
  (`x402-identity-differs`). Without one, the 402's own `extra.erc8004` is used, and Toll checks that the resource's
  origin is an endpoint in that agent's registration file (WARN `x402-endpoint-unlisted` otherwise). Listing an origin
  is not proof of owning it, so pin the sellers you pay: `agentId` takes one id, a map by origin, or a function.
- **BLOCK is always refused**, whatever `refuse` says.

## What is sent

The requirement's payment fields (scheme, network, asset, amount or maxAmountRequired, payTo, maxTimeoutSeconds) and
`extra.erc8004`, nothing else a payee could pad; the resource's origin and path (never its query string or fragment);
and `agentId` when you give one for that origin. Nothing is signed.

## When Toll gives no usable answer

A timeout (default 8 s, covering the whole answer), the caller's abort, an HTTP error, a body over 64 KB or not JSON,
or an answer with no action: `PayError TOLL_UNREAD`, which refuses the payment (fails closed). `failOpen: true` pays
only when Toll cannot be reached (a network error, a timeout, HTTP 429 or 5xx), never on a 4xx or a bad body, which a
payee could cause.

Error messages hold fixed words and Toll's warning codes only, never text from an answer, because callers show
`PayError` messages to a model. The link to read more is a field (`link`), not part of the message.

## Options

| Option | Default | |
| --- | --- | --- |
| `refuse` | BLOCK | add `"WARN"` for a strict agent; BLOCK is always refused |
| `agentId` | none | the seller you mean to pay: an id, a map by origin, or `(origin) => id` |
| `requireAgent` | `false` | refuse an origin you named no `agentId` for |
| `timeoutMs` | `8000` | the whole answer, body included |
| `failOpen` | `false` | pay when Toll cannot be reached (network, timeout, 429, 5xx) |
| `onResult` | none | `({ action, codes, link }) => void`, every answer read, before it is acted on |
| `fetchImpl`, `url` | `fetch`, Toll's endpoint | |

## Develop

```sh
npm test    # typecheck + node:test, network-free
```

MIT. Toll is ERC-8004 agent #20030 on Robinhood Chain: <https://t0ll.xyz>.

Reviewed before release by [Hey Research Lab](https://x.com/HeyResearch) (private report, 2026-11-07): the fixes
in 0.2.0 (the hook probe, per-origin agents, BLOCK always refused, failOpen only when unreachable, the trimmed
request, the kept-alive timeout) come from it.
