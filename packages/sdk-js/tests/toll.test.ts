import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Toll, TollError, isValidAddress, isValidWallet, parsePaidUrl, parsePending } from "../src/index.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8");
const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const SOL = "So11111111111111111111111111111111111111112";

type Call = { url: string; init: RequestInit };
function mockFetch(responses: Array<string | Response | (() => Promise<Response>)>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more mock responses");
    if (typeof r === "function") return r();
    return typeof r === "string" ? new Response(r, { status: 200 }) : r;
  };
  return { f, calls };
}
const body = (c: Call) => JSON.parse(String(c.init.body));
const noSleep = () => { const slept: number[] = []; return { slept, sleep: async (ms: number) => { slept.push(ms); } }; };

test("address validators", () => {
  assert.ok(isValidAddress(TOKEN));
  assert.ok(isValidAddress(SOL));
  assert.ok(!isValidAddress("0x123"));
  assert.ok(!isValidAddress("0OIl" + "1".repeat(30)));
  assert.ok(!isValidAddress(`${TOKEN}\n`));
  assert.ok(isValidWallet(TOKEN));
  assert.ok(!isValidWallet(SOL));
});

test("tools() parses the real tools/list", async () => {
  const m = mockFetch([fx("tools_list")]);
  const tools = await new Toll({ fetch: m.f }).tools();
  assert.deepEqual(tools.map((t) => t.name), ["check_coin", "larp_check", "dev_record", "wallet_privacy", "fresh_launches", "chain_pulse", "launch_record"]);
  assert.equal(body(m.calls[0]).method, "tools/list");
  assert.equal(m.calls[0].url, "https://t0ll.xyz/mcp");
});

test("checkCoin sends the real argument names and parses the live answer", async () => {
  const m = mockFetch([fx("check_coin")]);
  const r = await new Toll({ fetch: m.f }).checkCoin(TOKEN, { chain: "rh" });
  assert.deepEqual(body(m.calls[0]).params, { name: "check_coin", arguments: { address: TOKEN, chain: "rh" } });
  assert.match(r.text, /^\$TOLL \(Toll\)/);
  assert.equal(r.paidUrl, null);
  assert.deepEqual(r.pending, { retryAfterS: 20 }); // "Still reading who holds it now: ask again in 20 s."
});

test("larpCheck uses token (not address) and parses a finished answer", async () => {
  const m = mockFetch([fx("larp_check")]);
  const r = await new Toll({ fetch: m.f }).larpCheck(TOKEN, { chain: "rh" });
  assert.deepEqual(body(m.calls[0]).params, { name: "larp_check", arguments: { token: TOKEN, chain: "rh" } });
  assert.match(r.text, /product found/);
  assert.equal(r.pending, null);
  assert.equal(r.paidUrl, null); // the finished answer names t0ll.xyz/api/x402/larp/... as a working part: not an upsell
});

test("chainPulse sends no arguments", async () => {
  const m = mockFetch([fx("chain_pulse")]);
  const r = await new Toll({ fetch: m.f }).chainPulse();
  assert.deepEqual(body(m.calls[0]).params, { name: "chain_pulse", arguments: {} });
  assert.match(r.text, /^Robinhood Chain, right now/);
});

test("over-quota text gives the paid URL", async () => {
  const m = mockFetch([fx("check_coin_over"), fx("larp_check_over")]);
  const t = new Toll({ fetch: m.f });
  assert.equal((await t.checkCoin(TOKEN, { chain: "rh" })).paidUrl, `https://t0ll.xyz/api/x402/check/${TOKEN}?chain=rh`);
  assert.equal((await t.larpCheck(TOKEN, { chain: "rh" })).paidUrl, `https://t0ll.xyz/api/x402/larp/${TOKEN}?chain=rh`);
});

test("parsePaidUrl ignores other hosts and trailing punctuation", () => {
  assert.equal(parsePaidUrl("paid check of this coin (x402): https://evil.example/api/x402/check/x"), null);
  assert.equal(parsePaidUrl("a mention of https://t0ll.xyz/api/x402/check/abc"), null);
  assert.equal(parsePaidUrl("paid check of this coin (x402): https://t0ll.xyz/api/x402/check/abc?chain=sol."), "https://t0ll.xyz/api/x402/check/abc?chain=sol");
});

