import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Toll, TollError } from "@tollxyz/sdk";
import { tollPlugin, createTollPlugin, extractAddress, extractAgentId, extractJson, extractWallet, formatResult } from "../src/index.js";
import * as Reexported from "../src/index.js";

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
  assert.deepEqual(tollPlugin.actions!.map((a) => a.name), [
    "TOLL_CHECK_COIN",
    "TOLL_PRE_BUY_CHECK",
    "TOLL_CHECK_COINS",
    "TOLL_LARP_CHECK",
    "TOLL_DEV_RECORD",
    "TOLL_WALLET_PRIVACY",
    "TOLL_WALLET_APPROVALS",
    "TOLL_BLOCKLIST",
    "TOLL_LAUNCH_RECORD",
    "TOLL_FRESH_LAUNCHES",
    "TOLL_CHAIN_PULSE",
    "TOLL_CHECK_AGENT",
    "TOLL_FIND_PAID_API",
    "TOLL_CHECK_HOOK",
    "TOLL_CHECK_TX",
    "TOLL_PRESIGN_RISK_REPORT",
    "TOLL_STOCK_TOKEN",
    "TOLL_STOCK_TOKENS",
    "TOLL_FUNDAMENTALS",
    "TOLL_INSIDER_TRADES",
    "TOLL_INSTITUTIONS",
    "TOLL_GUIDANCE",
    "TOLL_STOCK_EVENTS",
    "TOLL_MACRO",
  ]);
  assert.ok(!/Solana|\bBSC\b/.test(tollPlugin.description!));
  assert.equal(tollPlugin.providers!.length, 1);
  for (const a of tollPlugin.actions!) {
    assert.ok(a.description.length > 40);
    assert.ok(!/\b(scam|rug|safe)\b/i.test(a.description));
    assert.ok(a.examples!.length > 0);
    assert.ok(!/Solana|\bBSC\b|\bArc\b/.test(a.description), a.name);
  }
});

test("address extraction", () => {
  assert.deepEqual(extractAddress(`check ${TOKEN} please`), { address: TOKEN });
  assert.deepEqual(extractAddress(`check ${TOKEN} on robinhood`), { address: TOKEN });
  assert.equal(extractAddress(`${SOL}`), null); // Robinhood Chain only
  assert.equal(extractAddress("hello there, nothing here"), null);
  assert.equal(extractAddress("0x1234"), null);
  assert.equal(extractWallet(SOL), null);
  assert.equal(extractWallet(`dev ${TOKEN}`)!.wallet, TOKEN);
});

test("a Solana mint is not an address: the check says Robinhood Chain only and sends nothing", async () => {
  const { toll, bodies } = client([]);
  const p = createTollPlugin({ client: toll });
  assert.equal(await act(p, "TOLL_CHECK_COIN").validate({}, msg(`check ${SOL}`)), false);
  const res = await act(p, "TOLL_CHECK_COIN").handler({}, msg(`check ${SOL}`));
  assert.equal(res.success, false);
  assert.match(res.text, /Robinhood Chain only/);
  assert.equal(bodies.length, 0);
});

test("agent id and JSON extraction", () => {
  assert.equal(extractAgentId("check agent #20030 please"), 20030);
  assert.equal(extractAgentId("agent id 7"), 7);
  assert.equal(extractAgentId("an agent"), null);
  assert.deepEqual(extractJson('sign this? {"to":"0x1","data":"0x"} thanks'), { to: "0x1", data: "0x" });
  assert.equal(extractJson("no json {here"), null);
});

const ok = (text: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });

