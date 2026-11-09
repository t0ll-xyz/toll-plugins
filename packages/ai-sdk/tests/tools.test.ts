import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { generateText, asSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { TOOL_NAMES, Toll } from "@tollxyz/sdk";
import { LIVE_DESCRIPTIONS, tollTools } from "../src/index.js";

const fx = (n: string) => readFileSync(new URL(`../../sdk-js/tests/fixtures/${n}.json`, import.meta.url), "utf8");
const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });

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
const opts = { toolCallId: "t1", messages: [] } as any;

test("all 27 live tools, sharp descriptions, Robinhood Chain only, no verdict words", () => {
  const { tools } = setup([]);
  assert.deepEqual(Object.keys(tools).sort(), [...TOOL_NAMES].sort());
  assert.match(String(tools.check_coin!.description), /^Before buying a token on Robinhood Chain, check who is behind it/);
  for (const t of Object.values(tools)) assert.ok(!/Solana|\bBSC\b|\bArc\b/.test(String(t!.description)));
  for (const n of ["wallet_privacy", "check_agent", "check_tx", "presign_risk_report"] as const) assert.equal(tools[n]!.description, LIVE_DESCRIPTIONS[n]);
  assert.match(String(tools.larp_check!.description), /^Is there a real product behind this coin on Robinhood Chain\?/);
  for (const t of Object.values(tools)) assert.ok(!/\b(scam|rug|safe)\b/i.test(String(t!.description)));
});

test("input schema is JSON-schema ready and Robinhood Chain only", async () => {
  const { tools } = setup([]);
  const s = asSchema(tools.check_coin!.inputSchema);
  const json: any = await s.jsonSchema;
  assert.deepEqual(json.properties.chain.enum, ["rh"]);
  assert.deepEqual(json.required, ["address"]);
  for (const c of ["arc", "sol", "bsc"]) assert.equal((await s.validate!({ address: TOKEN, chain: c })).success, false);
  const ev: any = await asSchema(tools.stock_events!.inputSchema).jsonSchema;
  assert.equal(ev.properties.kind.enum.length, 9);
  const pr: any = await asSchema(tools.presign_risk_report!.inputSchema).jsonSchema;
  assert.deepEqual(pr.required.sort(), ["subject", "version"]);
  assert.equal((await s.validate!({ address: TOKEN })).success, true);
});

test("check_coin executes against the server tool", async () => {
  const { tools, bodies } = setup([fx("check_coin")]);
  const out = await tools.check_coin!.execute!({ address: TOKEN, chain: "rh" }, opts);
  assert.deepEqual(bodies[0].params, { name: "check_coin", arguments: { address: TOKEN, chain: "rh" } });
  assert.match(String(out), /Findings: 2 against/);
});

