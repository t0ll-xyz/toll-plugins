import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkHookrCalls,
  guardHookr,
  hookrCallsOf,
  isHookrCall,
  TollBlockedError,
  TollUnavailableError,
  type GuardReport,
  type HookrCall,
  type HookrGuardOptions,
  type RiskAssessment,
} from "../src/index.js";

/**
 * guardHookr: every unsigned call a Hookr builder returns goes through Toll's check before the wallet sees it.
 * The SDK here is a stand-in with the shapes hookr-sdk 1.7.0's README shows (sync builders returning { to, data,
 * value? }, an array for approvals, a quote that is read and never signed). No network: Toll is a mock fetch.
 */
const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8")) as RiskAssessment;
const FROM = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x54f79a21c71071685369013fe12d7f6cd2528b5b";

type Sent = { url: string; body: Record<string, unknown> };
type R = Response | (() => Response);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
function opts(responses: R[], extra: HookrGuardOptions = {}) {
  const sent: Sent[] = [];
  const logs: string[] = [];
  const reports: GuardReport[] = [];
  const f = async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more mock responses");
    return typeof r === "function" ? r() : r;
  };
  const o: HookrGuardOptions = { fetch: f, sleep: async () => {}, logger: (x) => logs.push(x), onReport: (r) => void reports.push(r), from: FROM, ...extra };
  return { o, sent, logs, reports };
}

/** a stand-in for hookr-sdk: the builders are synchronous, as in the real package */
function fakeSdk() {
  const built: string[] = [];
  return {
    built,
    ROBINHOOD_CHAIN_ID: 4663,
    quoterAbi: [{ type: "function", name: "quote" }],
    buildSwap(_manifest: unknown, swap: { amountIn: bigint }): HookrCall { built.push("buildSwap"); return { to: ROUTER, data: "0xabcdef01", value: swap.amountIn }; },
    buildAgentGateLink(agentId: bigint): HookrCall { built.push("buildAgentGateLink"); return { to: ROUTER, data: "0x12345678" + agentId.toString(16).padStart(64, "0") }; },
    buildApprovals(): HookrCall[] { built.push("buildApprovals"); return [{ to: TOKEN, data: "0x095ea7b3" }, { to: TOKEN, data: "0x095ea7b4" }]; },
    buildQuote(): HookrCall { built.push("buildQuote"); return { to: ROUTER, data: "0xaaaaaaaa" }; },
    buildPredictToken(): string { built.push("buildPredictToken"); return TOKEN; },
    readPool(id: string) { return { id, fee: 3000 }; },
    swapAllowance: (x: bigint) => x * 2n,
  };
}

test("a built call is sent to Toll with the signer, the chain and its value, and comes back unchanged", async () => {
  const sdk = fakeSdk();
  const t = opts([json(fx("allow"))]);
  const call = await guardHookr(sdk, t.o).buildSwap({}, { amountIn: 10n ** 15n });
  assert.deepEqual(call, { to: ROUTER, data: "0xabcdef01", value: 10n ** 15n });
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].url, "https://t0ll.xyz/api/tx/check");
  assert.deepEqual(t.sent[0].body, { chainId: 4663, from: FROM, to: ROUTER, data: "0xabcdef01", value: "1000000000000000" });
  assert.equal(t.reports[0].decision, "allowed");
  assert.equal(t.reports[0].basis, "ALLOW");
});

test("BLOCK: the builder's call never reaches the wallet", async () => {
  const sdk = fakeSdk();
  const t = opts([json(fx("block"))]);
  let signed = 0;
  await assert.rejects(async () => {
    const call = await guardHookr(sdk, t.o).buildSwap({}, { amountIn: 1n });
    signed++;                                             // what a wallet.sendTransaction(call) would be
    return call;
  }, TollBlockedError);
  assert.equal(signed, 0);
  assert.deepEqual(sdk.built, ["buildSwap"]);
  assert.equal(t.reports[0].decision, "blocked");
});

test("several calls from one builder are checked in order, and the first refusal stops the rest", async () => {
  const sdk = fakeSdk();
  const ok = opts([json(fx("allow")), json(fx("allow"))]);
  const both = await guardHookr(sdk, ok.o).buildApprovals();
  assert.equal(both.length, 2);
  assert.deepEqual(ok.sent.map((s) => s.body.data), ["0x095ea7b3", "0x095ea7b4"]);
  const bad = opts([json(fx("block")), json(fx("allow"))]);
  await assert.rejects(guardHookr(sdk, bad.o).buildApprovals(), TollBlockedError);
  assert.equal(bad.sent.length, 1);                       // the second call was never asked about: nothing after a block is signed
});

test("buildQuote is not wrapped (it is read, never signed), and reads and constants pass through untouched", async () => {
  const sdk = fakeSdk();
  const t = opts([]);
  const g = guardHookr(sdk, t.o);
  const q = g.buildQuote();
  assert.deepEqual(q, { to: ROUTER, data: "0xaaaaaaaa" });      // returned at once, not a promise
  assert.equal(g.ROBINHOOD_CHAIN_ID, 4663);
  assert.equal(g.quoterAbi, sdk.quoterAbi);
  assert.deepEqual(g.readPool("0x1"), { id: "0x1", fee: 3000 });
  assert.equal(g.swapAllowance(5n), 10n);
  assert.equal(t.sent.length, 0);
});

