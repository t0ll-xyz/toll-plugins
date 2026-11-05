import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOOL_NAMES, Toll, TollError } from "@tollxyz/sdk";
import { LIVE_DESCRIPTIONS, MARKETS_NOTE, toll } from "../src/index.js";
import * as Reexported from "../src/index.js";

// npm test runs from the package directory.
const fx = (n: string) => readFileSync(resolve(process.cwd(), "../sdk-js/tests/fixtures", `${n}.json`), "utf8");
const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });

async function setup(responses: string[]) {
  const bodies: any[] = [];
  const f = async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(r, { status: 200 });
  };
  const plugin = toll(new Toll({ fetch: f, sleep: async () => {} }));
  const tools = await plugin.getTools({} as any);
  const get = (n: string) => tools.find((t) => t.name === n)!;
  return { plugin, tools, get, bodies };
}

test("all 19 live tools with sharp descriptions and any-chain support", async () => {
  const { plugin, tools } = await setup([]);
  assert.equal(plugin.name, "toll");
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  for (const t of tools) assert.ok(!/Solana|\bBSC\b|\bArc\b/.test(t.description), t.name);
  for (const n of ["wallet_privacy", "check_agent", "check_tx", "presign_risk_report"] as const) {
    assert.equal(tools.find((t) => t.name === n)!.description, LIVE_DESCRIPTIONS[n]);
  }
  for (const n of ["institutions", "guidance", "stock_events"]) assert.ok(tools.find((t) => t.name === n)!.description.includes(MARKETS_NOTE));
  assert.equal(plugin.supportsChain({ type: "evm", id: 8453, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }), true);
  assert.equal(plugin.supportsChain({ type: "solana", nativeCurrency: { name: "Sol", symbol: "SOL", decimals: 9 } }), true);
  const c = tools.find((t) => t.name === "check_coin")!;
  assert.match(c.description, /^Before buying a token on Robinhood Chain, check who is behind it/);
  for (const t of tools) assert.ok(!/\b(scam|rug|safe)\b/i.test(t.description));
});

test("schemas are Robinhood Chain only and follow the live shapes", async () => {
  const { get } = await setup([]);
  const s = get("check_coin").parameters;
  assert.ok(s.safeParse({ address: TOKEN, chain: "rh" }).success);
  for (const c of ["sol", "bsc", "arc"]) assert.ok(!s.safeParse({ address: TOKEN, chain: c }).success);
  assert.ok(!s.safeParse({}).success);
  assert.ok(!get("larp_check").parameters.safeParse({ token: TOKEN, chain: "sol" }).success);
  assert.ok(!get("dev_record").parameters.safeParse({ wallet: TOKEN, chain: "bsc" }).success);
  assert.ok(get("check_agent").parameters.safeParse({ id: 20030 }).success);
  assert.ok(get("check_tx").parameters.safeParse({ typedData: { primaryType: "Permit" } }).success);
  assert.ok(!get("presign_risk_report").parameters.safeParse({ subject: {} }).success);
  assert.ok(!get("institutions").parameters.safeParse({ id: "NVDA", limit: 21 }).success);
  assert.ok(!get("stock_events").parameters.safeParse({ kind: "ipo" }).success);
});

test("the coin, agent, pre-sign and event tools call the MCP tools with the live argument names", async () => {
  const { get, bodies } = await setup(["a", "b", "c", "d", "e", "f", "g", "h"].map(ok));
  const tx = { to: TOKEN, data: "0x", value: "0", from: TOKEN };
  const presign = { version: "erc-presign/1", subject: { type: "calls", chainId: "eip155:4663", calls: [] } };
  assert.equal(await get("wallet_privacy").execute({ wallet: TOKEN }), "a");
  assert.equal(await get("launch_record").execute({ address: TOKEN }), "b");
  assert.equal(await get("fresh_launches").execute({ limit: 3 }), "c");
  assert.equal(await get("chain_pulse").execute({}), "d");
  assert.equal(await get("check_agent").execute({ id: "20030" }), "e");
  assert.equal(await get("check_tx").execute(tx), "f");
  assert.equal(await get("presign_risk_report").execute(presign), "g");
  assert.equal(await get("stock_events").execute({ kind: "listed", limit: 5 }), "h");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [
    ["wallet_privacy", { wallet: TOKEN }],
    ["launch_record", { address: TOKEN }],
    ["fresh_launches", { limit: 3 }],
    ["chain_pulse", {}],
    ["check_agent", { id: "20030" }],
    ["check_tx", tx],
    ["presign_risk_report", presign],
    ["stock_events", { kind: "listed", limit: 5 }],
  ]);
});

