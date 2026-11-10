import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECEIPT_DOMAIN,
  paidBefore,
  paywall,
  receiptPayloadOf,
  receiptTypedData,
  requirement,
  withDeclared,
  type ReceiptTypedData,
  type SellerOptions,
  type Settlement,
} from "../src/index.js";

const PAY_TO = "0x02593abff31f4e8ec1d5c2f297a347c51ef06e5c";
const PAYER = "0x1111111111111111111111111111111111111111";
const URL_ = "https://seller.example/api/forecast";
const TX = `0x${"ab".repeat(32)}`;
const SIG = `0x${"cd".repeat(65)}`;
const base: SellerOptions = { payTo: PAY_TO, price: "0.05", agentId: 20030, description: "a forecast" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
const PAYLOAD = { version: 1, network: "eip155:4663", resourceUrl: URL_, payer: PAYER, issuedAt: 1_800_000_100, transaction: TX };

function fakeFetch(answers: { verify?: unknown; settle?: unknown }) {
  const calls: { url: string; body: any }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? "null")) });
    return Response.json(u.endsWith("/verify") ? answers.verify ?? {} : answers.settle ?? {});
  };
  return { f: f as typeof fetch, calls };
}
function paidRequest(o: SellerOptions, version = 2) {
  const p = version === 2
    ? { x402Version: 2, accepted: requirement(o), payload: { signature: "0xsig", authorization: { from: PAYER } } }
    : { x402Version: 1, scheme: "exact", network: "robinhood", payload: { signature: "0xsig", authorization: { from: PAYER } } };
  return new Request(URL_, { headers: { "payment-signature": b64(p) } });
}
const settledWith = (receiptPayload: unknown) => ({ success: true, transaction: TX, network: "eip155:4663", payer: PAYER,
  extensions: { erc8478: { outcome: "verified" }, receipt: { id: "0x01" }, "toll-offer-receipt": { offer: { read: "none" }, receiptPayload } } });

/* ---------------------------------------------------------------- signReceipt */

test("signReceipt: the forwarded payment carries offer-receipt and the resource; the 402 is unchanged", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: true }, settle: settledWith(PAYLOAD) });
  const o: SellerOptions = { ...base, fetch: f, signReceipt: () => SIG };
  const r402 = await paywall(o, () => new Response("x"))(new Request(URL_));
  assert.equal("extensions" in unb64(r402.headers.get("payment-required")!), false);
  await paywall(o, () => new Response("ok"))(paidRequest(o));
  for (const c of calls) {
    assert.deepEqual(c.body.paymentPayload.extensions["offer-receipt"], { info: {} });
    assert.equal(c.body.paymentPayload.resource.url, URL_);
  }
});

test("signReceipt signs the facilitator's receipt payload and returns it in PAYMENT-RESPONSE as the spec's receipt", async () => {
  const { f } = fakeFetch({ verify: { isValid: true }, settle: settledWith(PAYLOAD) });
  let got: ReceiptTypedData | null = null;
  let seen: Settlement | null = null;
  const o: SellerOptions = { ...base, fetch: f, signReceipt: async (td) => { got = td; return SIG; }, onSettled: (s) => { seen = s; } };
  const res = await paywall(o, () => new Response("ok"))(paidRequest(o));
  assert.equal(res.status, 200);
  assert.deepEqual(got, { domain: RECEIPT_DOMAIN, types: receiptTypedData(PAYLOAD).types, primaryType: "Receipt",
    message: { ...PAYLOAD, version: 1n, issuedAt: 1_800_000_100n } });
  const signed = { format: "eip712", payload: PAYLOAD, signature: SIG };
  const pr = unb64(res.headers.get("payment-response")!);
  assert.deepEqual(pr.extensions, { "offer-receipt": { info: { receipt: signed } } });
  assert.deepEqual(pr.receipt, { id: "0x01" });
  assert.deepEqual(unb64(res.headers.get("x-payment-response")!), pr);
  assert.deepEqual(seen!.offerReceipt, signed);
});

test("signReceipt: no receipt when the payload is not this settlement's, the signer throws or returns junk", async () => {
  const cases: Array<[unknown, SellerOptions["signReceipt"]]> = [
    [{ ...PAYLOAD, payer: "0x2222222222222222222222222222222222222222" }, () => SIG],
    [{ ...PAYLOAD, resourceUrl: "https://other.example/x" }, () => SIG],
    [{ ...PAYLOAD, transaction: `0x${"ef".repeat(32)}` }, () => SIG],
    [{ ...PAYLOAD, network: "eip155:8453" }, () => SIG],
    [null, () => SIG],
    [PAYLOAD, () => { throw new Error("hsm down"); }],
    [PAYLOAD, () => "0x1234"],
  ];
  for (const [payload, signReceipt] of cases) {
    const { f } = fakeFetch({ verify: { isValid: true }, settle: settledWith(payload) });
    const o: SellerOptions = { ...base, fetch: f, signReceipt };
    const res = await paywall(o, () => new Response("ok"))(paidRequest(o));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
    assert.equal(unb64(res.headers.get("payment-response")!).extensions, undefined);
  }
});