test("the new actions call their MCP tools with the live argument names", async () => {
  const { toll, bodies } = client(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(ok));
  const p = createTollPlugin({ client: toll });
  const tx = { to: TOKEN, data: "0x", value: "0", from: TOKEN };
  const presign = { version: "erc-presign/1", subject: { type: "calls", chainId: "eip155:4663", calls: [] } };
  const accepts = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:4663" }] };
  const cases: Array<[string, string]> = [
    ["TOLL_WALLET_PRIVACY", `how exposed is ${TOKEN}?`],
    ["TOLL_LAUNCH_RECORD", `launch record for ${TOKEN}`],
    ["TOLL_FRESH_LAUNCHES", "show the newest coins, top 5"],
    ["TOLL_CHAIN_PULSE", "how busy is the chain"],
    ["TOLL_CHECK_AGENT", "check agent #20030"],
    ["TOLL_CHECK_TX", `before I sign: ${JSON.stringify(tx)}`],
    ["TOLL_CHECK_TX", `pay this 402? ${JSON.stringify(accepts)}`],
    ["TOLL_PRESIGN_RISK_REPORT", `report: ${JSON.stringify(presign)}`],
    ["TOLL_STOCK_EVENTS", "any new stock token events, filing only"],
  ];
  for (const [name, text] of cases) {
    const a = act(p, name);
    assert.equal(await a.validate({}, msg(text)), true, name);
    assert.equal((await a.handler({}, msg(text))).success, true, name);
  }
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [
    ["wallet_privacy", { wallet: TOKEN }],
    ["launch_record", { address: TOKEN }],
    ["fresh_launches", { limit: 5 }],
    ["chain_pulse", {}],
    ["check_agent", { id: 20030 }],
    ["check_tx", tx],
    ["check_tx", { x402: accepts }],
    ["presign_risk_report", presign],
    ["stock_events", { kind: "filing" }],
  ]);
  assert.equal(await act(p, "TOLL_CHECK_TX").validate({}, msg(`report: ${JSON.stringify(presign)}`)), false);
});

test("institutions and guidance GET their Markets routes with the key", async () => {
  const calls: Array<{ url: string; key: string | null }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, key: new Headers(init?.headers).get("x-toll-pass") });
    return new Response(JSON.stringify({ ticker: "NVDA" }));
  };
  const p = createTollPlugin({ fetch: f, tollKey: "tk_5" });
  assert.equal(await act(p, "TOLL_INSTITUTIONS").validate({}, msg("top 5 institutional holders of $NVDA")), true);
  assert.equal((await act(p, "TOLL_INSTITUTIONS").handler({}, msg("top 5 institutional holders of $NVDA"))).success, true);
  assert.equal((await act(p, "TOLL_GUIDANCE").handler({}, msg("what guidance did AAPL give?"))).success, true);
  assert.deepEqual(calls, [
    { url: "https://t0ll.xyz/api/markets/institutions/NVDA?limit=5", key: "tk_5" },
    { url: "https://t0ll.xyz/api/markets/guidance/AAPL", key: "tk_5" },
  ]);
});

