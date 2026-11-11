import { test } from "node:test";
import assert from "node:assert/strict";
import { enforce, MemorySpendStore, spendOf, TollBlockedError, TollPolicyError, USDG, NATIVE, type GuardOptions, type RiskAssessment, type SpendPolicy } from "../src/index.js";

/**
 * 0.5.1 (audit 2026-11-11, PUB-5 / PUB-7): WHAT THE GUARD CANNOT READ IS NOT "NOTHING SPENT".
 *  - an x402 amount it cannot parse ("+5000000", "5e6") was skipped, so per-call, per-day and approval caps all passed
 *    while a client that parses it pays the sum: it now counts as an unknown spend
 *  - a transaction value it cannot read (a JS number above 2^53) counted as zero: unknown too
 *  - with a spend policy set, an unknown spend is now refused by default (it was allowed unless failClosed): caps that
 *    only bind on plain transfers are not caps. onUnknownSpend: "allow" is the opt-out
 *  - transferFrom(from, to, amount): the recipient was read from the AMOUNT word, so an allowlist refused every
 *    transferFrom and never looked at the real recipient
 *  - a coin Toll has not read yet (WARN coin-not-read: "nothing about the coin was checked") passed the default
 *    block-high policy as a medium warning: a buy of an unread coin is refused by default
 */
const FROM = "0x2222222222222222222222222222222222222222";
const SHOP = "0x3333333333333333333333333333333333333333";
const OTHER = "0x7777777777777777777777777777777777777777";
const ROUTER = "0x4444444444444444444444444444444444444444";
const word = (x: bigint | string) => (typeof x === "string" ? x.replace(/^0x/, "").toLowerCase() : x.toString(16)).padStart(64, "0");
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
const ALLOW: RiskAssessment = { action: "ALLOW", warnings: [] };
const isPolicy = (code: string) => (e: unknown) => e instanceof TollPolicyError && e.code === code;

function opts(answer: RiskAssessment, spend: SpendPolicy, extra: GuardOptions = {}): GuardOptions {
  return { fetch: async () => json(answer), sleep: async () => {}, logger: false, spend, store: new MemorySpendStore(), ...extra };
}

test("an x402 amount the guard cannot parse is an unknown spend, not zero", () => {
  for (const amount of ["+5000000", "5e6", "5,000,000", " 5 000 000", "0b101", "-1", "1.5", ""]) {
    const s = spendOf({ chainId: 4663, x402: { accepts: [{ payTo: SHOP, asset: USDG, amount }] } }, null);
    assert.equal(s.unknown, true, JSON.stringify(amount));
    assert.equal(s.outflow[USDG], undefined, JSON.stringify(amount));
  }
  // readable amounts are spend, as before
  const ok = spendOf({ chainId: 4663, x402: { accepts: [{ payTo: SHOP, asset: USDG, amount: "5000000" }] } }, null);
  assert.equal(ok.unknown, false);
  assert.equal(ok.outflow[USDG], 5_000_000n);
  // an entry with no amount at all is unknown too
  assert.equal(spendOf({ chainId: 4663, x402: { accepts: [{ payTo: SHOP, asset: USDG }] } }, null).unknown, true);
});

test("an x402 payment with an unparseable amount is refused under a spend policy", async () => {
  const spend: SpendPolicy = { assets: { [USDG]: { perCall: 1_000_000n } } };
  await assert.rejects(enforce("x402", () => ({ chainId: 4663, x402: { accepts: [{ payTo: SHOP, asset: USDG, amount: "+5000000" }] } }), opts(ALLOW, spend)), isPolicy("unknown-spend"));
});

test("a transaction value that cannot be read is unknown, not zero", () => {
  const s = spendOf({ chainId: 4663, from: FROM, to: SHOP, data: "0x", value: 2 ** 60 as unknown as bigint }, null);
  assert.equal(s.unknown, true);
  assert.equal(s.outflow[NATIVE], undefined);
  assert.equal(spendOf({ chainId: 4663, from: FROM, to: SHOP, data: "0x", value: "not-a-number" as unknown as bigint }, null).unknown, true);
  // no value at all is zero, as before
  assert.equal(spendOf({ chainId: 4663, from: FROM, to: SHOP, data: "0x" }, null).unknown, false);
});

test("with a spend policy, an unknown spend is refused by default; onUnknownSpend allow is the opt-out", async () => {
  const call = { chainId: 4663, from: FROM, to: ROUTER, data: "0x12345678", value: 0n };
  await assert.rejects(enforce("transaction", () => call, opts(ALLOW, {})), isPolicy("unknown-spend"));
  const r = await enforce("transaction", () => call, opts(ALLOW, { onUnknownSpend: "allow" }));
  assert.equal(r.decision, "allowed");
  // without a spend policy nothing changes (no caps were asked for)
  const plain = await enforce("transaction", () => call, { fetch: async () => json(ALLOW), sleep: async () => {}, logger: false });
  assert.equal(plain.decision, "allowed");
});

test("transferFrom: the recipient is the second argument, the amount the third", () => {
  const data = "0x23b872dd" + word(FROM) + word(SHOP) + word(7_000_000n);
  const s = spendOf({ chainId: 4663, from: FROM, to: USDG, data, value: 0n }, null);
  assert.deepEqual(s.to, [SHOP]);
  assert.equal(s.outflow[USDG], 7_000_000n);
});

test("transferFrom with an allowlist: the listed recipient passes, another is refused", async () => {
  const data = (to: string) => "0x23b872dd" + word(FROM) + word(to) + word(1_000n);
  const spend: SpendPolicy = { allow: { to: [SHOP] } };
  const ok = await enforce("transaction", () => ({ chainId: 4663, from: FROM, to: USDG, data: data(SHOP), value: 0n }), opts(ALLOW, spend));
  assert.equal(ok.decision, "allowed");
  await assert.rejects(enforce("transaction", () => ({ chainId: 4663, from: FROM, to: USDG, data: data(OTHER), value: 0n }), opts(ALLOW, spend)), isPolicy("not-allowlisted"));
});

test("a coin Toll has not read yet is refused by default (block-high), allowed only by onWarn allow", async () => {
  const unread: RiskAssessment = { action: "WARN", warnings: [{ code: "coin-not-read", severity: "medium", message: "The coin bought is not read yet. Nothing about the coin was checked." }] };
  const tx = { chainId: 4663, from: FROM, to: ROUTER, data: "0x12345678", value: 1n };
  const base: GuardOptions = { fetch: async () => json(unread), sleep: async () => {}, logger: false };
  await assert.rejects(enforce("transaction", () => tx, base), TollBlockedError);
  assert.equal((await enforce("transaction", () => tx, { ...base, onWarn: "allow" })).decision, "allowed");
  // any other medium warning still goes ahead under the default
  const other: RiskAssessment = { action: "WARN", warnings: [{ code: "recipient-new-wallet", severity: "medium", message: "new wallet" }] };
  assert.equal((await enforce("transaction", () => tx, { ...base, fetch: async () => json(other) })).decision, "allowed");
});
