# Changelog: @tollxyz/x402-seller

## 0.2.0 (2026-11-10)

- `appCode`: your ERC-8021 builder code (`^[a-z0-9_]{1,32}$`, checked when the route loads), sent in the 402 as `extensions["builder-code"].info.a` and in the payment forwarded to the facilitator (the buyer's service codes kept), so Toll's facilitator names your app in each settlement's calldata.
- `bazaar`: describe the endpoint per the x402 bazaar extension (`{ info, schema }`, JSON Schema 2020-12 with only `#` references, under 64 KB; `serviceName`, `tags`, `iconUrl` on the resource with the spec's soft-drop rules). It rides in the 402 and in the forwarded payment, so a payment that settles lists the endpoint in Toll's discovery. `bazaarExtension()`, `checkBazaar()`, `validIconUrl()`, `declaredExtensions()`, `withDeclared()` exported.
- The safety screen (`toll-screen`): `payment.screen` (the verify answer's, before the handler runs) and `settlement.screen` (the settle answer's, in `onSettled`); `Screen` type and `screenOf()`. Never forwarded to the buyer.
- `paymentRequired()` and `need402()` take the request method (for the bazaar input).

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/x402-seller`.
