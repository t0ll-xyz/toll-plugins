import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOLL_FACILITATOR,
  USDG,
  usdg,
  requirement,
  paymentRequired,
  readPayment,
  paywall,
  type SellerOptions,
} from "../src/index.js";

const PAY_TO = "0x02593abff31f4e8ec1d5c2f297a347c51ef06e5c";
const opts: SellerOptions = { payTo: PAY_TO, price: "0.05", agentId: 20030, description: "a check" };
const URL_ = "https://seller.example/api/thing";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

/** a facilitator stand-in: records each call and answers from the table */
function fakeFetch(answers: { verify?: unknown; settle?: unknown; status?: number }) {
  const calls: { url: string; body: any }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "null"));
    calls.push({ url: u, body });
    const op = u.endsWith("/verify") ? "verify" : "settle";
    return new Response(JSON.stringify(answers[op] ?? {}), { status: answers.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { f: f as typeof fetch, calls };
}

function paidRequest(accepted: Record<string, unknown>, header = "payment-signature") {
  const p = { x402Version: 2, accepted, payload: { signature: "0xsig", authorization: { from: "0xpayer" } } };
  return new Request(URL_, { headers: { [header]: b64(p) } });
}

test("usdg turns a decimal price into 6-decimal atomic units", () => {
  assert.equal(usdg("0.05"), "50000");
  assert.equal(usdg("1"), "1000000");
  assert.equal(usdg(0.001), "1000");
  assert.equal(usdg("100"), "100000000");
});

test("usdg refuses zero, negatives, more than 6 decimals and junk", () => {
  for (const bad of ["0", "-1", "0.0000001", "abc", "", "1e3"]) assert.throws(() => usdg(bad), /price/);
});

test("the facilitator and the asset are Toll's and USDG's", () => {
  assert.equal(TOLL_FACILITATOR, "https://x402.t0ll.xyz");
  assert.equal(USDG.asset, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  assert.equal(USDG.network, "eip155:4663");
  assert.deepEqual([USDG.name, USDG.version, USDG.decimals], ["Global Dollar", "1", 6]);
});

test("requirement names USDG, its signing domain and the seller's ERC-8004 identity", () => {
  const r = requirement(opts);
  assert.equal(r.scheme, "exact");
  assert.equal(r.network, "eip155:4663");
  assert.equal(r.asset, USDG.asset);
  assert.equal(r.amount, "50000");
  assert.equal(r.payTo, PAY_TO);
  assert.equal(r.maxTimeoutSeconds, 300);
  assert.equal(r.extra.name, "Global Dollar");
  assert.equal(r.extra.version, "1");
  assert.deepEqual(r.extra.erc8004, { registry: "eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", agentId: "20030" });
});

test("requirement without an agentId carries no erc8004 block", () => {
  const r = requirement({ payTo: PAY_TO, price: "0.05" });
  assert.equal("erc8004" in r.extra, false);
});

test("requirement refuses a payTo that is not an address", () => {
  assert.throws(() => requirement({ payTo: "0x123", price: "1" }), /payTo/);
});

test("paymentRequired is x402 v2 with the resource and one accepts entry", () => {
  const p = paymentRequired(opts, URL_, "payment_required");
  assert.equal(p.x402Version, 2);
  assert.equal(p.error, "payment_required");
  assert.equal(p.resource.url, URL_);
  assert.equal(p.accepts.length, 1);
  assert.equal(p.accepts[0].amount, "50000");
});

test("no payment header: 402 with the v1 body and the v2 PAYMENT-REQUIRED header; the handler never runs", async () => {
  let ran = false;
  const h = paywall(opts, () => { ran = true; return new Response("x"); });
  const res = await h(new Request(URL_));
  assert.equal(res.status, 402);
  assert.equal(ran, false);
  const body = await res.json();
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts[0].network, "robinhood");
  assert.equal(body.accepts[0].maxAmountRequired, "50000");
  assert.equal(body.accepts[0].resource, URL_);
  const v2 = unb64(res.headers.get("payment-required")!);
  assert.equal(v2.x402Version, 2);
  assert.equal(v2.accepts[0].asset, USDG.asset);
  assert.match(res.headers.get("access-control-expose-headers") ?? "", /PAYMENT-REQUIRED/);
});

test("readPayment: an undecodable header is refused, a mismatched amount or payee is refused", () => {
  assert.equal(readPayment(new Request(URL_, { headers: { "payment-signature": "%%%" } }), opts, URL_), "invalid_payment");
  const wrong = { ...requirement(opts), amount: "1" };
  assert.equal(readPayment(paidRequest(wrong), opts, URL_), "payment_does_not_match_requirements");
  const wrongPayee = { ...requirement(opts), payTo: "0x4444444444444444444444444444444444444444" };
  assert.equal(readPayment(paidRequest(wrongPayee), opts, URL_), "payment_does_not_match_requirements");
});

test("a valid payment: verify, run the handler, settle, then PAYMENT-RESPONSE with the receipt", async () => {
  const { f, calls } = fakeFetch({
    verify: { isValid: true, payer: "0xpayer" },
    settle: { success: true, transaction: "0xtx", network: "eip155:4663", payer: "0xpayer", extensions: { erc8478: { outcome: "verified-wallet" }, receipt: { signer: "0xs" } } },
  });
  const seen: unknown[] = [];
  const h = paywall({ ...opts, fetch: f, onSettled: (s) => { seen.push(s); } }, () => Response.json({ ok: 1 }));
  const res = await h(paidRequest(requirement(opts)));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: 1 });
  assert.deepEqual(calls.map((c) => c.url), [`${TOLL_FACILITATOR}/verify`, `${TOLL_FACILITATOR}/settle`]);
  assert.equal(calls[0].body.x402Version, 2);
  assert.equal(calls[0].body.paymentRequirements.payTo, PAY_TO);
  const pr = unb64(res.headers.get("payment-response")!);
  assert.equal(pr.success, true);
  assert.equal(pr.transaction, "0xtx");
  assert.deepEqual(pr.receipt, { signer: "0xs" });
  assert.equal(res.headers.get("x-payment-response"), res.headers.get("payment-response"));
  assert.equal(seen.length, 1);
});