test("a builder result with no call in it is returned as it is, and Toll is not asked", async () => {
  const sdk = fakeSdk();
  const t = opts([]);
  assert.equal(await guardHookr(sdk, t.o).buildPredictToken(), TOKEN);
  assert.equal(t.sent.length, 0);
});

test("skip leaves a named builder unwrapped", async () => {
  const sdk = fakeSdk();
  const t = opts([]);
  const g = guardHookr(sdk, { ...t.o, skip: ["buildAgentGateLink"] });
  assert.deepEqual(g.buildAgentGateLink(7n) as unknown, { to: ROUTER, data: "0x12345678" + "7".padStart(64, "0") });
  assert.equal(t.sent.length, 0);
});

test("Toll unreachable: fail-closed by default, the call is not returned", async () => {
  const sdk = fakeSdk();
  const t = opts([json({ error: "down" }, 503)]);
  await assert.rejects(guardHookr(sdk, t.o).buildSwap({}, { amountIn: 1n }), TollUnavailableError);
  const open = opts([json({ error: "down" }, 503)], { failOpen: true });
  const call = await guardHookr(sdk, open.o).buildSwap({}, { amountIn: 1n });
  assert.equal(call.to, ROUTER);
  assert.equal(open.reports[0].basis, "unavailable");
  assert.ok(open.logs.some((l) => /NOT checked/i.test(l)));
});

test("a call built for another chain is not sent to Toll: reported as not checked, and refused under onUnsupported block or strict", async () => {
  const sdk = fakeSdk();
  const t = opts([], { chainId: 143 });
  const call = await guardHookr(sdk, t.o).buildSwap({}, { amountIn: 1n });
  assert.equal(call.to, ROUTER);
  assert.equal(t.sent.length, 0);
  assert.equal(t.reports[0].basis, "unsupported");
  assert.equal(t.reports[0].assessment, null);
  for (const extra of [{ onUnsupported: "block" as const }, { strict: true }]) {
    const b = opts([], { chainId: 143, ...extra });
    await assert.rejects(guardHookr(sdk, b.o).buildSwap({}, { amountIn: 1n }), TollUnavailableError);
    assert.equal(b.sent.length, 0);
  }
});

test("checkHookrCalls reads what Hookr's MCP returns ({ calls: [...] }) and one bare call", async () => {
  const mcp = { tool: "hookr_build_claim", wallet: FROM, calls: [{ to: ROUTER, data: "0x4e71d92d", value: "0" }] };
  const t = opts([json(fx("allow")), json(fx("allow"))]);
  assert.equal(await checkHookrCalls(mcp, t.o), mcp);
  assert.deepEqual(t.sent[0].body, { chainId: 4663, from: FROM, to: ROUTER, data: "0x4e71d92d", value: "0" });
  const one = { to: ROUTER, data: "0x" };
  assert.equal(await checkHookrCalls(one, t.o), one);
  assert.equal(t.sent.length, 2);
});

test("from can be a function, a missing or malformed from is left out, and onCall sees each call with its report", async () => {
  const sdk = fakeSdk();
  const seen: Array<[string, string]> = [];
  const t = opts([json(fx("allow")), json(fx("allow"))], { from: () => FROM, onCall: (c, r) => void seen.push([c.data, r.basis]) });
  await guardHookr(sdk, t.o).buildAgentGateLink(1n);
  assert.equal(t.sent[0].body.from, FROM);
  assert.deepEqual(seen, [["0x12345678" + "1".padStart(64, "0"), "ALLOW"]]);
  const none = opts([json(fx("allow"))], { from: "not-an-address" });
  await guardHookr(sdk, none.o).buildAgentGateLink(1n);
  assert.equal("from" in none.sent[0].body, false);
  // a throwing onCall never changes the decision
  const boom = opts([json(fx("allow"))], { onCall: () => { throw new Error("hook failed"); } });
  assert.equal((await guardHookr(sdk, boom.o).buildSwap({}, { amountIn: 1n })).to, ROUTER);
});

test("what counts as a call", () => {
  assert.equal(isHookrCall({ to: ROUTER, data: "0x" }), true);
  assert.equal(isHookrCall({ to: ROUTER, data: "0xabc" }), false);            // odd hex
  assert.equal(isHookrCall({ to: "0x123", data: "0x" }), false);
  assert.equal(isHookrCall({ to: ROUTER }), false);
  assert.equal(isHookrCall([{ to: ROUTER, data: "0x" }]), false);
  assert.equal(isHookrCall(null), false);
  assert.deepEqual(hookrCallsOf("0xabc"), []);
  assert.deepEqual(hookrCallsOf({ calls: [{ to: ROUTER, data: "0x" }, { nope: 1 }] }), [{ to: ROUTER, data: "0x" }]);
  assert.deepEqual(hookrCallsOf([{ to: ROUTER, data: "0x" }, 5]), [{ to: ROUTER, data: "0x" }]);
});

test("the wrapped builder keeps its `this`, and the same wrapper is returned each time", async () => {
  const sdk = { base: ROUTER, buildThing(this: { base: string }): HookrCall { return { to: this.base, data: "0x" }; } };
  const t = opts([json(fx("allow"))]);
  const g = guardHookr(sdk, t.o);
  assert.equal(g.buildThing, g.buildThing);
  assert.equal((await g.buildThing()).to, ROUTER);
});
