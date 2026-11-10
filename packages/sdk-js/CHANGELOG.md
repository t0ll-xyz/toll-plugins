# Changelog: @tollxyz/sdk

## 0.6.0 (2026-11-10)

- `findPaidApi({ query?, limit? })`: the new `find_paid_api` MCP tool (paid x402 APIs on Robinhood Chain, verified payTo first), as text. `TOOL_NAMES` lists 28.
- `findPaidApis({ query?, type?, payTo?, operator?, limit?, offset? })`: the discovery catalog of Toll's x402 facilitator, typed (`PaidApiList`, `PaidApi`, `DiscoveryOperator`). `GET /discovery/search` with a query, `GET /discovery/resources` without; search's `resources` come back as `items`.
- New option `facilitatorUrl` (default https://x402.t0ll.xyz, or `${baseUrl}/api/facilitator` with another `baseUrl`); `TOLL_FACILITATOR`.
- Facilitator answer types `FacilitatorVerifyResponse`, `FacilitatorSettleResponse`, `FacilitatorExtensions`, `FacilitatorScreen` (`toll-screen`: `{ outcome: "allow" | "warn" | "block" | "not-read", codes }`) and `screenOf(answer)`.

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/sdk-js`.
