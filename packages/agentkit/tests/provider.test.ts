import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Toll } from "@tollxyz/sdk";
import { TollActionProvider, tollActionProvider } from "../src/index.js";

// AgentKit's decorator fires its own analytics fetch on every call; keep unit tests offline.
before(() => {
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
});

// npm test runs from the package directory.
const fx = (n: string) => readFileSync(resolve(process.cwd(), "../sdk-js/tests/fixtures", `${n}.json`), "utf8");
const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";

function provider(responses: string[]) {
  const bodies: any[] = [];
  const f = async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(r, { status: 200 });
  };
  return { p: tollActionProvider(new Toll({ fetch: f, sleep: async () => {} })), bodies };
}
const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
const getAction = (p: TollActionProvider, suffix: string) => p.getActions({} as any).find((a) => a.name.endsWith(suffix))!;

test("declares six actions with prefixed names and schemas", () => {
  const actions = new TollActionProvider().getActions({} as any);
  assert.deepEqual(
    actions.map((a) => a.name).sort(),
    ["chain_pulse", "check_coin", "dev_record", "fresh_launches", "larp_check", "launch_record"].map((n) => `TollActionProvider_${n}`).sort(),
  );
  for (const a of actions) assert.ok(a.description.length > 30 && a.schema);
});

test("supportsNetwork is true for any network", () => {
  const p = new TollActionProvider();
  assert.equal(p.supportsNetwork({ protocolFamily: "evm", networkId: "base-mainnet" }), true);
  assert.equal(p.supportsNetwork({ protocolFamily: "svm" }), true);
});

test("schemas reject bad input and never offer arc", () => {
  const a = getAction(new TollActionProvider(), "check_coin");
  assert.ok(a.schema.safeParse({ address: TOKEN, chain: "bsc" }).success);
  assert.ok(!a.schema.safeParse({ address: TOKEN, chain: "arc" }).success);
  assert.ok(!a.schema.safeParse({}).success);
  const l = getAction(new TollActionProvider(), "larp_check");
  assert.ok(!l.schema.safeParse({ token: TOKEN, chain: "bsc" }).success);
});

test("check_coin invokes the server tool", async () => {
  const { p, bodies } = provider([fx("check_coin")]);
  const out = await getAction(p, "check_coin").invoke({ address: TOKEN, chain: "rh" });
  assert.equal(bodies[0].params.name, "check_coin");
  assert.deepEqual(bodies[0].params.arguments, { address: TOKEN, chain: "rh" });
  assert.match(out, /Findings: 2 against/);
});

test("over quota appends the pay line", async () => {
  const { p } = provider([fx("check_coin_over")]);
  const out = await getAction(p, "check_coin").invoke({ address: TOKEN });
  assert.match(out, /pay per check at https:\/\/t0ll\.xyz\/api\/x402\/check\/.*\(x402, 0\.05 USDG on Robinhood Chain\) or hold 1M \$TOLL/s);
});

test("larp_check waits while Toll is still reading", async () => {
  const { p, bodies } = provider([fx("larp_check_reading"), fx("larp_check")]);
  const out = await getAction(p, "larp_check").invoke({ token: TOKEN });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].params.name, "larp_check");
  assert.match(out, /product found/);
});

test("dev_record, launch_record, fresh_launches, chain_pulse call their tools", async () => {
  const { p, bodies } = provider([ok("a"), ok("b"), ok("c"), ok("d")]);
  assert.equal(await getAction(p, "dev_record").invoke({ wallet: TOKEN }), "a");
  assert.equal(await getAction(p, "launch_record").invoke({ address: TOKEN }), "b");
  assert.equal(await getAction(p, "fresh_launches").invoke({ limit: 3 }), "c");
  assert.equal(await getAction(p, "chain_pulse").invoke({}), "d");
  assert.deepEqual(bodies.map((b) => b.params.name), ["dev_record", "launch_record", "fresh_launches", "chain_pulse"]);
  assert.deepEqual(bodies[2].params.arguments, { limit: 3 });
});

test("errors come back as text, not a throw", async () => {
  const { p } = provider([]);
  const out = await getAction(p, "check_coin").invoke({ address: TOKEN });
  assert.match(out, /^Toll could not answer/);
  const bad = await getAction(p, "check_coin").invoke({ address: "nope" });
  assert.match(bad, /Invalid address/);
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const out = await getAction(new TollActionProvider(), "chain_pulse").invoke({});
  assert.ok(out.length > 0);
});
