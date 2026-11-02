import { test } from "node:test";
import assert from "node:assert/strict";
import { createTollPlugin, extractStockId, tollPlugin, MARKETS_NOTE } from "../src/index.js";

const NVDA = { ticker: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", quota: { used: 1, limit: 50, left: 49, tier: "free" } };
const LIST = { count: 203, tokens: [{ ticker: "NVDA" }], quota: { used: 2, limit: 50, left: 48, tier: "free" } };
const OVER = { error: "50 Markets calls used today (free).", quota: { used: 50, limit: 50, left: 0, tier: "free" }, x402: "https://t0ll.xyz/api/x402/stock/{ticker}" };
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
const msg = (text: string): any => ({ entityId: "e", roomId: "r", content: { text } });
const act = (p: any, name: string) => p.actions.find((a: any) => a.name === name);

function setup(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>, tollKey?: string) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
  return { p: createTollPlugin({ fetch: f, ...(tollKey ? { tollKey } : {}) }), calls };
}

test("stock actions: descriptions say facts not advice, debt securities not shares", () => {
  for (const n of ["TOLL_STOCK_TOKEN", "TOLL_STOCK_TOKENS"]) {
    const d = act(tollPlugin, n).description as string;
    assert.ok(d.includes(MARKETS_NOTE));
    assert.match(d, /debt securities issued by Robinhood Assets \(Jersey\) Ltd, not shares/);
    assert.ok(!/\b(buy|sell|trade)\b/i.test(d));
  }
});

test("stock id extraction: contract, cashtag, standalone ticker", () => {
  assert.equal(extractStockId(`stock token ${NVDA.address}`), NVDA.address);
  assert.equal(extractStockId("what does the $nvda stock token read"), "NVDA");
  assert.equal(extractStockId("I want the NVDA stock token, in USD"), "NVDA");
  assert.equal(extractStockId("BRK.B stock"), "BRK.B");
  assert.equal(extractStockId("what is a stock token?"), null);
  assert.equal(extractStockId("I want the RH USD stock list"), null);
});

test("validate: TOLL_STOCK_TOKEN needs the word stock and a ticker", async () => {
  const a = act(tollPlugin, "TOLL_STOCK_TOKEN");
  assert.equal(await a.validate({}, msg("NVDA stock token")), true);
  assert.equal(await a.validate({}, msg("check NVDA")), false);
  assert.equal(await a.validate({}, msg("what is a stock token")), false);
  const l = act(tollPlugin, "TOLL_STOCK_TOKENS");
  assert.equal(await l.validate({}, msg("list the robinhood stock tokens")), true);
  assert.equal(await l.validate({}, msg("gm")), false);
});

test("TOLL_STOCK_TOKEN GETs /api/markets/stock/{id} and answers with the JSON", async () => {
  const { p, calls } = setup([{ body: NVDA }]);
  const got: any[] = [];
  const res = await act(p, "TOLL_STOCK_TOKEN").handler({}, msg("what does the $NVDA stock token read?"), undefined, {}, async (c: any) => {
    got.push(c);
    return [];
  });
  assert.equal(res.success, true);
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/stock/NVDA");
  assert.equal(calls[0].headers.get("x-toll-pass"), null);
  assert.deepEqual(JSON.parse(got[0].text), NVDA);
  assert.deepEqual(got[0].actions, ["TOLL_STOCK_TOKEN"]);
});

test("Toll key as x-toll-pass; over quota points to the x402 stock URL", async () => {
  const { p, calls } = setup([{ status: 429, body: OVER, headers: { "retry-after": "3600" } }], "tk_123");
  const res = await act(p, "TOLL_STOCK_TOKEN").handler({}, msg("NVDA stock token"));
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_123");
  assert.match(res.text, /https:\/\/t0ll\.xyz\/api\/x402\/stock\/NVDA \(0\.02 USDG on Robinhood Chain/);
  assert.match(res.text, /Markets calls a day 50 \/ 1,000 \/ 5,000 \/ 20,000/);
});

test("the TOLL_KEY setting is used when no tollKey is given", async () => {
  const { p, calls } = setup([{ body: NVDA }, { body: ok("rec") }]);
  const rt: any = { getSetting: (k: string) => (k === "TOLL_KEY" ? "tk_setting" : undefined) };
  await act(p, "TOLL_STOCK_TOKEN").handler(rt, msg("NVDA stock"));
  await act(p, "TOLL_DEV_RECORD").handler(rt, msg(`dev ${NVDA.address}`));
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_setting");
  assert.equal(calls[1].url, "https://t0ll.xyz/mcp");
  assert.equal(calls[1].headers.get("x-toll-pass"), "tk_setting");
});

test("TOLL_STOCK_TOKENS: quoted query and top N, default 20", async () => {
  const { p, calls } = setup([{ body: LIST }, { body: LIST }]);
  const res = await act(p, "TOLL_STOCK_TOKENS").handler({}, msg('list the top 3 stock tokens matching "nvid"'));
  assert.equal(res.success, true);
  assert.deepEqual(JSON.parse(res.text), LIST);
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/stocks?q=nvid&limit=3");
  await act(p, "TOLL_STOCK_TOKENS").handler({}, msg("what's on robinhood's stock tokens list"));
  assert.equal(calls[1].url, "https://t0ll.xyz/api/markets/stocks?limit=20");
});

test("TOLL_STOCK_TOKEN without a ticker says so and sends nothing", async () => {
  const { p, calls } = setup([]);
  const res = await act(p, "TOLL_STOCK_TOKEN").handler({}, msg("tell me about a stock token"));
  assert.equal(res.success, false);
  assert.match(res.text, /No Stock Token in the message/);
  assert.equal(calls.length, 0);
});