test("over quota appends the pay line", async () => {
  const { tools } = setup([fx("check_coin_over")]);
  const out = String(await tools.check_coin!.execute!({ address: TOKEN }, opts));
  assert.match(out, /pay per check at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402: 0.005 USDG on Robinhood Chain or USDC on Base; pay only with the owner's consent\)\. Holding \$TOLL lifts the daily limits: new coins a day Free 10 \/ 1M \$TOLL 100 \/ 5M 500 \/ 20M 2,000/s);
});

test("larp_check waits for a pending read", async () => {
  const { tools, bodies } = setup([fx("larp_check_reading"), fx("larp_check")]);
  const out = String(await tools.larp_check!.execute!({ token: TOKEN }, opts));
  assert.equal(bodies.length, 2);
  assert.match(out, /product found/);
});

test("other tools call their server tools; errors come back as text", async () => {
  const { tools, bodies } = setup([ok("a"), ok("b"), ok("c"), ok("d")]);
  assert.equal(await tools.dev_record!.execute!({ wallet: TOKEN }, opts), "a");
  assert.equal(await tools.launch_record!.execute!({ address: TOKEN }, opts), "b");
  assert.equal(await tools.fresh_launches!.execute!({ limit: 2 }, opts), "c");
  assert.equal(await tools.chain_pulse!.execute!({}, opts), "d");
  assert.deepEqual(bodies.map((b) => b.params.name), ["dev_record", "launch_record", "fresh_launches", "chain_pulse"]);
  const bad = String(await tools.check_coin!.execute!({ address: "nope" }, opts));
  assert.match(bad, /Invalid address/);
});

test("the agent, pre-sign and event tools call the MCP tools with the live argument names", async () => {
  const { tools, bodies } = setup([ok("a"), ok("b"), ok("c"), ok("d"), ok("e")]);
  const tx = { to: TOKEN, data: "0x", value: "0", from: TOKEN };
  const presign = { version: "erc-presign/1" as const, subject: { type: "calls", chainId: "eip155:4663", calls: [] } };
  assert.equal(await tools.wallet_privacy!.execute!({ wallet: TOKEN }, opts), "a");
  assert.equal(await tools.check_agent!.execute!({ id: 20030 }, opts), "b");
  assert.equal(await tools.check_tx!.execute!(tx, opts), "c");
  assert.equal(await tools.presign_risk_report!.execute!(presign, opts), "d");
  assert.equal(await tools.stock_events!.execute!({ since: 7 }, opts), "e");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [
    ["wallet_privacy", { wallet: TOKEN }],
    ["check_agent", { id: 20030 }],
    ["check_tx", tx],
    ["presign_risk_report", presign],
    ["stock_events", { since: 7 }],
  ]);
  const sol = String(await tools.check_coin!.execute!({ address: "So11111111111111111111111111111111111111112" }, opts));
  assert.match(sol, /Robinhood Chain only/);
});

test("institutions and guidance GET their Markets routes with the key; over quota they point to x402", async () => {
  const calls: Array<{ url: string; key: string | null }> = [];
  const OVER = { error: "50 Markets calls used today (free).", quota: { used: 50, limit: 50, left: 0, tier: "free" } };
  const rs = [new Response(JSON.stringify({ ticker: "NVDA" })), new Response(JSON.stringify({ ticker: "NVDA" })), new Response(JSON.stringify(OVER), { status: 429 })];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, key: new Headers(init?.headers).get("x-toll-pass") });
    return rs.shift()!;
  };
  const t = tollTools({ fetch: f, tollKey: "tk_3" });
  assert.deepEqual(JSON.parse(String(await t.institutions!.execute!({ id: "NVDA", limit: 5 }, opts))), { ticker: "NVDA" });
  assert.deepEqual(JSON.parse(String(await t.guidance!.execute!({ id: "$AAPL", limit: 10 }, opts))), { ticker: "NVDA" });
  assert.deepEqual(calls, [
    { url: "https://t0ll.xyz/api/markets/institutions/NVDA?limit=5", key: "tk_3" },
    { url: "https://t0ll.xyz/api/markets/guidance/AAPL?limit=10", key: "tk_3" },
  ]);
  assert.match(String(await t.guidance!.execute!({ id: "NVDA" }, opts)), /https:\/\/t0ll\.xyz\/api\/x402\/markets\/guidance\/NVDA \(0\.01 USDG on Robinhood Chain/);
});

test("only: returns a subset", () => {
  const t = tollTools({ client: new Toll(), only: ["check_coin", "larp_check"] });
  assert.deepEqual(Object.keys(t), ["check_coin", "larp_check"]);
});

test("works inside generateText with a mock model", async () => {
  const { tools, bodies } = setup([fx("check_coin")]);
  let step = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      step++;
      return step === 1
        ? {
            content: [{ type: "tool-call", toolCallId: "c1", toolName: "check_coin", input: JSON.stringify({ address: TOKEN, chain: "rh" }) }],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            warnings: [],
          }
        : {
            content: [{ type: "text", text: "done" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            warnings: [],
          };
    },
  } as any);
  const r = await generateText({ model, tools, prompt: "check it", stopWhen: ({ steps }: any) => steps.length >= 3 } as any);
  assert.equal(bodies.length, 1);
  assert.equal(r.text, "done");
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const out = await tollTools().chain_pulse!.execute!({}, opts);
  assert.ok(String(out).length > 0);
});

