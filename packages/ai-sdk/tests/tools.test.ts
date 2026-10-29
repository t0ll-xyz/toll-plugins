import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { generateText, asSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Toll } from "@tollxyz/sdk";
import { tollTools } from "../src/index.js";

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

test("six tools, sharp descriptions, no arc, no verdict words", () => {
  const { tools } = setup([]);
  assert.deepEqual(Object.keys(tools), ["check_coin", "larp_check", "dev_record", "launch_record", "fresh_launches", "chain_pulse"]);
  assert.match(String(tools.check_coin!.description), /^Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it/);
  assert.match(String(tools.larp_check!.description), /^Is there a real product behind this coin\?/);
  for (const t of Object.values(tools)) assert.ok(!/\b(scam|rug|safe)\b/i.test(String(t!.description)));
});

test("input schema is JSON-schema ready and rejects arc", async () => {
  const { tools } = setup([]);
  const s = asSchema(tools.check_coin!.inputSchema);
  const json: any = await s.jsonSchema;
  assert.deepEqual(json.properties.chain.enum, ["rh", "sol", "bsc"]);
  assert.deepEqual(json.required, ["address"]);
  const parsed = await s.validate!({ address: TOKEN, chain: "arc" });
  assert.equal(parsed.success, false);
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
  assert.match(out, /pay per check at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402: 0\.05 USDG on Robinhood Chain or USDC on Base\)\. Holding \$TOLL does not lift this limit/s);
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
