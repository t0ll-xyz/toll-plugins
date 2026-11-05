import { test } from "node:test";
import assert from "node:assert/strict";
import { toll, MARKETS_NOTE } from "../src/index.js";

const NVDA = { ticker: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", quota: { used: 1, limit: 50, left: 49, tier: "free" } };
const LIST = { count: 203, tokens: [{ ticker: "NVDA" }], quota: { used: 2, limit: 50, left: 48, tier: "free" } };
const OVER = { error: "50 Markets calls used today (free).", quota: { used: 50, limit: 50, left: 0, tier: "free" }, x402: "https://t0ll.xyz/api/x402/stock/{ticker}" };
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });

async function setup(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>, tollKey?: string) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
  const tools = await toll({ fetch: f, ...(tollKey ? { tollKey } : {}) }).getTools({} as any);
  const get = (n: string) => tools.find((t) => t.name === n)!;
  return { get, calls };
}

test("stock tools: descriptions say facts not advice, debt securities not shares", async () => {
  const { get } = await setup([]);
  for (const n of ["stock_token", "stock_tokens"]) {
    const d = get(n).description;
    assert.ok(d.includes(MARKETS_NOTE));
    assert.match(d, /debt securities issued by Robinhood Assets \(Jersey\) Ltd, not shares/);
    assert.ok(!/\b(buy|sell|trade)\b/i.test(d));
  }
});

test("stock_token GETs /api/markets/stock/{id} and returns the JSON", async () => {
  const { get, calls } = await setup([{ body: NVDA }]);
  const out = String(await get("stock_token").execute({ id: "NVDA" }));
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/stock/NVDA");
  assert.equal(calls[0].headers.get("x-toll-pass"), null);
  assert.deepEqual(JSON.parse(out), NVDA);
});

test("stock_token sends the Toll key as x-toll-pass; over quota points to x402", async () => {
  const { get, calls } = await setup([{ status: 429, body: OVER, headers: { "retry-after": "3600" } }], "tk_123");
  const out = String(await get("stock_token").execute({ id: "NVDA" }));
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_123");
  assert.match(out, /https:\/\/t0ll\.xyz\/api\/x402\/stock\/NVDA \(0\.02 USDG on Robinhood Chain/);
  assert.match(out, /Markets calls a day 50 \/ 1,000 \/ 5,000 \/ 20,000/);
});

test("stock_tokens sends q and limit; schema keeps limit in 1..250", async () => {
  const { get, calls } = await setup([{ body: LIST }]);
  assert.deepEqual(JSON.parse(String(await get("stock_tokens").execute({ query: "nvid", limit: 3 }))), LIST);
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/stocks?q=nvid&limit=3");
  const s = get("stock_tokens").parameters;
  assert.ok(!s.safeParse({ limit: 251 }).success);
  assert.ok(s.safeParse({ limit: 250 }).success);
  assert.ok(!get("stock_token").parameters.safeParse({}).success);
});

test("tollKey also goes on the coin checks (MCP)", async () => {
  const { get, calls } = await setup([{ body: ok("rec") }], "tk_9");
  assert.equal(await get("dev_record").execute({ wallet: NVDA.address }), "rec");
  assert.equal(calls[0].url, "https://t0ll.xyz/mcp");
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_9");
});

test("Markets calls send the stable install id as x-toll-client (with and without a key)", async () => {
  const a = await setup([{ body: NVDA }]);
  await a.get("stock_token").execute({ id: "NVDA" });
  const b = await setup([{ body: NVDA }], "tk_1");
  await b.get("stock_token").execute({ id: "NVDA" });
  const id = a.calls[0].headers.get("x-toll-client")!;
  assert.match(id, /^[A-Za-z0-9_-]{22,64}$/);
  assert.equal(b.calls[0].headers.get("x-toll-client"), id);
});
