# Changelog: toll-sdk

## 0.6.0 (2026-11-10)

- `find_paid_api(query=None, limit=None)`: the new `find_paid_api` MCP tool, as text. `TOOL_NAMES` lists 28.
- `find_paid_apis(query=None, pay_to=None, operator=None, limit=None, type=None, offset=None)`: the discovery catalog of Toll's x402 facilitator (`/discovery/search` with a query, `/discovery/resources` without) as `{"x402Version", "items", "pagination", "partialResults"?}`.
- New argument `facilitator_url`; `TOLL_FACILITATOR`, `SCREEN_OUTCOMES` and `screen_of(answer)` for a facilitator answer's `extensions.screen`.

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/sdk-py`.
