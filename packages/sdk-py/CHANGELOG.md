# Changelog: toll-sdk

## 0.7.0 (2026-11-10)

- `paid_before(payer, pay_to, resource=None, since=None)`: `GET /paid` on Toll's facilitator, whether a wallet already paid a payTo through it.
- Offer-receipt: `toll_offer_receipt_of(answer)` reads `extensions["toll-offer-receipt"]`; `receipt_typed_data(payload)` builds the spec's EIP-712 receipt for the seller to sign; `RECEIPT_DOMAIN`, `RECEIPT_TYPES`.
- Per-payer budgets (coming; 404 `budgets_off` until switched on): `budget_typed_data(budget)`, `revoke_typed_data(payer, nonce)`, `set_budget(budget, signature)`, `revoke_budget(payer, nonce, signature)`, `get_budget(payer)`; `BUDGET_DOMAIN`, `BUDGET_TYPES`, `REVOKE_TYPES`, `BUDGET_MAX_PAYTOS`. Signs the same bytes as `@tollxyz/sdk` 0.7.0.

## 0.6.0 (2026-11-10)

- `find_paid_api(query=None, limit=None)`: the new `find_paid_api` MCP tool, as text. `TOOL_NAMES` lists 28.
- `find_paid_apis(query=None, pay_to=None, operator=None, limit=None, type=None, offset=None)`: the discovery catalog of Toll's x402 facilitator (`/discovery/search` with a query, `/discovery/resources` without) as `{"x402Version", "items", "pagination", "partialResults"?}`.
- New argument `facilitator_url`; `TOLL_FACILITATOR`, `SCREEN_OUTCOMES` and `screen_of(answer)` for a facilitator answer's `extensions.screen`.

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/sdk-py`.
