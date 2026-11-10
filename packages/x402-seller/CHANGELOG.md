# Changelog: @tollxyz/x402-seller

## 0.3.0 (2026-11-10)

- `signReceipt(typedData)`: sign the x402 offer-receipt spec's receipt with your own key. The forwarded payment carries `extensions["offer-receipt"]` and the resource; when the settle answer's `extensions["toll-offer-receipt"].receiptPayload` is this settlement's (version 1, eip155:4663, this resource, the settled payer and transaction), it is signed and sent to the buyer in `PAYMENT-RESPONSE` as `extensions["offer-receipt"].info.receipt = { format: "eip712", payload, signature }`, and kept in `settlement.offerReceipt`. A signer that throws only means no receipt. `receiptTypedData()`, `receiptPayloadOf()`, `RECEIPT_DOMAIN`, `RECEIPT_TYPES`, types `ReceiptPayload`, `SignedReceipt`, `ReceiptTypedData`.
- `paidBefore({ payer, payTo, resource?, since?, facilitator?, fetch? })`: `GET /paid` on Toll's facilitator, whether a wallet already paid you, for letting a sign-in-with-x verified returning wallet in without a second charge. Type `PaidAnswer`.

## 0.2.0 (2026-11-10)

- `appCode`: your ERC-8021 builder code (`^[a-z0-9_]{1,32}$`, checked when the route loads), sent in the 402 as `extensions["builder-code"].info.a` and in the payment forwarded to the facilitator (the buyer's service codes kept), so Toll's facilitator names your app in each settlement's calldata.
- `bazaar`: describe the endpoint per the x402 bazaar extension (`{ info, schema }`, JSON Schema 2020-12 with only `#` references, under 64 KB; `serviceName`, `tags`, `iconUrl` on the resource with the spec's soft-drop rules). It rides in the 402 and in the forwarded payment, so a payment that settles lists the endpoint in Toll's discovery. `bazaarExtension()`, `checkBazaar()`, `validIconUrl()`, `declaredExtensions()`, `withDeclared()` exported.
- The safety screen (`toll-screen`): `payment.screen` (the verify answer's, before the handler runs) and `settlement.screen` (the settle answer's, in `onSettled`); `Screen` type and `screenOf()`. Never forwarded to the buyer.
- `paymentRequired()` and `need402()` take the request method (for the bazaar input).

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/x402-seller`.