test("institutions and guidance GET their Markets routes with the key", async () => {
  const calls: Array<{ url: string; key: string | null }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, key: new Headers(init?.headers).get("x-toll-pass") });
    return new Response(JSON.stringify({ ticker: "NVDA" }));
  };
  const tools = await toll({ fetch: f, tollKey: "tk_4" }).getTools({} as any);
  const get = (n: string) => tools.find((t) => t.name === n)!;
  assert.deepEqual(JSON.parse(String(await get("institutions").execute({ id: "NVDA", limit: 2 }))), { ticker: "NVDA" });
  assert.deepEqual(JSON.parse(String(await get("guidance").execute({ id: "NVDA" }))), { ticker: "NVDA" });
  assert.deepEqual(calls, [
    { url: "https://t0ll.xyz/api/markets/institutions/NVDA?limit=2", key: "tk_4" },
    { url: "https://t0ll.xyz/api/markets/guidance/NVDA", key: "tk_4" },
  ]);
});

test("check_coin executes against the server tool", async () => {
  const { get, bodies } = await setup([fx("check_coin")]);
  const out = await get("check_coin").execute({ address: TOKEN, chain: "rh" });
  assert.deepEqual(bodies[0].params, { name: "check_coin", arguments: { address: TOKEN, chain: "rh" } });
  assert.match(String(out), /Findings: 2 against/);
});

test("over quota appends the pay line", async () => {
  const { get } = await setup([fx("check_coin_over")]);
  const out = String(await get("check_coin").execute({ address: TOKEN }));
  assert.match(out, /pay per check at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402: 0\.05 USDG on Robinhood Chain or USDC on Base; pay only with the owner's consent\)\. Holding \$TOLL lifts the daily limits: new coins a day Free 10 \/ 1M \$TOLL 100 \/ 5M 500 \/ 20M 2,000/s);
});

test("larp_check waits for a pending read; dev_record works; errors are text", async () => {
  const { get, bodies } = await setup([fx("larp_check_reading"), fx("larp_check"), ok("rec")]);
  assert.match(String(await get("larp_check").execute({ token: TOKEN })), /product found/);
  assert.equal(bodies.length, 2);
  assert.equal(await get("dev_record").execute({ wallet: TOKEN }), "rec");
  assert.equal(bodies[2].params.name, "dev_record");
  assert.match(String(await get("check_coin").execute({ address: "nope" })), /Invalid address/);
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const tools = await toll().getTools({} as any);
  const out = await tools.find((t) => t.name === "check_coin")!.execute({ address: TOKEN });
  assert.ok(String(out).length > 0);
});

test("re-exports Toll and TollError from @tollxyz/sdk", () => {
  assert.equal(Reexported.Toll, Toll);
  assert.equal(Reexported.TollError, TollError);
});

const HOOK = "0x4eb1976978756bd56802d8162f2271844924e0cc";
test("check_hook (11-05): the live description, one call with { address }", async () => {
  const { get, bodies } = await setup([ok("h")]);
  assert.equal(get("check_hook").description, LIVE_DESCRIPTIONS.check_hook);
  assert.ok(get("check_hook").parameters.safeParse({ address: HOOK }).success);
  assert.equal(await get("check_hook").execute({ address: HOOK }), "h");
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [["check_hook", { address: HOOK }]]);
});
