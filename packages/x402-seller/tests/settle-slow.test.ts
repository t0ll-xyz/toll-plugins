import { test } from "node:test";
import assert from "node:assert/strict";
import { paywall, requirement, TOLL_FACILITATOR, type SellerOptions } from "../src/index.js";

/**
 * 0.3.1 (audit 2026-11-11, PUB-4): A SETTLE THAT DID NOT ANSWER IS NOT "NOTHING WAS CHARGED".
 * The handler has already run when /settle is called. /settle got the same 15 s as /verify while the facilitator may
 * take up to 60 s, and a timeout or a 5xx answered "Nothing was charged. Try again shortly." although the transfer could
 * still land: a buyer could pay and get nothing, told otherwise. Now: settle waits 60 s, is asked once more with the
 * SAME payment when it fails or says pending (the facilitator answers the same settlement, it never charges twice), and
 * if it still has no answer the buyer is told the payment may still settle and to send the same payment again.
 */
const PAY_TO = "0x02593abff31f4e8ec1d5c2f297a347c51ef06e5c";
const opts: SellerOptions = { payTo: PAY_TO, price: "0.05" };
const URL_ = "https://seller.example/api/thing";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const paid = () => new Request(URL_, { headers: { "payment-signature": b64({ x402Version: 2, accepted: requirement(opts), payload: { signature: "0xsig", authorization: { from: "0xpayer" } } }) } });
const OK = { success: true, transaction: "0xtx", network: "eip155:4663", payer: "0xpayer" };

/** verify always passes; settle answers from the queue (an Error is thrown, a number is that HTTP status with no JSON) */
function fac(settles: Array<Record<string, unknown> | Error | number>) {
  const calls: Array<{ op: string; body: any; timeoutMs: number | null }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const op = String(url).endsWith("/verify") ? "verify" : "settle";
    calls.push({ op, body: JSON.parse(String(init?.body)), timeoutMs: null });
    if (op === "verify") return Response.json({ isValid: true, payer: "0xpayer" });
    const a = settles.shift();
    if (a === undefined) throw new Error("no more settle answers");
    if (a instanceof Error) throw a;
    if (typeof a === "number") return new Response("upstream", { status: a });
    return Response.json(a);
  }) as typeof fetch;
  return { f, calls, settles: () => calls.filter((c) => c.op === "settle") };
}
const noSleep = async () => {};

test("a settle that times out is asked again with the same payment, and the answer is served once it settles", async () => {
  const x = fac([new Error("TimeoutError"), OK]);
  const res = await paywall({ ...opts, fetch: x.f, sleep: noSleep }, () => Response.json({ ok: 1 }))(paid());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: 1 });
  assert.equal(x.settles().length, 2);
  assert.deepEqual(x.settles()[0].body, x.settles()[1].body);       // the same payment, never a new one
  assert.ok(res.headers.get("payment-response"));
});

test("a 5xx from settle is asked again too", async () => {
  const x = fac([502, OK]);
  const res = await paywall({ ...opts, fetch: x.f, sleep: noSleep }, () => Response.json({ ok: 1 }))(paid());
  assert.equal(res.status, 200);
  assert.equal(x.settles().length, 2);
});

test("settlement_pending is waited on, not answered as a refusal", async () => {
  const x = fac([{ success: false, errorReason: "settlement_pending", transaction: "0xtx" }, OK]);
  const res = await paywall({ ...opts, fetch: x.f, sleep: noSleep }, () => Response.json({ ok: 1 }))(paid());
  assert.equal(res.status, 200);
  assert.equal(x.settles().length, 2);
});

test("still no answer after the second try: 503 that says the payment MAY settle and to send the same payment again; never 'nothing was charged'", async () => {
  const x = fac([new Error("TimeoutError"), new Error("TimeoutError")]);
  const res = await paywall({ ...opts, fetch: x.f, sleep: noSleep }, () => new Response("secret"))(paid());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "settlement_unknown");
  assert.match(body.error, /may still settle/i);
  assert.match(body.error, /same payment/i);
  assert.doesNotMatch(body.error, /nothing was charged/i);
  assert.ok(res.headers.get("retry-after"));
  assert.equal(x.settles().length, 2);
});

test("still pending after the second try: 503 with the transaction, not a 402 asking for a new payment", async () => {
  const pending = { success: false, errorReason: "settlement_pending", transaction: "0xtx" };
  const x = fac([pending, { ...pending }]);
  const res = await paywall({ ...opts, fetch: x.f, sleep: noSleep }, () => new Response("secret"))(paid());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "settlement_pending");
  assert.equal(body.transaction, "0xtx");
  assert.match(body.error, /same payment/i);
});

test("a real refusal from settle is still a 402 with its reason, asked once", async () => {
  const x = fac([{ success: false, errorReason: "insufficient_funds" }]);
  const res = await paywall({ ...opts, fetch: x.f, sleep: noSleep }, () => new Response("secret"))(paid());
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, "insufficient_funds");
  assert.equal(x.settles().length, 1);
});

test("verify failing before the handler ran is still 'nothing was charged' (true there), and the handler does not run", async () => {
  let ran = 0;
  const f = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const res = await paywall({ ...opts, fetch: f }, () => { ran++; return new Response("x"); })(paid());
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Nothing was charged/);
  assert.equal(ran, 0);
});

test("settle gets 60 s by default, verify 15 s; settleTimeoutMs sets it", async () => {
  const seen: Array<[string, number]> = [];
  const real = AbortSignal.timeout;
  AbortSignal.timeout = ((ms: number) => { seen.push(["t", ms]); return real.call(AbortSignal, ms); }) as typeof AbortSignal.timeout;
  try {
    const x = fac([OK]);
    await paywall({ ...opts, fetch: x.f }, () => Response.json({}))(paid());
    assert.deepEqual(seen.map((s) => s[1]), [15_000, 60_000]);
    seen.length = 0;
    const y = fac([OK]);
    await paywall({ ...opts, fetch: y.f, timeoutMs: 5_000, settleTimeoutMs: 30_000 }, () => Response.json({}))(paid());
    assert.deepEqual(seen.map((s) => s[1]), [5_000, 30_000]);
  } finally { AbortSignal.timeout = real; }
  assert.equal(TOLL_FACILITATOR, "https://x402.t0ll.xyz");
});
