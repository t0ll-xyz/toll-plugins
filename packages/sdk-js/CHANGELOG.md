# Changelog: @tollxyz/sdk

## 0.7.2 (unreleased)

- `checkTx(req, { budgetMs })`: a time budget for a caller with a timeout (300 to 30000 ms; your timeout minus your own round trip). With a budget the check goes to `POST /api/tx/check` (the MCP tool takes no budget) and comes back as the same text the MCP tool answers, so `action`, `assessment` and `pending` read the same. A coin not read in time is WARN `coin-not-read` with `pending`, never ALLOW. Without a budget nothing changes.
- `preBuyCheck(address, { budgetMs })`: sends `budget_ms` (300 to 25000 ms) to `pre_buy_check`; not read in time = `Decision: WAIT` with the seconds to ask again.
- `call(name, args, { timeoutMs })`: an optional per-call HTTP timeout. New exports `clampBudgetMs`, `checkTxText`, `BudgetOptions`, `CHECK_TX_BUDGET_MIN_MS` / `_MAX_MS`, `PRE_BUY_BUDGET_MIN_MS` / `_MAX_MS`.

## 0.7.1 (unreleased)

- `checkTx` sends every kind of request the live `check_tx` reads: `authorizationList` (a type-4 EIP-7702 transaction, or a signAuthorization alone), `message` + `origin` (personal_sign / eth_sign, Sign-In with Ethereum), `rpc` (the wallet request as sent, `{method, params}`), `userOp` + `entryPoint` (ERC-4337) and `intent`. Before, a request carrying only one of these was refused locally ("needs a transaction, typedData or x402") and `CheckTxRequest` had no field for them.

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
