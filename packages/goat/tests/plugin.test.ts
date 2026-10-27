import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Toll } from "@tollxyz/sdk";
import { toll } from "../src/index.js";

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

test("three tools with sharp descriptions and any-chain support", async () => {
  const { plugin, tools } = await setup([]);
  assert.equal(plugin.name, "toll");
  assert.deepEqual(tools.map((t) => t.name).sort(), ["check_coin", "dev_record", "larp_check"]);
  assert.equal(plugin.supportsChain({ type: "evm", id: 8453, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }), true);
  assert.equal(plugin.supportsChain({ type: "solana", nativeCurrency: { name: "Sol", symbol: "SOL", decimals: 9 } }), true);
  const c = tools.find((t) => t.name === "check_coin")!;
  assert.match(c.description, /^Before buying a token on Robinhood Chain, Solana or BSC/);
  for (const t of tools) assert.ok(!/\b(scam|rug|safe)\b/i.test(t.description));
});

test("schemas reject arc and missing address", async () => {
  const { get } = await setup([]);
  const s = get("check_coin").parameters;
  assert.ok(s.safeParse({ address: TOKEN, chain: "bsc" }).success);
  assert.ok(!s.safeParse({ address: TOKEN, chain: "arc" }).success);
  assert.ok(!s.safeParse({}).success);
  assert.ok(!get("larp_check").parameters.safeParse({ token: TOKEN, chain: "bsc" }).success);
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
  assert.match(out, /pay per check at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402, 0\.05 USDG on Robinhood Chain\) or hold 1M \$TOLL/s);
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