test("published types name only ai and @tollxyz/sdk (no @ai-sdk/* imports)", { skip: !existsSync(new URL("../dist/index.d.ts", import.meta.url)) && "run npm run build first" }, () => {
  const dts = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  assert.ok(!/@ai-sdk\//.test(dts), "dist/index.d.ts must not import @ai-sdk/* packages");
  assert.match(dts, /tollTools\(opts\?: TollToolsOptions\): Partial<Record<TollToolName, Tool>>/);
});

test("re-exports Toll and TollError", async () => {
  const mod = await import("../src/index.js");
  assert.equal(mod.Toll, Toll);
  assert.equal(typeof mod.TollError, "function");
});

const HOOK = "0x4eb1976978756bd56802d8162f2271844924e0cc";
test("check_hook (11-05): the live description, one call with { address }", async () => {
  const { tools, bodies } = setup([ok("h")]);
  assert.equal(tools.check_hook!.description, LIVE_DESCRIPTIONS.check_hook);
  assert.equal(await tools.check_hook!.execute!({ address: HOOK }, opts), "h");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [["check_hook", { address: HOOK }]]);
});

test("pre_buy_check and check_coins (11-06): live descriptions, one call each with Toll's argument names", async () => {
  const { tools, bodies } = setup([ok("Decision: WAIT"), ok("2 coins")]);
  assert.equal(tools.pre_buy_check!.description, LIVE_DESCRIPTIONS.pre_buy_check);
  assert.equal(tools.check_coins!.description, LIVE_DESCRIPTIONS.check_coins);
  assert.equal(await tools.pre_buy_check!.execute!({ address: TOKEN }, opts), "Decision: WAIT");
  assert.equal(await tools.check_coins!.execute!({ addresses: [TOKEN, HOOK] }, opts), "2 coins");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [["pre_buy_check", { address: TOKEN }], ["check_coins", { addresses: [TOKEN, HOOK] }]]);
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
  const tx: any = await asSchema(tools.check_tx!.inputSchema).jsonSchema;
  assert.ok(tx.properties.ticket);
  assert.equal(await tools.wallet_approvals!.execute!({ wallet: WALLET }, opts), "a");
  assert.equal(await tools.watch_coin!.execute!({ address: TOKEN, url: HOOK_URL }, opts), "w");
  assert.equal(await tools.my_watches!.execute!({}, opts), "[]");
  assert.equal(await tools.unwatch_coin!.execute!({ id: "w1" }, opts), "{}");
  assert.equal(await tools.watch_wallet!.execute!({ address: WALLET, url: HOOK_URL }, opts), "w2");
  assert.equal(await tools.unwatch_wallet!.execute!({ id: "w2" }, opts), "{}");
  assert.equal(await tools.check_tx!.execute!({ to: TOKEN, data: "0x", value: "0", from: TOKEN, ticket: { scope: "call" } }, opts), "t");
  assert.deepEqual(calls.map((c) => [c.body.params.name, c.body.params.arguments]), [
    ["wallet_approvals", { wallet: WALLET }],
    ["watch_coin", { address: TOKEN, url: HOOK_URL }],
    ["my_watches", {}],
    ["unwatch_coin", { id: "w1" }],
    ["watch_wallet", { address: WALLET, url: HOOK_URL }],
    ["unwatch_wallet", { id: "w2" }],
    ["check_tx", { to: TOKEN, data: "0x", value: "0", from: TOKEN, ticket: { scope: "call" } }],
  ]);
  for (const c of calls) assert.equal(c.key, "tk_9");
});

test("0.4.0: a watch without a Toll key is answered as text, never sent", async () => {
  const { tools, bodies } = setup([]);
  assert.match(await tools.watch_wallet!.execute!({ address: WALLET, url: HOOK_URL }, opts), /needs a Toll key/);
  assert.equal(bodies.length, 0);
});
