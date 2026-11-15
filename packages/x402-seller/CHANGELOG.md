# Changelog: @tollxyz/x402-seller

## 0.3.2 (2026-11-15)

- A refused payment is answered in the version it was sent in. A v2 payment the facilitator refuses (at verify or at settle, `self_payment` included) now gets a v2 body: the same v2 PaymentRequired as the `PAYMENT-REQUIRED` header, with `error` and the facilitator's `message`; a refusal at settle also carries the failed SettleResponse in `PAYMENT-RESPONSE` (`success: false`, `errorReason`, `errorMessage`), where a v2 client reads a settlement's outcome. Before, every refusal had a v1 body, so a v2 client saw a bare 402. v1 payments and the unpaid 402 are unchanged. Found by Agent_Minimum (#7622) in its field test. `refused402()` is exported.

## 0.3.1 (2026-11-11)

- A settle that gave no answer is no longer answered "Nothing was charged". `/settle` now waits 60 s (`settleTimeoutMs`; `/verify` keeps 15 s), is asked once more with the same payment when it times out, answers 5xx or says `settlement_pending`, and if there is still no answer the buyer gets 503 `settlement_unknown` / `settlement_pending` ("the payment may still settle; send the same payment again"), never a 402 asking for a second payment. The handler had already run by then, so the old message could be false.

## 0.3.0 (2026-11-10)

- `signReceipt(typedData)`: sign the x402 offer-receipt spec's receipt with your own key. The forwarded payment carries `extensions["offer-receipt"]` and the resource; when the settle answer's `extensions["toll-offer-receipt"].receiptPayload` is this settlement's (version 1, eip155:4663, this resource, the settled payer and transaction), it is signed and sent to the buyer in `PAYMENT-RESPONSE` as `extensions["offer-receipt"].info.receipt = { format: "eip712", payload, signature }`, and kept in `settlement.offerReceipt`. A signer that throws only means no receipt. `receiptTypedData()`, `receiptPayloadOf()`, `RECEIPT_DOMAIN`, `RECEIPT_TYPES`, types `ReceiptPayload`, `SignedReceipt`, `ReceiptTypedData`.
- `paidBefore({ payer, payTo, resource?, since?, facilitator?, fetch? })`: `GET /paid` on Toll's facilitator, whether a wallet already paid you, for letting a sign-in-with-x verified returning wallet in without a second charge. Type `PaidAnswer`.

## 0.2.0 (2026-11-10)

- `appCode`: your ERC-8021 builder code (`^[a-z0-9_]{1,32}$`, checked when the route loads), sent in the 402 as `extensions["builder-code"].info.a` and in the payment forwarded to the facilitator (the buyer's service codes kept), so Toll's facilitator names your app in each settlement's calldata.
- `bazaar`: describe the endpoint per the x402 bazaar extension (`{ info, schema }`, JSON Schema 2020-12 with only `#` references, under 64 KB; `serviceName`, `tags`, `iconUrl` on the resource with the spec's soft-drop rules). It rides in the 402 and in the forwarded payment, so a payment that settles lists the endpoint in Toll's discovery. `bazaarExtension()`, `checkBazaar()`, `validIconUrl()`, `declaredExtensions()`, `withDeclared()` exported.
- The safety screen (`toll-screen`): `payment.screen` (the verify answer's, before the handler runs) and `settlement.screen` (the settle answer's, in `onSettled`); `Screen` type and `screenOf()`. Never forwarded to the buyer.
- `paymentRequired()` and `need402()` take the request method (for the bazaar input).

Earlier releases: see the release notes in [PUBLISH.md](../../PUBLISH.md) and the git history of `packages/x402-seller`.
