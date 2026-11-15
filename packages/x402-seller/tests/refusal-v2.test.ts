// A refused payment is answered in the version it was sent in (0.3.2). Found by Agent_Minimum #7622's paid field test
// on 2026-11-15: a v2 client saw a bare 402 because the reason ("self_payment") sat in a v1 body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { requirement, paywall, type SellerOptions } from "../src/index.js";

const PAY_TO = "0x02593abff31f4e8ec1d5c2f297a347c51ef06e5c";
const opts: SellerOptions = { payTo: PAY_TO, price: "0.05", agentId: 20030, description: "a check" };
const URL_ = "https://seller.example/api/thing";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

function fakeFetch(answers: { verify?: unknown; settle?: unknown }) {
  const calls: string[] = [];
  const f = async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const op = u.endsWith("/verify") ? "verify" : "settle";
    return new Response(JSON.stringify(answers[op] ?? {}), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { f: f as typeof fetch, calls };
}
const v2 = (accepted: Record<string, unknown>) =>
  new Request(URL_, { headers: { "payment-signature": b64({ x402Version: 2, accepted, payload: { signature: "0xsig", authorization: { from: PAY_TO } } }) } });
const v1 = () => new Request(URL_, { headers: { "x-payment": b64({ x402Version: 1, scheme: "exact", network: "robinhood", payload: { signature: "0xsig" } }) } });

test("v2 self_payment at verify: body and PAYMENT-REQUIRED are both v2 with the reason and message", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: false, invalidReason: "self_payment", invalidMessage: "the payer and the payee are the same wallet", payer: PAY_TO } });
  const res = await paywall({ ...opts, fetch: f }, () => new Response("x"))(v2(requirement(opts)));
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 2);
  assert.equal(body.error, "self_payment");
  assert.equal(body.message, "the payer and the payee are the same wallet");
  assert.equal(body.accepts[0].payTo, PAY_TO);
  const pr = unb64(res.headers.get("payment-required")!);
  assert.equal(pr.x402Version, 2);
  assert.equal(pr.error, "self_payment");
  assert.equal(res.headers.get("payment-response"), null, "a verify refusal is told in PAYMENT-REQUIRED, as the v2 transport does");
  assert.equal(calls.length, 1);
});

test("v2 refusal at settle: PAYMENT-RESPONSE carries the failed SettleResponse", async () => {
  const { f } = fakeFetch({ verify: { isValid: true }, settle: { success: false, errorReason: "payee_mismatch", errorMessage: "not\u0000 the seller's wallet", transaction: "", network: "eip155:4663", payer: "0xpayer" } });
  const res = await paywall({ ...opts, fetch: f }, () => new Response("secret"))(v2(requirement(opts)));
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 2);
  assert.equal(body.error, "payee_mismatch");
  assert.equal(body.message, "not  the seller's wallet");
  const s = unb64(res.headers.get("payment-response")!);
  assert.deepEqual(s, { success: false, errorReason: "payee_mismatch", errorMessage: "not  the seller's wallet", transaction: "", network: "eip155:4663", payer: "0xpayer" });
  assert.match(res.headers.get("access-control-expose-headers")!, /PAYMENT-RESPONSE/);
});

test("v2 payment that does not match: answered v2", async () => {
  const res = await paywall({ ...opts, fetch: fakeFetch({}).f }, () => new Response("x"))(v2({ ...requirement(opts), amount: "1" }));
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 2);
  assert.equal(body.error, "payment_does_not_match_requirements");
});

test("v1 refusal keeps the v1 body and the v2 header, unchanged", async () => {
  const { f } = fakeFetch({ verify: { isValid: false, invalidReason: "self_payment", invalidMessage: "same wallet" } });
  const res = await paywall({ ...opts, fetch: f }, () => new Response("x"))(v1());
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 1);
  assert.equal(body.error, "self_payment");
  assert.equal(body.message, undefined);
  assert.equal(body.accepts[0].maxAmountRequired, "50000");
  assert.equal(unb64(res.headers.get("payment-required")!).error, "self_payment");
});

test("no payment: still the v1 body + v2 header 402", async () => {
  const res = await paywall({ ...opts, fetch: fakeFetch({}).f }, () => new Response("x"))(new Request(URL_));
  assert.equal(res.status, 402);
  assert.equal((await res.json()).x402Version, 1);
  assert.equal(unb64(res.headers.get("payment-required")!).x402Version, 2);
});
