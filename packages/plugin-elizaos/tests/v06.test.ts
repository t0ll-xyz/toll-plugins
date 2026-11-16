// 0.6.0: the time budget, the held verdict in the provider, and withTollPreBuy (mocked HTTP, no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Toll } from "@tollxyz/sdk";
import { createTollPlugin, heldVerdictOf, withTollPreBuy } from "../src/index.js";

const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const OTHER = "0x1111111111111111111111111111111111111111";
type Call = { url: string; body: any };
const mcp = (text: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }), { status: 200 });
function client(responses: Array<Response | (() => Promise<Response>)>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return typeof r === "function" ? r() : r;
  };
  return { toll: new Toll({ fetch: f, sleep: async () => {} }), calls };
}
const msg = (text: string): any => ({ entityId: "e", roomId: "r", content: { text } });
const rt = (settings: Record<string, string> = {}): any => ({ getSetting: (k: string) => settings[k] });
const act = (p: any, name: string) => p.actions.find((a: any) => a.name === name);
const HELD = (line: string) => `1 coin: 1 answered from Toll's reads.\n${line}\nRobinhood Chain only.`;

test("TOLL_PRE_BUY_CHECK answers to TOLL_PRE_BUY too, and sends budget_ms from the option", async () => {
  const { toll, calls } = client([mcp("Decision: WAIT\nStill being read: ask again in 5 s.")]);
  const p = createTollPlugin({ client: toll, budgetMs: 1100 });
  const a = act(p, "TOLL_PRE_BUY_CHECK");
  assert.ok(a.similes.includes("TOLL_PRE_BUY"));
  const r = await a.handler(rt(), msg(`should I buy ${TOKEN}?`), undefined, undefined, undefined);
  assert.equal(calls[0].body.params.arguments.budget_ms, 1100);
  assert.match(r.text, /Decision: WAIT/);
});

test("the TOLL_BUDGET_MS setting is the budget when no option is given", async () => {
  const { toll, calls } = client([mcp("Decision: ALLOW")]);
  const p = createTollPlugin({ client: toll });
  await act(p, "TOLL_PRE_BUY_CHECK").handler(rt({ TOLL_BUDGET_MS: "900" }), msg(`about to buy ${TOKEN}`));
  assert.equal(calls[0].body.params.arguments.budget_ms, 900);
});

test("TOLL_CHECK_TX with a budget goes to POST /api/tx/check with budgetMs; a coin not read stays WARN", async () => {
  const ra = { action: "WARN", warnings: [{ code: "coin-not-read", severity: "medium", message: "Still being read." }] };
  const { toll, calls } = client([new Response(JSON.stringify(ra), { status: 200, headers: { "retry-after": "3" } })]);
  const p = createTollPlugin({ client: toll, budgetMs: 1100 });
  const r = await act(p, "TOLL_CHECK_TX").handler(rt(), msg(`check before I sign: {"to":"${TOKEN}","data":"0x","from":"${OTHER}"}`));
  assert.match(calls[0].url, /\/api\/tx\/check$/);
  assert.equal(calls[0].body.budgetMs, 1100);
  assert.match(r.text, /^WARN/);
  assert.match(r.text, /coin-not-read/);
  assert.doesNotMatch(r.text, /^ALLOW/m);
});

test("heldVerdictOf reads one coin's word; not read yet is null", () => {
  const t = `x\n${TOKEN}: INCOMPLETE (0 against, 6 careful, 5 clear), read 0 min ago\n${OTHER}: not read yet, call check_coin`;
  assert.deepEqual(heldVerdictOf(t, TOKEN.toUpperCase().replace("0X", "0x"))?.word, "INCOMPLETE");
  assert.equal(heldVerdictOf(t, OTHER), null);
});

test("provider: a held CLEAR says it is not a promise; INCOMPLETE and not read are never clear", async () => {
  const { toll } = client([
    mcp(HELD(`${TOKEN}: CLEAR (0 against, 0 careful, 9 clear), read 2 min ago`)),
    mcp(HELD(`${TOKEN}: INCOMPLETE (0 against, 6 careful, 5 clear), read 0 min ago`)),
    mcp(HELD(`${TOKEN}: not read yet, call check_coin or pre_buy_check for it`)),
  ]);
  const prov = createTollPlugin({ client: toll }).providers![0];
  const clear = await prov.get(rt(), msg(`ape ${TOKEN}`), {} as any);
  assert.match(clear.text!, /CLEAR means nothing against was found in what was read, not a promise/);
  assert.equal(clear.values!.tollVerdict, "CLEAR");
  const inc = await prov.get(rt(), msg(`ape ${TOKEN}`), {} as any);
  assert.match(inc.text!, /never treat it as clear/);
  const nr = await prov.get(rt(), msg(`ape ${TOKEN}`), {} as any);
  assert.match(nr.text!, /not read this coin yet: that is not clear/);
  assert.equal(nr.values!.tollVerdict, "NOT_READ");
});

