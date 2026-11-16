// 0.6.0: budgetMs reaches pre_buy_check (budget_ms) and check_tx (POST /api/tx/check, budgetMs); not read is never clear. Mocked HTTP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Toll } from "@tollxyz/sdk";
import { tollTools } from "../src/index.js";

const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const FROM = "0x000000000000000000000000000000000000dEaD";
const make = (o: any) => { const t: any = tollTools(o); return (n: string, a: any) => t[n].execute(a, {} as any).then(String); };
const mcp = (text: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }), { status: 200 });
function setup(responses: Response[], budgetMs?: number) {
  const calls: Array<{ url: string; body: any }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return r;
  };
  const call = make({ client: new Toll({ fetch: f, sleep: async () => {} }), ...(budgetMs !== undefined ? { budgetMs } : {}) });
  return { call, calls };
}

test("budgetMs: pre_buy_check sends budget_ms and a WAIT comes back as WAIT", async () => {
  const { call, calls } = setup([mcp("Decision: WAIT\nPart of the coin is still being read: ask again in 5 s.")], 1100);
  const out = await call("pre_buy_check", { address: TOKEN });
  assert.deepEqual(calls[0].body.params, { name: "pre_buy_check", arguments: { address: TOKEN, budget_ms: 1100 } });
  assert.match(out, /Decision: WAIT/);
  assert.doesNotMatch(out, /Decision: ALLOW/);
});

test("budgetMs: check_tx goes to POST /api/tx/check with budgetMs; a coin not read is WARN with the seconds, never ALLOW", async () => {
  const ra = { action: "WARN", warnings: [{ code: "coin-not-read", severity: "medium", message: "The coin is still being read." }] };
  const { call, calls } = setup([new Response(JSON.stringify(ra), { status: 200, headers: { "retry-after": "4" } })], 1100);
  const out = await call("check_tx", { to: TOKEN, data: "0x", from: FROM });
  assert.match(calls[0].url, /\/api\/tx\/check$/);
  assert.equal(calls[0].body.budgetMs, 1100);
  assert.match(out, /^WARN: read the warnings before signing/);
  assert.match(out, /\(coin-not-read\)/);
  assert.match(out, /again in 4 s/);
});

test("no budgetMs: pre_buy_check and check_tx stay on MCP exactly as before", async () => {
  const { call, calls } = setup([mcp("Decision: ALLOW"), mcp('WARN: x\n\nRiskAssessment (ERC-8265):\n{"action":"WARN","warnings":[]}')]);
  await call("pre_buy_check", { address: TOKEN });
  await call("check_tx", { to: TOKEN, data: "0x", from: FROM });
  assert.deepEqual(calls[0].body.params.arguments, { address: TOKEN });
  assert.match(calls[1].url, /\/mcp$/);
  assert.equal(calls[1].body.params.name, "check_tx");
});

test("budgetMs: a refused check (429) comes back as one line, not as a clear answer", async () => {
  const { call } = setup([new Response(JSON.stringify({ error: "Too many checks" }), { status: 429, headers: { "retry-after": "60" } })], 1100);
  const out = await call("check_tx", { to: TOKEN, data: "0x", from: FROM });
  assert.match(out, /^Toll could not answer: .*429/);
});