test("pending is read from 'Still reading ... in about N seconds'", async () => {
  const m = mockFetch([fx("larp_check_reading")]);
  const r = await new Toll({ fetch: m.f }).larpCheck(TOKEN);
  assert.deepEqual(r.pending, { retryAfterS: 30 });
  assert.equal(parsePending("nothing here"), null);
});

test("larpCheck wait re-asks after the given seconds, max 3 tries", async () => {
  const s = noSleep();
  const m = mockFetch([fx("larp_check_reading"), fx("larp_check_reading"), fx("larp_check")]);
  const r = await new Toll({ fetch: m.f, sleep: s.sleep }).larpCheck(TOKEN, { wait: true });
  assert.equal(m.calls.length, 3);
  assert.deepEqual(s.slept, [30000, 30000]);
  assert.equal(r.pending, null);

  const s2 = noSleep();
  const m2 = mockFetch([fx("larp_check_reading"), fx("larp_check_reading"), fx("larp_check_reading"), fx("larp_check")]);
  const r2 = await new Toll({ fetch: m2.f, sleep: s2.sleep }).larpCheck(TOKEN, { wait: true });
  assert.equal(m2.calls.length, 3); // gives up after 3 tries
  assert.ok(r2.pending);
});

test("larpCheck wait stops before passing 120 s", async () => {
  const s = noSleep();
  const long = JSON.stringify({ result: { content: [{ type: "text", text: "Still reading x. Call larp_check again and try again in about 100 seconds." }] } });
  const m = mockFetch([long, long, long]);
  const r = await new Toll({ fetch: m.f, sleep: s.sleep }).larpCheck(TOKEN, { wait: true });
  assert.equal(m.calls.length, 2); // 100 s waited once, a second 100 s would pass 120
  assert.deepEqual(s.slept, [100000]);
  assert.ok(r.pending);
});

test("larpCheck wait treats the busy answer like pending, inside the same caps", async () => {
  const s = noSleep();
  const m = mockFetch([fx("larp_check_busy"), fx("larp_check_reading"), fx("larp_check")]);
  const r = await new Toll({ fetch: m.f, sleep: s.sleep }).larpCheck(TOKEN, { wait: true });
  assert.equal(m.calls.length, 3);
  assert.deepEqual(s.slept, [20000, 30000]);
  assert.match(r.text, /product found/);

  const s2 = noSleep();
  const m2 = mockFetch([fx("larp_check_busy"), fx("larp_check_busy"), fx("larp_check_busy"), fx("larp_check")]);
  await assert.rejects(
    new Toll({ fetch: m2.f, sleep: s2.sleep }).larpCheck(TOKEN, { wait: true }),
    (e: unknown) => e instanceof TollError && e.retryAfterS === 20,
  );
  assert.equal(m2.calls.length, 3); // still max 3 tries
  assert.deepEqual(s2.slept, [20000, 20000]);

  // An error without retryAfterS is not retried.
  const bad = JSON.stringify({ result: { content: [{ type: "text", text: "Not a token." }], isError: true } });
  const m3 = mockFetch([bad, fx("larp_check")]);
  await assert.rejects(new Toll({ fetch: m3.f, sleep: noSleep().sleep }).larpCheck(TOKEN, { wait: true }), /Not a token/);
  assert.equal(m3.calls.length, 1);
});

test("isError answers, JSON-RPC errors and HTTP errors become TollError", async () => {
  const busy = new Toll({ fetch: mockFetch([fx("larp_check_busy")]).f });
  await assert.rejects(busy.larpCheck(TOKEN), (e: unknown) => e instanceof TollError && /Many new LARP checks/.test(e.message) && e.retryAfterS === 20);

  const rpc = new Toll({ fetch: mockFetch([JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } })]).f });
  await assert.rejects(rpc.chainPulse(), (e: unknown) => e instanceof TollError && e.code === -32602 && /bad params/.test(e.message));

  const http = new Toll({ fetch: mockFetch([new Response("slow down", { status: 429 })]).f });
  await assert.rejects(http.chainPulse(), (e: unknown) => e instanceof TollError && e.status === 429 && /HTTP 429/.test(e.message));

  const junk = new Toll({ fetch: mockFetch(["<html>"]).f });
  await assert.rejects(junk.chainPulse(), TollError);
});

