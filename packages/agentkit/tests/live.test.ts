import { test, before } from "node:test";
import assert from "node:assert/strict";
import { TollActionProvider, tollActionProvider, LIVE_DESCRIPTIONS, MARKETS_NOTE, paidMarketsUrl } from "../src/index.js";

// AgentKit's decorator fires its own analytics fetch on every call; keep unit tests offline.
before(() => {
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
});

const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
type Call = { url: string; headers: Headers; body: any };
function provider(responses: Array<{ status?: number; body: unknown }>, tollKey?: string) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { p: tollActionProvider({ fetch: f, ...(tollKey ? { tollKey } : {}) }), calls };
}
const getAction = (p: TollActionProvider, name: string) => p.getActions({} as any).find((a) => a.name === `TollActionProvider_${name}`)!;

test("the new tools carry the live descriptions", () => {
  const p = new TollActionProvider();
  for (const n of ["wallet_privacy", "check_agent", "check_tx", "presign_risk_report"] as const) {
    assert.equal(getAction(p, n).description, LIVE_DESCRIPTIONS[n]);
  }
  for (const n of ["institutions", "guidance", "stock_events"] as const) {
    assert.ok(getAction(p, n).description.startsWith(LIVE_DESCRIPTIONS[n]));
    assert.ok(getAction(p, n).description.includes(MARKETS_NOTE));
  }
});

test("schemas follow the live shapes", () => {
  const p = new TollActionProvider();
  assert.ok(getAction(p, "check_agent").schema.safeParse({ id: 20030 }).success);
  assert.ok(getAction(p, "check_agent").schema.safeParse({ id: "20030" }).success);
  assert.ok(!getAction(p, "check_agent").schema.safeParse({ id: "x" }).success);
  assert.ok(getAction(p, "check_tx").schema.safeParse({ to: TOKEN, data: "0x", value: "0", from: TOKEN }).success);
  assert.ok(getAction(p, "check_tx").schema.safeParse({ x402: { accepts: [] }, agentId: 20030, strict: true }).success);
  assert.ok(getAction(p, "presign_risk_report").schema.safeParse({ version: "erc-presign/1", subject: { type: "calls" } }).success);
  assert.ok(!getAction(p, "presign_risk_report").schema.safeParse({ version: "erc-presign/2", subject: {} }).success);
  assert.ok(getAction(p, "institutions").schema.safeParse({ id: "NVDA", limit: 20 }).success);
  assert.ok(!getAction(p, "institutions").schema.safeParse({ id: "NVDA", limit: 21 }).success);
  assert.ok(!getAction(p, "guidance").schema.safeParse({ id: "NVDA", limit: 61 }).success);
  assert.ok(getAction(p, "stock_events").schema.safeParse({ since: 5, kind: "filing", limit: 100 }).success);
  assert.ok(!getAction(p, "stock_events").schema.safeParse({ kind: "ipo" }).success);
});

test("wallet_privacy, check_agent, check_tx, presign_risk_report and stock_events call the MCP tools with the key", async () => {
  const { p, calls } = provider(["a", "b", "c", "d", "e"].map((t) => ({ body: ok(t) })), "tk_9");
  const tx = { to: TOKEN, data: "0x", value: "0", from: TOKEN };
  const presign = { version: "erc-presign/1" as const, subject: { type: "calls", chainId: "eip155:4663", calls: [] } };
  assert.equal(await getAction(p, "wallet_privacy").invoke({ wallet: TOKEN }), "a");
  assert.equal(await getAction(p, "check_agent").invoke({ id: 20030 }), "b");
  assert.equal(await getAction(p, "check_tx").invoke(tx), "c");
  assert.equal(await getAction(p, "presign_risk_report").invoke(presign), "d");
  assert.equal(await getAction(p, "stock_events").invoke({ kind: "filing" }), "e");
  assert.deepEqual(
    calls.map((c) => [c.url, c.body.params.name, c.body.params.arguments]),
    [
      ["https://t0ll.xyz/mcp", "wallet_privacy", { wallet: TOKEN }],
      ["https://t0ll.xyz/mcp", "check_agent", { id: 20030 }],
      ["https://t0ll.xyz/mcp", "check_tx", tx],
      ["https://t0ll.xyz/mcp", "presign_risk_report", presign],
      ["https://t0ll.xyz/mcp", "stock_events", { kind: "filing" }],
    ],
  );
  for (const c of calls) assert.equal(c.headers.get("x-toll-pass"), "tk_9");
});

test("institutions and guidance GET their Markets routes; over quota each points to its x402 URL", async () => {
  const OVER = { error: "50 Markets calls used today (free).", quota: { used: 50, limit: 50, left: 0, tier: "free" } };
  const { p, calls } = provider([{ body: { ticker: "NVDA" } }, { body: { ticker: "NVDA" } }, { status: 429, body: OVER }, { status: 429, body: OVER }], "tk_2");
  assert.deepEqual(JSON.parse(await getAction(p, "institutions").invoke({ id: "$NVDA", limit: 3 })), { ticker: "NVDA" });
  assert.deepEqual(JSON.parse(await getAction(p, "guidance").invoke({ id: "NVDA" })), { ticker: "NVDA" });
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/institutions/NVDA?limit=3");
  assert.equal(calls[1].url, "https://t0ll.xyz/api/markets/guidance/NVDA");
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_2");
  const i = await getAction(p, "institutions").invoke({ id: "NVDA" });
  const g = await getAction(p, "guidance").invoke({ id: "NVDA" });
  assert.ok(i.includes(paidMarketsUrl("institutions", "NVDA")) && i.includes("0.01 USDG on Robinhood Chain"));
  assert.ok(g.includes("https://t0ll.xyz/api/x402/markets/guidance/NVDA"));
});