test("the legacy X-PAYMENT header (v1) is accepted too", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: true }, settle: { success: true, transaction: "0xtx" } });
  const p = { x402Version: 1, scheme: "exact", network: "robinhood", payload: { signature: "0xsig" } };
  const res = await paywall({ ...opts, fetch: f }, () => new Response("ok"))(new Request(URL_, { headers: { "x-payment": b64(p) } }));
  assert.equal(res.status, 200);
  assert.equal(calls[0].body.x402Version, 1);
  assert.equal(calls[0].body.paymentRequirements.maxAmountRequired, "50000");
});

test("verify refuses: 402 with the facilitator's reason, handler not run, nothing settled", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: false, invalidReason: "insufficient_funds" } });
  let ran = false;
  const res = await paywall({ ...opts, fetch: f }, () => { ran = true; return new Response("x"); })(paidRequest(requirement(opts)));
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, "insufficient_funds");
  assert.equal(ran, false);
  assert.equal(calls.length, 1);
});

test("the handler fails: its answer goes back and the payment is NOT settled", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: true } });
  const res = await paywall({ ...opts, fetch: f }, () => new Response("boom", { status: 500 }))(paidRequest(requirement(opts)));
  assert.equal(res.status, 500);
  assert.equal(calls.length, 1);
  assert.equal(res.headers.get("payment-response"), null);
});

test("settle refuses: 402 with its reason, the paid answer is withheld", async () => {
  const { f } = fakeFetch({ verify: { isValid: true }, settle: { success: false, errorReason: "settlement_failed" } });
  const res = await paywall({ ...opts, fetch: f }, () => new Response("secret"))(paidRequest(requirement(opts)));
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, "settlement_failed");
});

test("the facilitator is down: 503, nothing charged", async () => {
  const f = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const res = await paywall({ ...opts, fetch: f }, () => new Response("x"))(paidRequest(requirement(opts)));
  assert.equal(res.status, 503);
});

test("a facilitator URL can be overridden (trailing slash dropped)", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: true }, settle: { success: true, transaction: "0xtx" } });
  await paywall({ ...opts, fetch: f, facilitator: "https://fac.example/" }, () => new Response("ok"))(paidRequest(requirement(opts)));
  assert.equal(calls[0].url, "https://fac.example/verify");
});