test("bad input never reaches the network", async () => {
  const m = mockFetch([]);
  const t = new Toll({ fetch: m.f });
  await assert.rejects(async () => t.checkCoin("not an address"), TollError);
  await assert.rejects(async () => t.checkCoin(TOKEN, { chain: "eth" as never }), TollError);
  await assert.rejects(async () => t.larpCheck(SOL + "!"), TollError);
  await assert.rejects(async () => t.devRecord(SOL), TollError);
  await assert.rejects(async () => t.walletPrivacy("0x1"), TollError);
  await assert.rejects(async () => t.freshLaunches(21), TollError);
  assert.equal(m.calls.length, 0);
});

test("timeout aborts the request", async () => {
  const f = (_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
  const t = new Toll({ fetch: f, timeoutMs: 20 });
  await assert.rejects(t.chainPulse(), (e: unknown) => e instanceof TollError && /timed out/.test(e.message));
});

test("accepts an SSE data frame", async () => {
  const frame = `event: message\ndata: ${fx("chain_pulse")}\n\n`;
  const r = await new Toll({ fetch: mockFetch([frame]).f }).chainPulse();
  assert.match(r.text, /right now/);
});

const PAID = `https://t0ll.xyz/api/x402/check/${TOKEN}?chain=rh`;
// A real unpaid 402 from Toll (captured once, no payment header sent): v2 PAYMENT-REQUIRED header + v1 body.
const REAL_402 = JSON.parse(fx("x402_required")) as { status: number; headers: Record<string, string>; body: string };
const required = (headers = REAL_402.headers) => new Response(REAL_402.body, { status: 402, headers });
const v1Only = () => new Response(REAL_402.body, { status: 402, headers: { "content-type": "application/json" } });
const pendingRes = (retryAfter?: string) =>
  new Response('{"pending":true}', { status: 402, headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } });
const hdr = (c: Call, name: string) => new Headers(c.init.headers).get(name);

function signer(value = "c2lnbmVkLXBheW1lbnQ=") {
  const seen: Array<{ version: number; accepts: unknown[]; url: string }> = [];
  const sign = async (req: { x402Version: 1 | 2; accepts: Array<Record<string, unknown>> }, url: string) => {
    seen.push({ version: req.x402Version, accepts: req.accepts, url });
    return value;
  };
  return { sign, seen };
}

test("pay needs sign and a Toll URL, before any request", async () => {
  const m = mockFetch([]);
  await assert.rejects(new Toll({ fetch: m.f }).pay(PAID), (e: unknown) => e instanceof TollError && /sign/.test(e.message));
  await assert.rejects(new Toll({ fetch: m.f, sign: signer().sign }).pay("https://evil.example/x"), TollError);
  assert.equal(m.calls.length, 0);
});

