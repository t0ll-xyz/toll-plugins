import { test, before } from "node:test";
import assert from "node:assert/strict";
import { TollActionProvider, tollActionProvider, MARKETS_NOTE } from "../src/index.js";

// AgentKit's decorator fires its own analytics fetch on every call; keep unit tests offline.
before(() => {
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
});

const NVDA = { ticker: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", quota: { used: 1, limit: 50, left: 49, tier: "free" } };
const LIST = { count: 203, tokens: [{ ticker: "NVDA" }], quota: { used: 2, limit: 50, left: 48, tier: "free" } };
const OVER = { error: "50 Markets calls used today (free).", quota: { used: 50, limit: 50, left: 0, tier: "free" }, x402: "https://t0ll.xyz/api/x402/stock/{ticker}" };
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });

type Call = { url: string; headers: Headers };
function provider(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>, tollKey?: string) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
  return { p: tollActionProvider({ fetch: f, ...(tollKey ? { tollKey } : {}) }), calls };
}
const getAction = (p: TollActionProvider, suffix: string) => p.getActions({} as any).find((a) => a.name.endsWith(suffix))!;

test("stock actions: descriptions say facts not advice, debt securities not shares", () => {
  const p = new TollActionProvider();
  for (const n of ["stock_token", "stock_tokens"]) {
    const d = getAction(p, n).description;
    assert.ok(d.includes(MARKETS_NOTE));
    assert.match(d, /debt securities issued by Robinhood Assets \(Jersey\) Ltd, not shares/);
    assert.ok(!/\b(buy|sell|trade)\b/i.test(d));
  }
});

test("stock_token GETs /api/markets/stock/{id} and returns the JSON", async () => {
  const { p, calls } = provider([{ body: NVDA }]);
  const out = await getAction(p, "stock_token").invoke({ id: "$NVDA" });
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/stock/NVDA");
  assert.equal(calls[0].headers.get("x-toll-pass"), null);
  assert.deepEqual(JSON.parse(out), NVDA);
});

test("stock_token sends the Toll key as x-toll-pass", async () => {
  const { p, calls } = provider([{ body: NVDA }], "tk_123");
  await getAction(p, "stock_token").invoke({ id: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" });
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/stock/0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_123");
});

test("stock_token over the daily Markets quota points to the x402 stock URL and the tiers", async () => {
  const { p } = provider([{ status: 429, body: OVER, headers: { "retry-after": "3600" } }]);
  const out = await getAction(p, "stock_token").invoke({ id: "NVDA" });
  assert.match(out, /50 Markets calls used today \(free; resets 00:00 UTC\)/);
  assert.match(out, /https:\/\/t0ll\.xyz\/api\/x402\/stock\/NVDA \(0\.02 USDG on Robinhood Chain/);
  assert.match(out, /Markets calls a day 50 \/ 1,000 \/ 5,000 \/ 20,000/);
  assert.match(out, /https:\/\/t0ll\.xyz\/toll#keys/);
});

test("stock_token: burst 429, 404 and bad ids come back as text", async () => {
  const { p, calls } = provider([
    { status: 429, body: { error: "Too many requests: 30 a minute." }, headers: { "retry-after": "60" } },
    { status: 404, body: { error: "ZZZZQ is not one of the Stock Tokens Robinhood lists on Robinhood Chain." } },
  ]);
  assert.match(await getAction(p, "stock_token").invoke({ id: "NVDA" }), /ask again in 60 seconds/);
  assert.match(await getAction(p, "stock_token").invoke({ id: "ZZZZQ" }), /^Toll could not answer: ZZZZQ is not one/);
  assert.match(await getAction(p, "stock_token").invoke({ id: "not a ticker!" }), /Not a ticker/);
  assert.equal(calls.length, 2);
});

test("stock_tokens sends q and limit; schema keeps limit in 1..250", async () => {
  const { p, calls } = provider([{ body: LIST }, { body: LIST }]);
  const a = getAction(p, "stock_tokens");
  assert.deepEqual(JSON.parse(await a.invoke({ query: "nvid", limit: 3 })), LIST);
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/stocks?q=nvid&limit=3");
  await a.invoke({});
  assert.equal(calls[1].url, "https://t0ll.xyz/api/markets/stocks");
  assert.ok(!a.schema.safeParse({ limit: 251 }).success);
  assert.ok(!a.schema.safeParse({ limit: 0 }).success);
  assert.ok(a.schema.safeParse({ limit: 250 }).success);
});

test("tollKey also goes on the coin checks (MCP)", async () => {
  const { p, calls } = provider([{ body: ok("pulse") }], "tk_9");
  assert.equal(await getAction(p, "chain_pulse").invoke({}), "pulse");
  assert.equal(calls[0].url, "https://t0ll.xyz/mcp");
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_9");
  assert.equal(calls[0].headers.get("content-type"), "application/json");
});

test("Markets calls send the stable install id as x-toll-client (with and without a key)", async () => {
  const a = provider([{ body: NVDA }]);
  await getAction(a.p, "stock_token").invoke({ id: "NVDA" });
  const b = provider([{ body: NVDA }], "tk_1");
  await getAction(b.p, "stock_token").invoke({ id: "NVDA" });
  const id = a.calls[0].headers.get("x-toll-client")!;
  assert.match(id, /^[A-Za-z0-9_-]{22,64}$/);
  assert.equal(b.calls[0].headers.get("x-toll-client"), id);
});
