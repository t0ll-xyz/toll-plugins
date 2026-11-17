# Changelog: @tollxyz/agentkit

## 0.7.0 (2026-11-17)

- New `account_permissions` action (Toll's MCP tool, live 2026-11-17): a Safe or smart account's standing permissions on Robinhood Chain (owners and threshold, modules, guard, fallback handler, Zodiac Roles members and what each may call, a Delay's waiting period, ERC-7579 modules, an EIP-7702 delegate), who can move its funds without the owners signing, and the parts not read. Takes `{ address }`. Needs `@tollxyz/sdk` 0.8.0.
- `check_tx`'s description is the live one of 2026-11-17 (standing power over a smart account: Safe module, guard, fallback handler, owner or threshold change, Zodiac Roles grant, ERC-7579 module install).

## 0.6.0 (2026-11-16)

- `tollActionProvider({ budgetMs })`: a time budget in ms for `pre_buy_check` and `check_tx` (your timeout minus your round trip). `pre_buy_check` sends `budget_ms`; `check_tx` with a budget goes to `POST /api/tx/check` with `budgetMs` and answers in the MCP tool's text. Not read in time = WAIT / WARN `coin-not-read`, never ALLOW. Unset = unchanged. Needs `@tollxyz/sdk` 0.7.2.
- Tests: mocked budget tests, and a live smoke test (`tests/smoke.test.ts`) skipped unless `TOLL_LIVE=1`.
## 0.5.1 (unreleased)

- `check_tx` keeps every kind of request the live tool reads: `authorizationList` (a type-4 EIP-7702 transaction, or a signAuthorization alone), `message` + `origin`, `rpc` (the wallet request as sent), `userOp` + `entryPoint` (ERC-4337) and `intent`. Before, the schema dropped them: a type-4 transaction reached Toll as a plain call. Needs `@tollxyz/sdk` 0.7.1.

## 0.5.0 (2026-11-10)

- New action `find_paid_api` (`{ query?, limit? }`): paid x402 APIs an agent can buy on Robinhood Chain, verified payTo first.
- Depends on `@tollxyz/sdk` ^0.6.0. Descriptions and schemas match https://t0ll.xyz/mcp (28 tools, read 2026-11-10).

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/agentkit`.
