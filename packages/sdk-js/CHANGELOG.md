# Changelog: @tollxyz/sdk

## 0.7.0 (2026-11-10)

- `paidBefore({ payer, payTo, resource?, since? })`: `GET /paid` on Toll's facilitator, whether a wallet already paid a payTo through it (settlements, escrow captures, batch charges). Typed `PaidAnswer`, `PaidEntry`, `PaidSource`.
- Offer-receipt (the x402 extension): types `TollOfferReceipt`, `OfferFacts`, `ReceiptPayload`, `ReceiptRowOfferReceipt`, `SignedReceipt`; `tollOfferReceiptOf(answer)` reads `extensions["toll-offer-receipt"]`; `receiptTypedData(payload)` builds the spec's EIP-712 receipt for the seller to sign; `RECEIPT_DOMAIN`, `RECEIPT_TYPES`. `FacilitatorExtensions` names `toll-offer-receipt`.
- Per-payer budgets (coming; the facilitator answers 404 `budgets_off` until they are switched on): `budgetTypedData(budget)`, `revokeTypedData({ payer, nonce })`, `setBudget({ budget, signature })`, `revokeBudget({ payer, nonce, signature })`, `getBudget(payer)`; `BUDGET_DOMAIN`, `BUDGET_TYPES`, `REVOKE_TYPES`, `BUDGET_MAX_PAYTOS`; types `BudgetInput`, `BudgetMessage`, `BudgetState`, `BudgetSetAnswer`, `PayToCap`, `TypedData`.

## 0.6.0 (2026-11-10)

- `findPaidApi({ query?, limit? })`: the new `find_paid_api` MCP tool (paid x402 APIs on Robinhood Chain, verified payTo first), as text. `TOOL_NAMES` lists 28.
- `findPaidApis({ query?, type?, payTo?, operator?, limit?, offset? })`: the discovery catalog of Toll's x402 facilitator, typed (`PaidApiList`, `PaidApi`, `DiscoveryOperator`). `GET /discovery/search` with a query, `GET /discovery/resources` without; search's `resources` come back as `items`.
- New option `facilitatorUrl` (default https://x402.t0ll.xyz, or `${baseUrl}/api/facilitator` with another `baseUrl`); `TOLL_FACILITATOR`.
- Facilitator answer types `FacilitatorVerifyResponse`, `FacilitatorSettleResponse`, `FacilitatorExtensions`, `FacilitatorScreen` (`toll-screen`: `{ outcome: "allow" | "warn" | "block" | "not-read", codes }`) and `screenOf(answer)`.

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/sdk-js`.
