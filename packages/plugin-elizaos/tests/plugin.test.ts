import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Toll } from "@tollxyz/sdk";
import { tollPlugin, createTollPlugin, extractAddress, extractWallet, formatResult } from "../src/index.js";

const fx = (n: string) => readFileSync(new URL(`../../sdk-js/tests/fixtures/${n}.json`, import.meta.url), "utf8");
const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const SOL = "So11111111111111111111111111111111111111112";

function client(responses: string[]) {
  const bodies: any[] = [];
  const f = async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(r, { status: 200 });
  };
  return { toll: new Toll({ fetch: f, sleep: async () => {} }), bodies };
}
const msg = (text: string): any => ({ entityId: "e", roomId: "r", content: { text } });
const act = (p: any, name: string) => p.actions.find((a: any) => a.name === name);

test("plugin shape", () => {
  assert.equal(tollPlugin.name, "toll");
  assert.deepEqual(tollPlugin.actions!.map((a) => a.name), ["TOLL_CHECK_COIN", "TOLL_LARP_CHECK", "TOLL_DEV_RECORD"]);
  assert.equal(tollPlugin.providers!.length, 1);
  for (const a of tollPlugin.actions!) {
    assert.ok(a.description.length > 40);
    assert.ok(!/\b(scam|rug|safe)\b/i.test(a.description));
    assert.ok(a.examples!.length > 0);
  }
});

test("address extraction", () => {
  assert.deepEqual(extractAddress(`check ${TOKEN} please`), { address: TOKEN });
  assert.deepEqual(extractAddress(`check ${TOKEN} on bsc`), { address: TOKEN, chain: "bsc" });
  assert.deepEqual(extractAddress(`${SOL}`), { address: SOL, chain: "sol" });
  assert.equal(extractAddress("hello there, nothing here"), null);
  assert.equal(extractAddress("0x1234"), null);
  assert.equal(extractWallet(SOL), null);
  assert.equal(extractWallet(`dev ${TOKEN}`)!.wallet, TOKEN);
});

test("validate: needs an address", async () => {
  const a = act(tollPlugin, "TOLL_CHECK_COIN");
  assert.equal(await a.validate({}, msg(`check ${TOKEN}`)), true);
  assert.equal(await a.validate({}, msg("how are you")), false);
  assert.equal(await act(tollPlugin, "TOLL_DEV_RECORD").validate({}, msg(SOL)), false);
});

test("check handler calls callback with Toll's text", async () => {
  const { toll, bodies } = client([fx("check_coin")]);
  const p = createTollPlugin({ client: toll });
  const got: any[] = [];
  const res = await act(p, "TOLL_CHECK_COIN").handler({}, msg(`check ${TOKEN} on robinhood`), undefined, {}, async (c: any) => {
    got.push(c);
    return [];
  });
  assert.equal(res.success, true);
  assert.equal(bodies[0].params.name, "check_coin");
  assert.deepEqual(bodies[0].params.arguments, { address: TOKEN, chain: "rh" });
  assert.match(got[0].text, /Findings: 2 against/);
  assert.deepEqual(got[0].actions, ["TOLL_CHECK_COIN"]);
});

test("over quota appends the pay line", async () => {
  const { toll } = client([fx("check_coin_over")]);
  const p = createTollPlugin({ client: toll });
  const got: any[] = [];
  await act(p, "TOLL_CHECK_COIN").handler({}, msg(TOKEN), undefined, {}, async (c: any) => {
    got.push(c);
    return [];
  });
  assert.match(got[0].text, /pay per check at https:\/\/t0ll\.xyz\/api\/x402\/check\//);
  assert.match(got[0].text, /0\.05 USDG/);
  assert.match(got[0].text, /1M \$TOLL/);
});

test("larp waits through a pending read", async () => {
  const { toll, bodies } = client([fx("larp_check_reading"), fx("larp_check")]);
  const p = createTollPlugin({ client: toll });
  const got: any[] = [];
  const res = await act(p, "TOLL_LARP_CHECK").handler({}, msg(TOKEN), undefined, {}, async (c: any) => {
    got.push(c);
    return [];
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].params.name, "larp_check");
  assert.equal(bodies[0].params.arguments.token, TOKEN);
  assert.equal(res.success, true);
  assert.match(got[0].text, /product found/);
});

test("pending text gives seconds", () => {
  const t = formatResult({ text: "Still reading", paidUrl: null, pending: { retryAfterS: 20 } });
  assert.match(t, /ask again in 20 seconds/);
});

test("dev record calls dev_record", async () => {
  const { toll, bodies } = client([JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Dev record" }] } })]);
  const p = createTollPlugin({ client: toll });
  const res = await act(p, "TOLL_DEV_RECORD").handler({}, msg(`dev ${TOKEN}`));
  assert.equal(res.success, true);
  assert.equal(bodies[0].params.name, "dev_record");
  assert.equal(bodies[0].params.arguments.wallet, TOKEN);
});

test("errors become a failed result, no throw", async () => {
  const { toll } = client([]);
  const p = createTollPlugin({ client: toll });
  const got: any[] = [];
  const res = await act(p, "TOLL_CHECK_COIN").handler({}, msg(TOKEN), undefined, {}, async (c: any) => {
    got.push(c);
    return [];
  });
  assert.equal(res.success, false);
  assert.ok(got[0].text);
});

test("provider adds nothing without an address", async () => {
  const prov = tollPlugin.providers![0];
  const none = await prov.get({} as any, msg("gm"), {} as any);
  assert.equal(none.text, "");
  const some = await prov.get({} as any, msg(`look at ${TOKEN}`), {} as any);
  assert.match(some.text!, new RegExp(TOKEN));
});

test("live smoke (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const p = createTollPlugin();
  const res = await act(p, "TOLL_CHECK_COIN").handler({}, msg(TOKEN));
  assert.equal(res.success, true);
});
