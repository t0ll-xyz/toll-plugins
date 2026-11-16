import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_TX_BUDGET_MAX_MS, Toll, TollError, checkTxText, clampBudgetMs } from "../src/index.js";

const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const FROM = "0x000000000000000000000000000000000000dEaD";
type Call = { url: string; init: RequestInit };
function mockFetch(responses: Response[]) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift();
    if (!r) throw new Error("no more mock responses");
    return r;
  };
  return { f, calls };
}
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
const mcp = (text: string) => json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
const body = (c: Call) => JSON.parse(String(c.init.body));
const WARN_NOT_READ = {
  action: "WARN",
  warnings: [{ code: "coin-not-read", severity: "medium", message: "The coin this swap buys is still being read." }],
  "x-toll": { retry_after_s: 4 },
};

test("clampBudgetMs moves a number to the nearest end and drops anything else", () => {
  assert.equal(clampBudgetMs(100, 300, 30000), 300);
  assert.equal(clampBudgetMs(99999, 300, 30000), 30000);
  assert.equal(clampBudgetMs(1100.4, 300, 30000), 1100);
  assert.equal(clampBudgetMs("1100", 300, 30000), undefined);
  assert.equal(clampBudgetMs(Number.NaN, 300, 30000), undefined);
});

test("checkTx without a budget still goes over MCP (unchanged)", async () => {
  const m = mockFetch([mcp('WARN: read the warnings before signing.\n\nRiskAssessment (ERC-8265):\n{"action":"WARN","warnings":[]}')]);
  const r = await new Toll({ fetch: m.f }).checkTx({ to: TOKEN, data: "0x", from: FROM });
  assert.match(m.calls[0].url, /\/mcp$/);
  assert.equal(body(m.calls[0]).params.name, "check_tx");
  assert.equal(r.action, "WARN");
});

test("checkTx with budgetMs posts to /api/tx/check with budgetMs, and a coin not read is WARN with pending, never ALLOW", async () => {
  const m = mockFetch([json(WARN_NOT_READ, 200, { "retry-after": "4" })]);
  const r = await new Toll({ fetch: m.f, tollKey: "k_test" }).checkTx({ to: TOKEN, data: "0x", from: FROM, ticket: true }, { budgetMs: 1100 });
  assert.match(m.calls[0].url, /\/api\/tx\/check$/);
  const b = body(m.calls[0]);
  assert.equal(b.budgetMs, 1100);
  assert.deepEqual(b.ticket, {});
  assert.equal(b.to, TOKEN);
  const h = m.calls[0].init.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer k_test");
  assert.equal(r.action, "WARN");
  assert.deepEqual(r.pending, { retryAfterS: 4 });
  assert.match(r.text, /^WARN: read the warnings before signing\./);
  assert.match(r.text, /\(coin-not-read\)/);
  assert.match(r.text, /call check_tx again in 4 s/);
  assert.equal(r.assessment?.action, "WARN");
});

test("checkTx budget is clamped to 300..30000 before it is sent", async () => {
  const m = mockFetch([json({ action: "ALLOW", warnings: [] }), json({ action: "BLOCK", warnings: [{ code: "x", severity: "high", message: "m" }] })]);
  const t = new Toll({ fetch: m.f });
  const a = await t.checkTx({ to: TOKEN, data: "0x", from: FROM }, { budgetMs: 10 });
  const b = await t.checkTx({ to: TOKEN, data: "0x", from: FROM }, { budgetMs: 1e9 });
  assert.equal(body(m.calls[0]).budgetMs, 300);
  assert.equal(body(m.calls[1]).budgetMs, CHECK_TX_BUDGET_MAX_MS);
  assert.equal(a.action, "ALLOW");
  assert.match(a.text, /not a promise/);
  assert.equal(b.action, "BLOCK");
  assert.match(b.text, /^BLOCK: do not sign/);
});

test("checkTx budgeted: 429, 400 and an answer that is not a RiskAssessment throw TollError (never a clear answer)", async () => {
  const m = mockFetch([json({ error: "Too many checks" }, 429, { "retry-after": "60" }), json({ error: "bad body" }, 400), json({ ok: true })]);
  const t = new Toll({ fetch: m.f });
  await assert.rejects(t.checkTx({ to: TOKEN, data: "0x" }, { budgetMs: 1100 }), (e: unknown) => e instanceof TollError && e.status === 429 && e.retryAfterS === 60);
  await assert.rejects(t.checkTx({ to: TOKEN, data: "0x" }, { budgetMs: 1100 }), (e: unknown) => e instanceof TollError && /bad body/.test(e.message));
  await assert.rejects(t.checkTx({ to: TOKEN, data: "0x" }, { budgetMs: 1100 }), TollError);
});

test("preBuyCheck with budgetMs sends budget_ms (clamped to 300..25000) over MCP and reads WAIT", async () => {
  const m = mockFetch([mcp("Decision: WAIT\nPart of the coin is still being read: ask again in 6 s."), mcp("Decision: ALLOW\n- nothing against")]);
  const t = new Toll({ fetch: m.f });
  const w = await t.preBuyCheck(TOKEN, { budgetMs: 1100 });
  assert.deepEqual(body(m.calls[0]).params.arguments, { address: TOKEN, budget_ms: 1100 });
  assert.equal(w.decision, "WAIT");
  assert.deepEqual(w.pending, { retryAfterS: 6 });
  await t.preBuyCheck(TOKEN, { budgetMs: 60_000 });
  assert.equal(body(m.calls[1]).params.arguments.budget_ms, 25_000);
});

test("preBuyCheck without a budget sends only the address", async () => {
  const m = mockFetch([mcp("Decision: ALLOW")]);
  await new Toll({ fetch: m.f }).preBuyCheck(TOKEN);
  assert.deepEqual(body(m.calls[0]).params.arguments, { address: TOKEN });
});

test("checkTxText keeps every warning and ends with the RiskAssessment", () => {
  const t = checkTxText({ action: "WARN", warnings: [] });
  assert.match(t, /- no warnings/);
  assert.match(t, /RiskAssessment \(ERC-8265\):\n\{"action":"WARN"/);
});
