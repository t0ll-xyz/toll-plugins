import { test } from "node:test";
import assert from "node:assert/strict";
import { spendOf, DEFAULT_SPEND_ASSETS, NATIVE, UNLIMITED, USDG, WETH, type RiskAssessment } from "../src/index.js";

const FROM = "0x2222222222222222222222222222222222222222";
const TO = "0x000000000000000000000000000000000000dEaD";
const ROUTER = "0x4444444444444444444444444444444444444444";
const COIN = "0x5555555555555555555555555555555555555555";
const SIM_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const word = (x: bigint | string) => (typeof x === "string" ? x.replace(/^0x/, "").toLowerCase() : x.toString(16)).padStart(64, "0");
const transfer = (to: string, amt: bigint) => "0xa9059cbb" + word(to) + word(amt);
const approve = (spender: string, amt: bigint) => "0x095ea7b3" + word(spender) + word(amt);
const sim = (deltas: Array<[string, string, bigint]>, approvals: unknown[] = []): RiskAssessment => ({
  action: "ALLOW",
  warnings: [],
  "x-toll": { simulation: { status: "success", deltas: deltas.map(([token, holder, d]) => ({ token, holder, delta: d.toString() })), approvals } },
});

test("spend assets default: native, WETH and USDG on Robinhood Chain", () => {
  assert.deepEqual([...DEFAULT_SPEND_ASSETS], [NATIVE, WETH, USDG]);
  assert.equal(USDG, "0x5fc5360d0400a0fd4f2af552add042d716f1d168");
});

test("native value is spend", () => {
  const s = spendOf({ chainId: 4663, from: FROM, to: TO, data: "0x", value: 10n ** 16n }, null);
  assert.equal(s.outflow[NATIVE], 10n ** 16n);
  assert.equal(s.unknown, false);
  assert.deepEqual(s.to, [TO.toLowerCase()]);
});

test("a USDG transfer is spend (local decode, no Toll answer needed)", () => {
  const s = spendOf({ chainId: 4663, from: FROM, to: USDG, data: transfer(TO, 5_000_000n), value: 0n }, null);
  assert.equal(s.outflow[USDG], 5_000_000n);
  assert.equal(s.outflow[NATIVE], undefined);
  assert.equal(s.unknown, false);
  assert.deepEqual(s.to, [TO.toLowerCase()]);
});

test("selling a non-spend coin is not spend", () => {
  // a plain transfer of the coin: known, nothing capped
  const t = spendOf({ chainId: 4663, from: FROM, to: COIN, data: transfer(ROUTER, 10n ** 24n), value: 0n }, null);
  assert.deepEqual(t.outflow, {});
  assert.equal(t.unknown, false);
  // a router sell: the simulation shows only the coin leaving (ETH comes in)
  const s = spendOf({ chainId: 4663, from: FROM, to: ROUTER, data: "0x12345678" + word(1n), value: 0n }, sim([[COIN, FROM, -(10n ** 24n)], [SIM_ETH, FROM, 10n ** 15n]]));
  assert.deepEqual(s.outflow, {});
  assert.equal(s.unknown, false);
  assert.equal(s.simulated, true);
  // the same call without a simulation cannot be read locally
  assert.equal(spendOf({ chainId: 4663, from: FROM, to: ROUTER, data: "0x12345678" + word(1n), value: 0n }, null).unknown, true);
});

test("a sim outflow beats the declared amount (x-toll.simulation.deltas)", () => {
  const s = spendOf({ chainId: 4663, from: FROM, to: ROUTER, data: "0x12345678", value: 10n ** 15n }, sim([[SIM_ETH, FROM, -(10n ** 15n)], [USDG, FROM, -7_000_000n], [USDG, ROUTER, 7_000_000n]]));
  assert.equal(s.outflow[NATIVE], 10n ** 15n);
  assert.equal(s.outflow[USDG], 7_000_000n);
  // declared 1 USDG, simulated 9 USDG leave: 9 counts
  const t = spendOf({ chainId: 4663, from: FROM, to: USDG, data: transfer(TO, 1_000_000n), value: 0n }, sim([[USDG, FROM, -9_000_000n]]));
  assert.equal(t.outflow[USDG], 9_000_000n);
  // a simulation that was not read leaves the local decode in charge
  const n = spendOf({ chainId: 4663, from: FROM, to: USDG, data: transfer(TO, 1_000_000n), value: 0n }, { action: "ALLOW", warnings: [], "x-toll": { simulation: { status: "not-read", why: "busy" } } });
  assert.equal(n.outflow[USDG], 1_000_000n);
  assert.equal(n.simulated, false);
});

test("an unlimited USDG approve = infinite per-call; spender listed", () => {
  const s = spendOf({ chainId: 4663, from: FROM, to: USDG, data: approve(ROUTER, UNLIMITED), value: 0n }, null);
  assert.equal(s.approvals[USDG], UNLIMITED);
  assert.deepEqual(s.spender, [ROUTER.toLowerCase()]);
  assert.equal(s.unknown, false);
  // the simulation's approvals count too (null amount = unlimited)
  const t = spendOf({ chainId: 4663, from: FROM, to: ROUTER, data: "0x12345678", value: 0n }, sim([], [{ token: USDG, owner: FROM, spender: ROUTER, amount: null, kind: "erc20" }]));
  assert.equal(t.approvals[USDG], UNLIMITED);
});

test("an x402 exact amount counts against its payTo", () => {
  const s = spendOf({ x402: { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:4663", asset: USDG, amount: "50000", payTo: TO }] } }, null);
  assert.equal(s.outflow[USDG], 50_000n);
  assert.deepEqual(s.payTo, [TO.toLowerCase()]);
  assert.equal(s.items[0].payTo, TO.toLowerCase());
  // v1 maxAmountRequired; a payment in another asset is not spend
  const v1 = spendOf({ x402: { accepts: [{ scheme: "exact", asset: COIN, maxAmountRequired: "9", payTo: TO }] } }, null);
  assert.deepEqual(v1.outflow, {});
});

test("an EIP-2612 permit for USDG is an approval; a sign-in message is no spend", () => {
  const td = { domain: { name: "USDG", chainId: 4663, verifyingContract: USDG }, types: {}, primaryType: "Permit", message: { owner: FROM, spender: ROUTER, value: "123", nonce: "0", deadline: "9" } };
  assert.equal(spendOf({ typedData: td }, null).approvals[USDG], 123n);
  const m = spendOf({ message: { kind: "personal_sign", data: "0x6869" } }, null);
  assert.deepEqual(m.outflow, {});
  assert.equal(m.unknown, false);
});

test("custom asset list: only listed assets are spend", () => {
  const s = spendOf({ chainId: 4663, from: FROM, to: COIN, data: transfer(TO, 3n), value: 1n }, null, [COIN]);
  assert.equal(s.outflow[COIN.toLowerCase()], 3n);
  assert.equal(s.outflow[NATIVE], undefined);
});