test("the dev record example names a deployer wallet, not the token", () => {
  const ex = act(tollPlugin, "TOLL_DEV_RECORD").examples[0][0].content.text as string;
  assert.match(ex, /0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc/);
  assert.ok(!ex.includes(TOKEN));
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
  assert.deepEqual(bodies[0].params.arguments, { address: TOKEN });
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
  assert.match(got[0].text, /Holding \$TOLL lifts the daily limits: new coins a day Free 10 \/ 1M \$TOLL 100 \/ 5M 500 \/ 20M 2,000/);
  assert.ok(!/does not lift/.test(got[0].text));
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

test("pending note goes above the closing t0ll.xyz link", () => {
  const link = `Full report: https://t0ll.xyz/check/${TOKEN}?utm_source=mcp`;
  const t = formatResult({ text: `Facts\nStill reading the holders.\n\n${link}`, paidUrl: null, pending: { retryAfterS: 20 } });
  assert.equal(t.split("\n").pop(), link);
  assert.match(t, /ask again in 20 seconds\.\n\nFull report/);
});

test("handler without an address says so and sends nothing", async () => {
  const { toll, bodies } = client([]);
  const p = createTollPlugin({ client: toll });
  const res = await act(p, "TOLL_CHECK_COIN").handler({}, msg("check 0x1234 please"));
  assert.equal(res.success, false);
  assert.match(res.text, /No Robinhood Chain address/);
  assert.equal(bodies.length, 0);
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

test("re-exports Toll and TollError from @tollxyz/sdk", () => {
  assert.equal(Reexported.Toll, Toll);
  assert.equal(Reexported.TollError, TollError);
});

test("TOLL_PRE_BUY_CHECK and TOLL_CHECK_COINS (11-06): buy questions and lists call their tools", async () => {
  const T = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3", U = "0x1111111111111111111111111111111111111111";
  const { toll, bodies } = client([ok("Decision: WAIT"), ok("2 coins")]);
  const p = createTollPlugin({ client: toll });
  const g = act(p, "TOLL_PRE_BUY_CHECK"), l = act(p, "TOLL_CHECK_COINS");
  assert.equal(await g.validate({}, msg(`should I buy ${T}?`)), true);
  assert.equal(await g.validate({}, msg(`what is ${T}?`)), false);
  assert.equal(await l.validate({}, msg(`check ${T}`)), false);
  assert.equal(await l.validate({}, msg(`check ${T} and ${U} and ${T.toUpperCase().replace("0X", "0x")}`)), true);
  assert.equal((await g.handler({}, msg(`should I buy ${T}?`))).success, true);
  assert.equal((await l.handler({}, msg(`check ${T} and ${U}`))).success, true);
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [["pre_buy_check", { address: T }], ["check_coins", { addresses: [T, U] }]]);
});

const HOOK = "0x4eb1976978756bd56802d8162f2271844924e0cc";
test("TOLL_CHECK_HOOK (11-05): a message naming a hook and its address calls check_hook", async () => {
  const { toll, bodies } = client([ok("h")]);
  const p = createTollPlugin({ client: toll });
  const a = act(p, "TOLL_CHECK_HOOK");
  assert.equal(await a.validate({}, msg(`what does the hook ${HOOK} do?`)), true);
  assert.equal(await a.validate({}, msg(`check ${HOOK}`)), false);
  assert.equal((await a.handler({}, msg(`what does the hook ${HOOK} do?`))).success, true);
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [["check_hook", { address: HOOK }]]);
});

test("TOLL_FIND_PAID_API (0.5.0): asks for a paid API, the quoted phrase or the words after 'for' are the query", async () => {
  const { toll, bodies } = client([fx("find_paid_api"), ok("all"), ok("for")]);
  const p = createTollPlugin({ client: toll });
  const a = act(p, "TOLL_FIND_PAID_API");
  assert.equal(await a.validate({}, msg('find a paid API for "stock quotes"')), true);
  assert.equal(await a.validate({}, msg("which x402 endpoints can I buy?")), true);
  assert.equal(await a.validate({}, msg(`check ${TOKEN}`)), false);
  const r = await a.handler({}, msg('find a paid API for "stock quotes"'));
  assert.equal(r.success, true);
  assert.match(r.text, /Paid APIs on Robinhood Chain/);
  await a.handler({}, msg("list the x402 endpoints"));
  await a.handler({}, msg("any paid apis for weather data?"));
  assert.deepEqual(bodies.map((b) => [b.params.name, b.params.arguments]), [
    ["find_paid_api", { query: "stock quotes" }],
    ["find_paid_api", {}],
    ["find_paid_api", { query: "weather data" }],
  ]);
  assert.equal(Reexported.paidApiQueryOf("nothing here"), undefined);
});

const WALLET = "0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc";
function restClient(replies: Array<{ status?: number; body: string }>) {
  const calls: Array<{ url: string; body: any }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = replies.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(r.body, { status: r.status ?? 200 });
  };
  return { toll: new Toll({ fetch: f, sleep: async () => {} }), calls };
}
const LIST = JSON.stringify({
  name: "Toll blocklist",
  chain: "robinhood",
  chain_id: 4663,
  generated_at: "2026-11-09T00:00:00Z",
  count: 2,
  sources: {},
  license: "CC-BY-4.0",
  docs: "https://t0ll.xyz/blocklist",
  note: "",
  reasons: { lp_pulled: "liquidity was pulled" },
  entries: [
    { address: "0x1111111111111111111111111111111111111111", kind: "token", chain: 4663, symbol: "OLD", reasons: ["lp_pulled"], first_seen: "2026-11-01T00:00:00Z", last_confirmed: "2026-11-02T00:00:00Z", evidence: "https://t0ll.xyz/c/0x1111", tx: null },
    { address: "0x2222222222222222222222222222222222222222", kind: "token", chain: 4663, symbol: null, reasons: ["lp_pulled"], first_seen: "2026-11-05T00:00:00Z", last_confirmed: "2026-11-08T00:00:00Z", evidence: "https://t0ll.xyz/c/0x2222", tx: "0xabc" },
  ],
  changelog: [],
});

test("0.4.0 TOLL_WALLET_APPROVALS: needs an approvals word and a wallet; calls wallet_approvals", async () => {
  const { toll, calls } = restClient([{ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "2 approvals" }] } }) }]);
  const p = createTollPlugin({ client: toll });
  const a = act(p, "TOLL_WALLET_APPROVALS");
  assert.equal(await a.validate({}, msg(`what approvals has ${WALLET} given?`)), true);
  assert.equal(await a.validate({}, msg(`revoke anything on ${WALLET}?`)), true);
  assert.equal(await a.validate({}, msg(`check ${WALLET}`)), false);
  assert.equal(await a.validate({}, msg("what approvals do I have?")), false);
  const res = await a.handler({}, msg(`list the allowances of ${WALLET}`));
  assert.equal(res.success, true);
  assert.equal(res.text, "2 approvals");
  assert.deepEqual([calls[0].body.params.name, calls[0].body.params.arguments], ["wallet_approvals", { wallet: WALLET }]);
});

