# Changelog: @tollxyz/plugin-elizaos

## 0.7.0 (2026-11-17)

- New `TOLL_ACCOUNT_PERMISSIONS` action, running `account_permissions` (Toll's MCP tool, live 2026-11-17): a Safe or smart account's standing permissions on Robinhood Chain (owners and threshold, modules, guard, fallback handler, Zodiac Roles members and what each may call, a Delay's waiting period, ERC-7579 modules, an EIP-7702 delegate), who can move its funds without the owners signing, and the parts not read. Runs on a word like permissions, modules, multisig or smart account with a 0x address (not on an approvals question, which stays with `TOLL_WALLET_APPROVALS`). Needs `@tollxyz/sdk` 0.8.0.
- `TOLL_CHECK_TX` carries `check_tx`'s live description of 2026-11-17 (standing power over a smart account: Safe module, guard, fallback handler, owner or threshold change, Zodiac Roles grant, ERC-7579 module install).

## 0.6.0 (2026-11-16)

- elizaOS 2.x: the peer range is `^1.6.0 || ^2.0.0`. `npm test` type-checks the plugin and the README examples against `@elizaos/core` 2.0.5 too (dev alias `@elizaos/core-v2`). The README's character uses `bio: ["..."]`, the one form 2.x accepts.
- `createTollPlugin({ budgetMs })` or the `TOLL_BUDGET_MS` setting: a time budget for `TOLL_PRE_BUY_CHECK` (`budget_ms`) and `TOLL_CHECK_TX` (`POST /api/tx/check` with `budgetMs`). Not read in time = WAIT / WARN `coin-not-read`, never ALLOW. Needs `@tollxyz/sdk` 0.7.2.
- `TOLL_COIN_HINT` adds the verdict Toll already holds for the coin in the message (`check_coins`, free, at most 2.5 s), in `values.tollVerdict`; INCOMPLETE and not read are said as not clear. `heldVerdictOf()`, `PROVIDER_TIMEOUT_MS`.
- `withTollPreBuy(action, opts)`: runs Toll's `pre_buy_check` before another plugin's buy action; only ALLOW runs it, everything else refuses (fail closed); `TOLL_GUARD=off` turns it off.
- `TOLL_PRE_BUY` is a simile of `TOLL_PRE_BUY_CHECK`.
- Tests: `tests/v06.test.ts` (mocked), and a live smoke test (`tests/smoke.test.ts`) skipped unless `TOLL_LIVE=1`.

## 0.5.0 (2026-11-10)

- New action `TOLL_FIND_PAID_API`: runs on words like paid API or x402 endpoints; a quoted phrase or the words after "for" are the query (`paidApiQueryOf` exported).
- Depends on `@tollxyz/sdk` ^0.6.0. Descriptions and schemas match https://t0ll.xyz/mcp (28 tools, read 2026-11-10).

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/plugin-elizaos`.
