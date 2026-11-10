import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Agent } from "@mastra/core/agent";
import { Toll } from "@tollxyz/sdk";
import { tollTools, TOOL_NAMES } from "../src/index.js";
import { LIVE_DESCRIPTIONS } from "../src/live.js";

const fx = (n: string) => readFileSync(new URL(`../../sdk-js/tests/fixtures/${n}.json`, import.meta.url), "utf8");
const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
const ctx = {} as any;

function setup(responses: string[]) {
  const bodies: any[] = [];
  const f = async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(r, { status: 200 });
  };
  return { tools: tollTools({ client: new Toll({ fetch: f, sleep: async () => {} }) }), bodies };
}

test("all 28 live tools keyed and id'd by Toll's names, sharp descriptions, Robinhood Chain only, no verdict words", () => {
  const { tools } = setup([]);
  assert.deepEqual(Object.keys(tools), TOOL_NAMES);
  assert.equal(Object.keys(tools).length, 28);
  for (const t of Object.values(tools)) assert.ok(!/Solana|\bBSC\b|\bArc\b/.test(t!.description));
  for (const [k, t] of Object.entries(tools)) {
    assert.equal(t!.id, k);
    assert.ok(!/\b(scam|rug|safe)\b/i.test(t!.description), k);
  }
  assert.match(tools.check_coin!.description, /^Before buying a token on Robinhood Chain, check who is behind it/);
  assert.match(tools.check_agent!.description, /^Before paying or trusting an ERC-8004 agent/);
});

test("check_coin executes against the server tool", async () => {
  const { tools, bodies } = setup([fx("check_coin")]);
  const out = await tools.check_coin!.execute!({ address: TOKEN, chain: "rh" }, ctx);
  assert.deepEqual(bodies[0].params, { name: "check_coin", arguments: { address: TOKEN, chain: "rh" } });
  assert.match(String(out), /Findings: 2 against/);
});

test("Mastra's input validation refuses any chain but rh before any request", async () => {
  const { tools, bodies } = setup([]);
  for (const chain of ["arc", "sol", "bsc"]) {
    const out: any = await tools.check_coin!.execute!({ address: TOKEN, chain } as any, ctx);
    assert.equal(out.error, true);
    assert.match(out.message, /validation failed for check_coin/);
  }
  assert.equal(bodies.length, 0);
});

test("pre-sign and Markets tools call the MCP tools with the live argument names", async () => {
  const { tools, bodies } = setup(["a", "b", "c", "d", "e"].map(ok));
  const tx = { to: TOKEN, data: "0x", value: "0", from: TOKEN };
  const presign = { version: "erc-presign/1" as const, subject: { type: "calls", chainId: "eip155:4663", calls: [] } };
  assert.equal(await tools.check_tx!.execute!(tx, ctx), "a");
  assert.equal(await tools.presign_risk_report!.execute!(presign, ctx), "b");
  assert.equal(await tools.institutions!.execute!({ id: "NVDA", limit: 3 }, ctx), "c");
  assert.equal(await tools.guidance!.execute!({ id: "NVDA" }, ctx), "d");
  assert.equal(await tools.stock_events!.execute!({ since: 9 }, ctx), "e");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [
    ["check_tx", tx],
    ["presign_risk_report", presign],
    ["institutions", { id: "NVDA", limit: 3 }],
    ["guidance", { id: "NVDA" }],
    ["stock_events", { since: 9 }],
  ]);
});

