# @tollxyz/priors-guard

Toll's free pre-sign check as a [Priors](https://priors.trade) payer's `beforePay`. Before an agent pays an x402
seller on Robinhood Chain, and before it borrows to pay one, Toll checks who gets paid.

```js
import { createPayer } from "@priors/x402";
import { tollCheck } from "@tollxyz/priors-guard";

const payer = createPayer({
  signer, pool, agentId: 1234, maxBorrow: "$5",
  beforePay: tollCheck(),                        // refuses BLOCK
});
// a refused payment: PayError TOLL_REFUSED { action, codes, link }; nothing was read, borrowed or signed
```

Needs `@priors/x402` with `beforePay` (a peer dependency).

## What Toll checks

`POST https://t0ll.xyz/api/tx/check`, free and keyless, answers an
[ERC-8265](https://github.com/ethereum/ERCs/pull/1753) RiskAssessment: ALLOW / WARN / BLOCK with reason codes. For an
x402 payment Toll reads the seller's ERC-8004 identity and checks `payTo` against its registered agent wallet or a
payee delegation ([ERC-8478](https://github.com/ethereum/ERCs/pull/2132) draft), then the asset and the amount.

- A `payTo` that is not the seller's: **BLOCK** (`x402-payee-mismatch`), refused by default.
- A seller Toll cannot identify: **WARN** (`x402-seller-unknown`), which **pays by default**. Use
  `tollCheck({ refuse: ["BLOCK", "WARN"] })` for an agent that pays only sellers whose payee Toll could verify.

## What is sent

The 402's requirement, the resource's origin and path (never its query string or fragment), and `agentId` when you
give it. Nothing is signed.

## When Toll gives no usable answer

A timeout (default 8 s, covering the whole answer), the caller's abort, an HTTP error, a body over 64 KB or not JSON,
or an answer with no action: `PayError TOLL_UNREAD`, which refuses the payment (fails closed). `failOpen: true` pays
without it.

Error messages hold fixed words and Toll's warning codes only, never text from an answer, because callers show
`PayError` messages to a model. The link to read more is a field (`link`), not part of the message.

## Options

| Option | Default | |
| --- | --- | --- |
| `refuse` | `["BLOCK"]` | `["BLOCK", "WARN"]` for a strict agent |
| `agentId` | none | the seller's ERC-8004 id, when the 402 does not name it |
| `timeoutMs` | `8000` | the whole answer, body included |
| `failOpen` | `false` | pay when Toll gives no usable answer |
| `onResult` | none | `({ action, codes, link }) => void`, every answer read, before it is acted on |
| `fetchImpl`, `url` | `fetch`, Toll's endpoint | |

## Develop

```sh
npm test    # typecheck + node:test, network-free
```

MIT. Toll is ERC-8004 agent #20030 on Robinhood Chain: <https://t0ll.xyz>.
