import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Agent } from "@mastra/core/agent";
import { Toll } from "@tollxyz/sdk";
import { tollTools, TOOL_NAMES } from "../src/index.js";

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

test("eight tools keyed and id'd by Toll's names, sharp descriptions, no verdict words", () => {
  const { tools } = setup([]);
  assert.deepEqual(Object.keys(tools), TOOL_NAMES);
  for (const [k, t] of Object.entries(tools)) {
    assert.equal(t!.id, k);
    assert.ok(!/\b(scam|rug|safe)\b/i.test(t!.description), k);
  }
  assert.match(tools.check_coin!.description, /^Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it/);
  assert.match(tools.check_agent!.description, /^Before paying or trusting an ERC-8004 agent/);
});

test("check_coin executes against the server tool", async () => {
  const { tools, bodies } = setup([fx("check_coin")]);
  const out = await tools.check_coin!.execute!({ address: TOKEN, chain: "rh" }, ctx);
  assert.deepEqual(bodies[0].params, { name: "check_coin", arguments: { address: TOKEN, chain: "rh" } });
  assert.match(String(out), /Findings: 2 against/);
});

test("Mastra's input validation refuses a bad chain before any request", async () => {
  const { tools, bodies } = setup([]);
  const out: any = await tools.check_coin!.execute!({ address: TOKEN, chain: "arc" } as any, ctx);
  assert.equal(out.error, true);
  assert.match(out.message, /validation failed for check_coin/);
  assert.equal(bodies.length, 0);
});

test("over quota appends the pay line", async () => {
  const { tools } = setup([fx("check_coin_over")]);
  const out = String(await tools.check_coin!.execute!({ address: TOKEN }, ctx));
  assert.match(out, /Free coins for today are used up .*With the owner's consent, each check can be paid at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402, 0\.05 USDG on Robinhood Chain\); this tool does not pay\./s);
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
});

test("re-exports Toll and TollError", async () => {
  const mod = await import("../src/index.js");
  assert.equal(mod.Toll, Toll);
  assert.equal(typeof mod.TollError, "function");
});
