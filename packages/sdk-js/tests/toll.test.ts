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

test("pay needs payFetch and a Toll URL", async () => {
  await assert.rejects(new Toll().pay(PAID), /payFetch/);
  await assert.rejects(new Toll({ payFetch: mockFetch([]).f }).pay("https://evil.example/x"), TollError);
});

test("pay returns the JSON and handles 402 pending with Retry-After", async () => {
  const s = noSleep();
  const pf = mockFetch([
    new Response('{"pending":true}', { status: 402, headers: { "retry-after": "7" } }),
    new Response('{"token":"x","charged":true}', { status: 200 }),
  ]);
  const out = await new Toll({ payFetch: pf.f, sleep: s.sleep }).pay(PAID);
  assert.deepEqual(out, { token: "x", charged: true });
  assert.deepEqual(s.slept, [7000]);
  assert.equal(pf.calls.length, 2);
});

test("pay gives up after 3 pending tries and reports a plain 402", async () => {
  const s = noSleep();
  const pend = () => new Response('{"pending":true}', { status: 402, headers: { "retry-after": "5" } });
  const pf = mockFetch([pend(), pend(), pend()]);
  await assert.rejects(new Toll({ payFetch: pf.f, sleep: s.sleep }).pay(PAID), (e: unknown) => e instanceof TollError && e.status === 402);
  assert.equal(pf.calls.length, 3);

  const pf2 = mockFetch([new Response("{}", { status: 402 })]);
  await assert.rejects(new Toll({ payFetch: pf2.f }).pay(PAID), /Payment required/);
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const r = await new Toll().chainPulse();
  assert.match(r.text, /Robinhood Chain/);
});