test("check_tx on another chain is answered as text, never sent", async () => {
  const { p, calls } = provider([]);
  const out = await getAction(p, "check_tx").invoke({ to: TOKEN, chainId: 56 });
  assert.match(out, /Robinhood Chain only/);
  assert.equal(calls.length, 0);
});

const HOOK = "0x4eb1976978756bd56802d8162f2271844924e0cc";
test("check_hook (11-05): the live description, calls the MCP tool with the key", async () => {
  const { p, calls } = provider([{ body: ok("h") }], "tk_9");
  assert.equal(getAction(p, "check_hook").description, LIVE_DESCRIPTIONS.check_hook);
  assert.equal(await getAction(p, "check_hook").invoke({ address: HOOK }), "h");
  assert.deepEqual(calls.map((c) => [c.body.params.name, c.body.params.arguments]), [["check_hook", { address: HOOK }]]);
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_9");
});

test("find_paid_api (0.5.0): the live description, calls the MCP tool with query and limit", async () => {
  const { p, calls } = provider([{ body: ok("f") }, { body: ok("g") }]);
  assert.equal(getAction(p, "find_paid_api").description, LIVE_DESCRIPTIONS.find_paid_api);
  assert.equal(await getAction(p, "find_paid_api").invoke({ query: "stock quotes", limit: 3 }), "f");
  assert.equal(await getAction(p, "find_paid_api").invoke({}), "g");
  assert.deepEqual(calls.map((c) => [c.body.params.name, c.body.params.arguments]), [["find_paid_api", { query: "stock quotes", limit: 3 }], ["find_paid_api", {}]]);
});

const WALLET = "0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc";
const HOOK_URL = "https://example.com/toll-hook";
test("0.4.0: wallet_approvals, watches and check_tx ticket carry the live descriptions and call the MCP tools with the key", async () => {
  const p0 = new TollActionProvider();
  for (const n of ["wallet_approvals", "watch_coin", "my_watches", "unwatch_coin", "watch_wallet", "unwatch_wallet"] as const) {
    assert.equal(getAction(p0, n).description, LIVE_DESCRIPTIONS[n]);
  }
  assert.ok(getAction(p0, "check_tx").schema.safeParse({ to: TOKEN, from: TOKEN, ticket: true }).success);
  assert.ok(getAction(p0, "check_tx").schema.safeParse({ to: TOKEN, from: TOKEN, ticket: { scope: "v4swap" } }).success);
  assert.ok(!getAction(p0, "check_tx").schema.safeParse({ to: TOKEN, ticket: { scope: "any" } }).success);
  assert.ok(!getAction(p0, "watch_wallet").schema.safeParse({ address: WALLET }).success);
  const watch = JSON.stringify({ id: "w1", secret: "s1" });
  const { p, calls } = provider(["a", watch, "[]", "{}", watch, "{}", "t"].map((t) => ({ body: ok(t) })), "tk_9");
  assert.equal(await getAction(p, "wallet_approvals").invoke({ wallet: WALLET }), "a");
  assert.equal(await getAction(p, "watch_coin").invoke({ address: TOKEN, url: HOOK_URL }), watch);
  assert.equal(await getAction(p, "my_watches").invoke({}), "[]");
  assert.equal(await getAction(p, "unwatch_coin").invoke({ id: "w1" }), "{}");
  assert.equal(await getAction(p, "watch_wallet").invoke({ address: WALLET, url: HOOK_URL }), watch);
  assert.equal(await getAction(p, "unwatch_wallet").invoke({ id: "w2" }), "{}");
  assert.equal(await getAction(p, "check_tx").invoke({ to: TOKEN, data: "0x", value: "0", from: TOKEN, ticket: true }), "t");
  assert.deepEqual(
    calls.map((c) => [c.body.params.name, c.body.params.arguments]),
    [
      ["wallet_approvals", { wallet: WALLET }],
      ["watch_coin", { address: TOKEN, url: HOOK_URL }],
      ["my_watches", {}],
      ["unwatch_coin", { id: "w1" }],
      ["watch_wallet", { address: WALLET, url: HOOK_URL }],
      ["unwatch_wallet", { id: "w2" }],
      ["check_tx", { to: TOKEN, data: "0x", value: "0", from: TOKEN, ticket: {} }],
    ],
  );
  for (const c of calls) assert.equal(c.headers.get("x-toll-pass"), "tk_9");
});

test("0.4.0: a watch without a Toll key is answered as text, never sent", async () => {
  const { p, calls } = provider([]);
  const out = await getAction(p, "watch_wallet").invoke({ address: WALLET, url: HOOK_URL });
  assert.match(out, /needs a Toll key/);
  assert.equal(calls.length, 0);
});