test("signReceipt: not called for a failed handler (nothing settles) or without the option", async () => {
  let calls = 0;
  const { f } = fakeFetch({ verify: { isValid: true }, settle: settledWith(PAYLOAD) });
  const o: SellerOptions = { ...base, fetch: f, signReceipt: () => { calls++; return SIG; } };
  assert.equal((await paywall(o, () => new Response("no", { status: 500 }))(paidRequest(o))).status, 500);
  assert.equal(calls, 0);
  const plain = fakeFetch({ verify: { isValid: true }, settle: settledWith(PAYLOAD) });
  const p: SellerOptions = { ...base, fetch: plain.f };
  const res = await paywall(p, () => new Response("ok"))(paidRequest(p));
  assert.equal(unb64(res.headers.get("payment-response")!).extensions, undefined);
  assert.equal(plain.calls[0].body.paymentPayload.extensions, undefined);
  assert.throws(() => paywall({ ...base, signReceipt: "yes" as never }, () => new Response("x")), /signReceipt/);
});

test("withDeclared keeps the buyer's offer-receipt block (its echoed offers) and leaves v1 alone", () => {
  const o: SellerOptions = { ...base, signReceipt: () => SIG };
  const pay = { version: 2 as const, payload: { extensions: { "offer-receipt": { info: { offers: [{ format: "eip712" }] } } } }, requirements: {} };
  assert.deepEqual(withDeclared(pay, o, URL_).payload.extensions, { "offer-receipt": { info: { offers: [{ format: "eip712" }] } } });
  const v1 = { version: 1 as const, payload: {}, requirements: {} };
  assert.equal(withDeclared(v1, o, URL_), v1);
});

test("receiptPayloadOf: an empty transaction (privacy-minimal) is accepted; malformed ones are not", () => {
  const want = { resource: URL_, payer: PAYER.toUpperCase().replace("0X", "0x"), transaction: TX };
  assert.deepEqual(receiptPayloadOf(settledWith({ ...PAYLOAD, transaction: "" }), want), { ...PAYLOAD, transaction: "" });
  assert.equal(receiptPayloadOf(settledWith({ ...PAYLOAD, version: 2 }), want), null);
  assert.equal(receiptPayloadOf(settledWith({ ...PAYLOAD, issuedAt: "1" }), want), null);
  assert.equal(receiptPayloadOf(settledWith(PAYLOAD), { ...want, payer: undefined }), null);
  assert.equal(receiptPayloadOf({}, want), null);
});

test("a receipt signed through signReceipt verifies under the spec's domain and types (viem)", async (tt) => {
  let viem: any, accounts: any;
  try {
    viem = await import("viem" as string);
    accounts = await import("viem/accounts" as string);
  } catch {
    tt.skip("viem not installed");
    return;
  }
  const seller = accounts.privateKeyToAccount(`0x${"43".repeat(32)}`);
  const { f } = fakeFetch({ verify: { isValid: true }, settle: settledWith(PAYLOAD) });
  const o: SellerOptions = { ...base, fetch: f, signReceipt: (td) => seller.signTypedData(td) };
  const res = await paywall(o, () => new Response("ok"))(paidRequest(o));
  const r = unb64(res.headers.get("payment-response")!).extensions["offer-receipt"].info.receipt;
  const types = { Receipt: [
    { name: "version", type: "uint256" }, { name: "network", type: "string" }, { name: "resourceUrl", type: "string" }, { name: "payer", type: "string" },
    { name: "issuedAt", type: "uint256" }, { name: "transaction", type: "string" },
  ] };
  const who = await viem.recoverTypedDataAddress({ domain: { name: "x402 receipt", version: "1", chainId: 1 }, types, primaryType: "Receipt",
    message: { ...r.payload, version: BigInt(r.payload.version), issuedAt: BigInt(r.payload.issuedAt) }, signature: r.signature });
  assert.equal(who, seller.address);
});

/* ---------------------------------------------------------------- paidBefore */

test("paidBefore asks GET /paid on Toll's facilitator (payer, payTo lowercased; resource, since)", async () => {
  const urls: string[] = [];
  const answer = { paid: true, count: 1, last: { tx: TX, ts: 1_794_312_000, amount: "50000", receiptId: "0x01", via: "settlement" }, network: "eip155:4663",
    sources: { settlements: 1, escrow: 0, batch: "not-applicable" } };
  const f = (async (u: string) => { urls.push(String(u)); return Response.json(answer); }) as unknown as typeof fetch;
  const r = await paidBefore({ ...base, payer: PAYER.replace("0x11", "0x1A"), payTo: PAY_TO.toUpperCase().replace("0X", "0x"), resource: URL_, since: new Date(1_794_000_000_500), fetch: f });
  const u = new URL(urls[0]);
  assert.equal(`${u.origin}${u.pathname}`, "https://x402.t0ll.xyz/paid");
  assert.deepEqual(Object.fromEntries(u.searchParams), { payer: PAYER.replace("0x11", "0x1a"), payTo: PAY_TO, resource: URL_, since: "1794000000" });
  assert.deepEqual(r, answer);
});

test("paidBefore throws on bad input and when the facilitator cannot answer (charge as usual then)", async () => {
  const f = (async () => Response.json({ error: "The settlement record could not be read right now." }, { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(paidBefore({ payer: "0x12", payTo: PAY_TO, fetch: f }), /payer/);
  await assert.rejects(paidBefore({ payer: PAYER, payTo: "x", fetch: f }), /payTo/);
  await assert.rejects(paidBefore({ payer: PAYER, payTo: PAY_TO, since: 1.5, fetch: f }), /since/);
  await assert.rejects(paidBefore({ payer: PAYER, payTo: PAY_TO, resource: "ftp://x", fetch: f }), /resource/);
  await assert.rejects(paidBefore({ payer: PAYER, payTo: PAY_TO, fetch: f, facilitator: "https://fac.example/" }), /503/);
});
