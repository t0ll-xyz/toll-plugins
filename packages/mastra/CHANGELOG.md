# Changelog: @tollxyz/mastra

## 0.6.0 (unreleased)

- `tollTools({ budgetMs })`: a time budget in ms for `pre_buy_check` and `check_tx` (your timeout minus your round trip). `pre_buy_check` sends `budget_ms`; `check_tx` with a budget goes to `POST /api/tx/check` with `budgetMs` and answers in the MCP tool's text. Not read in time = WAIT / WARN `coin-not-read`, never ALLOW. Unset = unchanged. Needs `@tollxyz/sdk` 0.7.2.
- Tests: mocked budget tests, and a live smoke test (`tests/smoke.test.ts`) skipped unless `TOLL_LIVE=1`.
- Tested against `@mastra/core` 1.83.0 (dev dependency moved from 1.80.0); no API change needed.

## 0.5.1 (unreleased)

- `check_tx` keeps every kind of request the live tool reads: `authorizationList` (a type-4 EIP-7702 transaction, or a signAuthorization alone), `message` + `origin`, `rpc` (the wallet request as sent), `userOp` + `entryPoint` (ERC-4337) and `intent`. Before, the schema dropped them: a type-4 transaction reached Toll as a plain call. Needs `@tollxyz/sdk` 0.7.1.

## 0.5.0 (2026-11-10)

- New tool `find_paid_api` (`{ query?, limit? }`): paid x402 APIs an agent can buy on Robinhood Chain, verified payTo first.
- Depends on `@tollxyz/sdk` ^0.6.0. Descriptions and schemas match https://t0ll.xyz/mcp (28 tools, read 2026-11-10).

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/mastra`.