test("over quota appends the pay line", async () => {
  const { tools } = setup([fx("check_coin_over")]);
  const out = String(await tools.check_coin!.execute!({ address: TOKEN }, ctx));
  assert.match(out, /Free coins for today are used up .*With the owner's consent, each check can be paid at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402, 0.005 USDG on Robinhood Chain\); this tool does not pay\./s);
});

test("larp_check waits for a pending read", async () => {
  const { tools, bodies } = setup([fx("larp_check_reading"), fx("larp_check")]);
  const out = String(await tools.larp_check!.execute!({ token: TOKEN }, ctx));
  assert.equal(bodies.length, 2);
  assert.match(out, /product found/);
});

test("other tools call their server tools; errors come back as text", async () => {
  const { tools, bodies } = setup([ok("a"), ok("b"), ok("c"), ok("d"), ok("e"), ok("f")]);
  assert.equal(await tools.dev_record!.execute!({ wallet: TOKEN }, ctx), "a");
  assert.equal(await tools.check_agent!.execute!({ id: 20030 }, ctx), "b");
  assert.equal(await tools.launch_record!.execute!({ address: TOKEN }, ctx), "c");
  assert.equal(await tools.wallet_privacy!.execute!({ wallet: TOKEN }, ctx), "d");
  assert.equal(await tools.fresh_launches!.execute!({ limit: 2 }, ctx), "e");
  assert.equal(await tools.chain_pulse!.execute!({}, ctx), "f");
  assert.deepEqual(
    bodies.map((b) => b.params.name),
    ["dev_record", "check_agent", "launch_record", "wallet_privacy", "fresh_launches", "chain_pulse"],
  );
  assert.match(String(await tools.check_coin!.execute!({ address: "nope" }, ctx)), /Invalid address/);
});

test("an Agent takes the tools as they are", async () => {
  const { tools } = setup([]);
  const agent = new Agent({ id: "guard", name: "guard", instructions: "Check before buying.", model: "openai/gpt-4o-mini" as any, tools: tools as any });
  assert.deepEqual(Object.keys(await agent.listTools()), TOOL_NAMES);
});

test("only: returns a subset; an unknown name throws", () => {
  assert.deepEqual(Object.keys(tollTools({ client: new Toll(), only: ["check_coin", "check_agent"] })), ["check_coin", "check_agent"]);
  assert.throws(() => tollTools({ only: ["nope" as any] }), /Unknown Toll tool/);
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const out = await tollTools({ only: ["chain_pulse"] }).chain_pulse!.execute!({}, ctx);
  assert.match(String(out), /Robinhood Chain/);
});

test("published types", { skip: !existsSync(new URL("../dist/index.d.ts", import.meta.url)) && "run npm run build first" }, () => {
  const dts = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  assert.match(dts, /tollTools\(opts\?: TollToolsOptions\): Partial<Record<TollToolName, TollMastraTool>>/);
});

test("defs.ts is the same file as @tollxyz/langchain's", () => {
  const read = (u: string) => readFileSync(new URL(u, import.meta.url), "utf8");
  assert.equal(read("../src/defs.ts"), read("../../langchain/src/defs.ts"));
  assert.equal(read("../src/format.ts"), read("../../langchain/src/format.ts"));
  assert.equal(read("../src/live.ts"), read("../../langchain/src/live.ts"));
  assert.equal(read("../src/schemas.ts"), read("../../langchain/src/schemas.ts"));
});

test("re-exports Toll and TollError", async () => {
  const mod = await import("../src/index.js");
  assert.equal(mod.Toll, Toll);
  assert.equal(typeof mod.TollError, "function");
});

const HOOK = "0x4eb1976978756bd56802d8162f2271844924e0cc";
test("check_hook (11-05): one call with { address }", async () => {
  const { tools, bodies } = setup([ok("h")]);
  assert.match(tools.check_hook!.description, /Uniswap v4 hook/);
  assert.equal(await tools.check_hook!.execute!({ address: HOOK }, ctx), "h");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [["check_hook", { address: HOOK }]]);
});

test("find_paid_api (0.5.0): one call with { query, limit }", async () => {
  const { tools, bodies } = setup([ok("f"), ok("g")]);
  assert.match(tools.find_paid_api!.description, /Paid APIs \(x402\)/);
  assert.equal(await tools.find_paid_api!.execute!({ query: "stock quotes", limit: 3 }, ctx), "f");
  assert.equal(await tools.find_paid_api!.execute!({}, ctx), "g");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [["find_paid_api", { query: "stock quotes", limit: 3 }], ["find_paid_api", {}]]);
});

const WALLET = "0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc";
const HOOK_URL = "https://example.com/toll-hook";
test("0.4.0: wallet_approvals, watches and check_tx ticket: live descriptions, Toll's argument names, the key on every call", async () => {
  const calls: Array<{ body: any; key: string | null }> = [];
  const replies = ["a", "w", "[]", "{}", "w2", "{}", "t"];
  const f = async (_u: string, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("x-toll-pass") });
    return new Response(ok(replies.shift()!), { status: 200 });
  };
  const tools = tollTools({ client: new Toll({ fetch: f, tollKey: "tk_9", sleep: async () => {} }) });
  for (const n of ["wallet_approvals", "watch_coin", "my_watches", "unwatch_coin", "watch_wallet", "unwatch_wallet"] as const) {
    assert.equal(tools[n]!.description, LIVE_DESCRIPTIONS[n]);
  }
  assert.equal(await tools.wallet_approvals!.execute!({ wallet: WALLET }, ctx), "a");
  assert.equal(await tools.watch_coin!.execute!({ address: TOKEN, url: HOOK_URL }, ctx), "w");
  assert.equal(await tools.my_watches!.execute!({}, ctx), "[]");
  assert.equal(await tools.unwatch_coin!.execute!({ id: "w1" }, ctx), "{}");
  assert.equal(await tools.watch_wallet!.execute!({ address: WALLET, url: HOOK_URL }, ctx), "w2");
  assert.equal(await tools.unwatch_wallet!.execute!({ id: "w2" }, ctx), "{}");
  assert.equal(await tools.check_tx!.execute!({ to: TOKEN, data: "0x", value: "0", from: TOKEN, ticket: true }, ctx), "t");
  assert.deepEqual(calls.map((c) => [c.body.params.name, c.body.params.arguments]), [
    ["wallet_approvals", { wallet: WALLET }],
    ["watch_coin", { address: TOKEN, url: HOOK_URL }],
    ["my_watches", {}],
    ["unwatch_coin", { id: "w1" }],
    ["watch_wallet", { address: WALLET, url: HOOK_URL }],
    ["unwatch_wallet", { id: "w2" }],
    ["check_tx", { to: TOKEN, data: "0x", value: "0", from: TOKEN, ticket: {} }],
  ]);
  for (const c of calls) assert.equal(c.key, "tk_9");
});

test("0.4.0: a watch without a Toll key is answered as text, never sent", async () => {
  const { tools, bodies } = setup([]);
  assert.match(String(await tools.watch_wallet!.execute!({ address: WALLET, url: HOOK_URL }, ctx)), /needs a Toll key/);
  assert.equal(bodies.length, 0);
});