test("0.4.0 TOLL_BLOCKLIST: looks an address up, or lists the newest entries; never calls a coin clear", async () => {
  const { toll, calls } = restClient([{ body: LIST }, { body: LIST }, { body: LIST }]);
  const p = createTollPlugin({ client: toll });
  const a = act(p, "TOLL_BLOCKLIST");
  assert.equal(await a.validate({}, msg("is 0x1111111111111111111111111111111111111111 on the blocklist?")), true);
  assert.equal(await a.validate({}, msg("show me the block list")), true);
  assert.equal(await a.validate({}, msg(`check ${TOKEN}`)), false);
  const hit = await a.handler({}, msg("is 0x1111111111111111111111111111111111111111 blocklisted?"));
  assert.equal(hit.success, true);
  assert.match(hit.text, /0x1111111111111111111111111111111111111111 is listed:\n0x1111111111111111111111111111111111111111 \(token, symbol "OLD"\) \| reasons: lp_pulled \(liquidity was pulled\)/);
  const miss = await a.handler({}, msg(`is ${TOKEN} on the blocklist?`));
  assert.match(miss.text, /is not on the list\. A coin that is not listed is not cleared/);
  const all = await a.handler({}, msg("what's new on the blocklist?"));
  assert.match(all.text, /2 entries, generated 2026-11-09T00:00:00Z/);
  assert.ok(all.text.indexOf("0x2222") < all.text.indexOf("0x1111"), "newest first");
  assert.match(all.text, /tx: 0xabc/);
  assert.ok(calls.every((c) => c.url === "https://t0ll.xyz/api/blocklist"));
});

test("0.4.0 TOLL_CHECK_TX passes ticket through", async () => {
  const { toll, calls } = restClient([{ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ALLOW" }] } }) }]);
  const p = createTollPlugin({ client: toll });
  await act(p, "TOLL_CHECK_TX").handler({}, msg(`check before I sign: {"to":"${TOKEN}","data":"0x","value":"0","from":"${WALLET}","ticket":true}`));
  assert.deepEqual(calls[0].body.params.arguments, { to: TOKEN, data: "0x", value: "0", from: WALLET, ticket: {} });
});