test("provider: no address = nothing, and no network call", async () => {
  const { toll, calls } = client([]);
  const prov = createTollPlugin({ client: toll }).providers![0];
  const r = await prov.get(rt(), msg("gm"), {} as any);
  assert.equal(r.text, "");
  assert.equal(calls.length, 0);
});

test("provider: Toll failing leaves the hint alone, with no verdict", async () => {
  const { toll } = client([new Response("down", { status: 503 })]);
  const prov = createTollPlugin({ client: toll }).providers![0];
  const r = await prov.get(rt(), msg(`ape ${TOKEN}`), {} as any);
  assert.match(r.text!, /Toll can check who is behind it/);
  assert.equal(r.values!.tollVerdict, undefined);
});

/* ---------------------------------------------------------------- withTollPreBuy */

function buyAction() {
  let ran = 0;
  const action: any = {
    name: "BUY_TOKEN",
    description: "buys a token",
    similes: [],
    examples: [],
    validate: async () => true,
    handler: async () => {
      ran++;
      return { success: true, text: "bought" };
    },
  };
  return { action, ran: () => ran };
}

test("withTollPreBuy: ALLOW runs the action, with budget_ms sent", async () => {
  const { toll, calls } = client([mcp("Decision: ALLOW\n- nothing against was found")]);
  const b = buyAction();
  const g = withTollPreBuy(b.action, { client: toll, budgetMs: 1100 });
  assert.equal(g.name, "BUY_TOKEN");
  const r: any = await g.handler(rt(), msg(`buy ${TOKEN}`));
  assert.equal(r.text, "bought");
  assert.equal(b.ran(), 1);
  assert.equal(calls[0].body.params.arguments.budget_ms, 1100);
});

test("withTollPreBuy: BLOCK, WAIT, WARN, no decision, no address and Toll down all refuse (fail closed)", async () => {
  const { toll } = client([
    mcp("Decision: BLOCK\n- sells fail"),
    mcp("Decision: WAIT\nask again in 7 s"),
    mcp("Decision: WARN\n- dev sold"),
    mcp("Free coins for today are used up."),
    new Response("down", { status: 500 }),
  ]);
  const b = buyAction();
  const said: string[] = [];
  const cb = async (c: any) => { said.push(c.text); return []; };
  const g = withTollPreBuy(b.action, { client: toll });
  const results: any[] = [];
  for (let i = 0; i < 5; i++) results.push(await g.handler(rt(), msg(`buy ${TOKEN}`), undefined, undefined, cb));
  results.push(await g.handler(rt(), msg("buy the new coin"), undefined, undefined, cb));
  assert.equal(b.ran(), 0);
  assert.ok(results.every((r) => r.success === false));
  assert.match(results[0].text, /BLOCK/);
  assert.match(results[1].text, /ask again in 7 s/);
  assert.match(results[2].text, /WARN/);
  assert.match(results[3].text, /no decision/);
  assert.match(results[4].text, /could not answer/);
  assert.match(results[5].text, /no token address/);
  assert.equal(said.length, 6);
});

test("withTollPreBuy: onWarn allow passes the warning on and runs; TOLL_GUARD=off skips Toll", async () => {
  const { toll, calls } = client([mcp("Decision: WARN\n- dev sold 40%")]);
  const b = buyAction();
  const said: string[] = [];
  const g = withTollPreBuy(b.action, { client: toll, onWarn: "allow" });
  await g.handler(rt(), msg(`buy ${TOKEN}`), undefined, undefined, async (c: any) => { said.push(c.text); return []; });
  assert.equal(b.ran(), 1);
  assert.match(said[0], /dev sold 40%/);
  const off = withTollPreBuy(b.action, { client: toll });
  await off.handler(rt({ TOLL_GUARD: "off" }), msg(`buy ${TOKEN}`));
  assert.equal(b.ran(), 2);
  assert.equal(calls.length, 1);
});