test("pay reads the real v2 402, signs ONCE, resends the same header through several pendings", async () => {
  const s = noSleep();
  const sg = signer();
  const m = mockFetch([
    required(),
    pendingRes("7"),
    pendingRes("0"), // clamped to 1 s
    pendingRes(), // no Retry-After: 5 s
    new Response('{"token":"x","charged":true}', { status: 200 }),
  ]);
  const out = await new Toll({ fetch: m.f, sign: sg.sign, sleep: s.sleep }).pay(PAID);
  assert.deepEqual(out, { token: "x", charged: true });

  assert.equal(sg.seen.length, 1); // one signature for the whole call
  assert.equal(sg.seen[0].version, 2);
  assert.equal(sg.seen[0].url, PAID);
  const a = sg.seen[0].accepts[0] as Record<string, unknown>;
  assert.equal(a.network, "eip155:4663");
  assert.equal(a.amount, "50000");
  assert.equal(a.asset, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

  assert.equal(m.calls.length, 5);
  assert.equal(hdr(m.calls[0], "payment-signature"), null); // the first GET carries no payment
  assert.equal(hdr(m.calls[0], "x-payment"), null);
  for (const c of m.calls.slice(1)) {
    assert.equal(c.url, PAID);
    assert.equal(hdr(c, "payment-signature"), "c2lnbmVkLXBheW1lbnQ=");
    assert.equal(hdr(c, "x-payment"), null);
  }
  assert.deepEqual(s.slept, [7000, 1000, 5000]);
});

test("pay follows a v1-only 402 with X-PAYMENT", async () => {
  const sg = signer("djEtcGF5bWVudA==");
  const m = mockFetch([v1Only(), new Response('{"ok":1}', { status: 200 })]);
  assert.deepEqual(await new Toll({ fetch: m.f, sign: sg.sign }).pay(PAID), { ok: 1 });
  assert.equal(sg.seen[0].version, 1);
  assert.equal((sg.seen[0].accepts[0] as Record<string, unknown>).maxAmountRequired, "50000");
  assert.equal(hdr(m.calls[1], "x-payment"), "djEtcGF5bWVudA==");
  assert.equal(hdr(m.calls[1], "payment-signature"), null);
});

test("pay stops after 5 pending tries, never signs again", async () => {
  const s = noSleep();
  const sg = signer();
  const m = mockFetch([required(), pendingRes("5"), pendingRes("5"), pendingRes("5"), pendingRes("5"), pendingRes("5"), pendingRes("5")]);
  await assert.rejects(
    new Toll({ fetch: m.f, sign: sg.sign, sleep: s.sleep }).pay(PAID),
    (e: unknown) => e instanceof TollError && e.status === 402 && /same payment header/.test(e.message),
  );
  assert.equal(m.calls.length, 6); // 1 unpaid + 5 paid
  assert.equal(sg.seen.length, 1);
  assert.deepEqual(s.slept, [5000, 5000, 5000, 5000]);
});

test("pay stops before 300 s of waiting", async () => {
  const s = noSleep();
  const sg = signer();
  const m = mockFetch([required(), pendingRes("200"), pendingRes("200")]);
  await assert.rejects(new Toll({ fetch: m.f, sign: sg.sign, sleep: s.sleep }).pay(PAID), TollError);
  assert.deepEqual(s.slept, [200000]);
  assert.equal(sg.seen.length, 1);
});

test("any other 402 after paying is 'payment not accepted', no second signature", async () => {
  const sg = signer();
  const m = mockFetch([required(), pendingRes("3"), required()]);
  await assert.rejects(
    new Toll({ fetch: m.f, sign: sg.sign, sleep: noSleep().sleep }).pay(PAID),
    (e: unknown) => e instanceof TollError && e.status === 402 && /payment not accepted/.test(e.message),
  );
  assert.equal(sg.seen.length, 1);
  assert.equal(m.calls.length, 3);
});

test("a 402 without requirements, or a failing sign(), sends no payment", async () => {
  const sg = signer();
  const m = mockFetch([new Response("{}", { status: 402 })]);
  await assert.rejects(new Toll({ fetch: m.f, sign: sg.sign }).pay(PAID), /without x402 payment requirements/);
  assert.equal(sg.seen.length, 0);

  const m2 = mockFetch([required()]);
  const bad = async () => {
    throw new Error("no funds");
  };
  await assert.rejects(new Toll({ fetch: m2.f, sign: bad }).pay(PAID), /sign\(\) failed, nothing was sent: no funds/);
  assert.equal(m2.calls.length, 1);

  const m3 = mockFetch([required()]);
  await assert.rejects(new Toll({ fetch: m3.f, sign: async () => "a\r\nb" }).pay(PAID), /one non-empty line/);
  assert.equal(m3.calls.length, 1);
});

test("pay has its own timeout and warns not to sign again", async () => {
  const sg = signer();
  const hang = (_u: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
  const m = mockFetch([required(), () => hang("", m.calls[m.calls.length - 1].init)]);
  await assert.rejects(
    new Toll({ fetch: m.f, sign: sg.sign, timeoutMs: 5, payTimeoutMs: 40 }).pay(PAID),
    (e: unknown) => e instanceof TollError && /timed out after/.test(e.message) && /may have settled/.test(e.message) && /new signature/.test(e.message),
  );
  assert.equal(sg.seen.length, 1);
});

test("pay passes an unpaid 200 straight through without signing", async () => {
  const sg = signer();
  const m = mockFetch([new Response('{"free":true}', { status: 200 })]);
  assert.deepEqual(await new Toll({ fetch: m.f, sign: sg.sign }).pay(PAID), { free: true });
  assert.equal(sg.seen.length, 0);
});

test("the request timer covers reading the body", async () => {
  const f = async (_u: string, init?: RequestInit) => {
    const body = new ReadableStream({
      start(ctl) {
        init?.signal?.addEventListener("abort", () => ctl.error(new Error("aborted")));
      },
    });
    return new Response(body, { status: 200 });
  };
  await assert.rejects(new Toll({ fetch: f, timeoutMs: 20 }).chainPulse(), (e: unknown) => e instanceof TollError && /timed out/.test(e.message));
});

test("Retry-After style waits are at least 1 s", () => {
  assert.deepEqual(parsePending("try again in 0 s"), { retryAfterS: 1 });
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const r = await new Toll().chainPulse();
  assert.match(r.text, /Robinhood Chain/);
});
