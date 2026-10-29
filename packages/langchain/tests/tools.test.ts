import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { ToolMessage } from "@langchain/core/messages";
import { Toll } from "@tollxyz/sdk";
import { tollTools, TOOL_NAMES } from "../src/index.js";

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
  const tools = tollTools({ client: new Toll({ fetch: f, sleep: async () => {} }) });
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { tools, by, bodies };
}

test("eight tools with Toll's names, sharp descriptions, no verdict words", () => {
  const { tools, by } = setup([]);
  assert.deepEqual(tools.map((t) => t.name), TOOL_NAMES);
  assert.equal(tools.length, 8);
  assert.match(by.check_coin.description, /^Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it/);
  assert.match(by.check_agent.description, /^Before paying or trusting an ERC-8004 agent/);
  assert.match(by.larp_check.description, /^Is there a real product behind this coin\?/);
  for (const t of tools) assert.ok(!/\b(scam|rug|safe)\b/i.test(t.description), t.name);
});

test("schemas convert to OpenAI function JSON for bindTools", () => {
  const { by } = setup([]);
  const fn: any = convertToOpenAITool(by.check_coin as any).function;
  assert.equal(fn.name, "check_coin");
  assert.deepEqual(fn.parameters.properties.chain.enum, ["rh", "sol", "bsc"]);
  assert.deepEqual(fn.parameters.required, ["address"]);
  const agent: any = convertToOpenAITool(by.check_agent as any).function;
  assert.equal(agent.parameters.properties.id.type, "integer");
});

test("check_coin calls the server tool and returns Toll's text", async () => {
  const { by, bodies } = setup([fx("check_coin")]);
  const out = await by.check_coin.invoke({ address: TOKEN, chain: "rh" });
  assert.deepEqual(bodies[0].params, { name: "check_coin", arguments: { address: TOKEN, chain: "rh" } });
  assert.match(String(out), /Findings: 2 against/);
});

test("a tool call returns a ToolMessage with the call id (createAgent / ToolNode path)", async () => {
  const { by } = setup([fx("check_coin")]);
  const msg = await by.check_coin.invoke({ type: "tool_call", id: "call_1", name: "check_coin", args: { address: TOKEN } });
  assert.ok(msg instanceof ToolMessage);
  assert.equal(msg.tool_call_id, "call_1");
  assert.match(String(msg.content), /Findings: 2 against/);
});

test("invalid input is refused by the schema before any request", async () => {
  const { by, bodies } = setup([]);
  await assert.rejects(by.check_coin.invoke({ address: TOKEN, chain: "arc" }));
  await assert.rejects(by.check_agent.invoke({ id: -1 }));
  assert.equal(bodies.length, 0);
});

test("over quota appends the pay line", async () => {
  const { by } = setup([fx("check_coin_over")]);
  const out = String(await by.check_coin.invoke({ address: TOKEN }));
  assert.match(out, /Free coins for today are used up .*With the owner's consent, each check can be paid at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402, 0\.05 USDG on Robinhood Chain\); this tool does not pay\./s);
});

test("larp_check waits for a pending read", async () => {
  const { by, bodies } = setup([fx("larp_check_reading"), fx("larp_check")]);
  const out = String(await by.larp_check.invoke({ token: TOKEN }));
  assert.equal(bodies.length, 2);
  assert.match(out, /product found/);
});

test("other tools call their server tools; errors come back as text", async () => {
  const { by, bodies } = setup([ok("a"), ok("b"), ok("c"), ok("d"), ok("e"), ok("f")]);
  assert.equal(await by.dev_record.invoke({ wallet: TOKEN }), "a");
  assert.equal(await by.check_agent.invoke({ id: 20030 }), "b");
  assert.equal(await by.launch_record.invoke({ address: TOKEN }), "c");
  assert.equal(await by.wallet_privacy.invoke({ wallet: TOKEN }), "d");
  assert.equal(await by.fresh_launches.invoke({ limit: 2 }), "e");
  assert.equal(await by.chain_pulse.invoke({}), "f");
  assert.deepEqual(
    bodies.map((b) => b.params.name),
    ["dev_record", "check_agent", "launch_record", "wallet_privacy", "fresh_launches", "chain_pulse"],
  );
  assert.deepEqual(bodies[1].params.arguments, { id: 20030 });
  assert.match(String(await by.check_coin.invoke({ address: "nope" })), /Invalid address/);
});

test("only: returns a subset; an unknown name throws", () => {
  assert.deepEqual(tollTools({ client: new Toll(), only: ["check_coin", "check_agent"] }).map((t) => t.name), ["check_coin", "check_agent"]);
  assert.throws(() => tollTools({ only: ["nope" as any] }), /Unknown Toll tool/);
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const pulse = tollTools({ only: ["chain_pulse"] })[0];
  assert.match(String(await pulse.invoke({})), /Robinhood Chain/);
});

test("published types name @langchain/core", { skip: !existsSync(new URL("../dist/index.d.ts", import.meta.url)) && "run npm run build first" }, () => {
  const dts = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  assert.match(dts, /tollTools\(opts\?: TollToolsOptions\): StructuredToolInterface\[\]/);
  assert.match(dts, /from "@langchain\/core\/tools"/);
});

test("re-exports Toll and TollError", async () => {
  const mod = await import("../src/index.js");
  assert.equal(mod.Toll, Toll);
  assert.equal(typeof mod.TollError, "function");
});
