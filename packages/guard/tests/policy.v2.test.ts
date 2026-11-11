import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enforce,
  MemorySpendStore,
  NATIVE,
  TollBlockedError,
  TollPolicyError,
  UNLIMITED,
  USDG,
  type GuardOptions,
  type GuardReport,
  type RiskAssessment,
  type SpendPolicy, TollUnavailableError } from "../src/index.js";

const RH = 4663;
const FROM = "0x2222222222222222222222222222222222222222";
const SHOP = "0x000000000000000000000000000000000000dEaD";
const ROUTER = "0x4444444444444444444444444444444444444444";
const COIN = "0x5555555555555555555555555555555555555555";
const SIM_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const word = (x: bigint | string) => (typeof x === "string" ? x.replace(/^0x/, "").toLowerCase() : x.toString(16)).padStart(64, "0");
const usdgTransfer = (to: string, amt: bigint) => ({ chainId: RH, from: FROM, to: USDG, data: "0xa9059cbb" + word(to) + word(amt), value: 0n });
const usdgApprove = (spender: string, amt: bigint) => ({ chainId: RH, from: FROM, to: USDG, data: "0x095ea7b3" + word(spender) + word(amt), value: 0n });
const ALLOW: RiskAssessment = { action: "ALLOW", warnings: [] };
const withSim = (deltas: Array<[string, string, bigint]>): RiskAssessment => ({
  action: "ALLOW",
  warnings: [],
  "x-toll": { simulation: { status: "success", deltas: deltas.map(([token, holder, d]) => ({ token, holder, delta: d.toString() })), approvals: [] } },
});
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

function opts(answers: Array<RiskAssessment | "down">, spend: SpendPolicy, extra: GuardOptions = {}) {
  let calls = 0;
  const reports: GuardReport[] = [];
  const o: GuardOptions = {
    fetch: async () => {
      calls++;
      const a = answers.shift();
      if (a === undefined) throw new Error("no more mock answers");
      if (a === "down") throw new TypeError("fetch failed");
      return json(a);
    },
    sleep: async () => {},
    logger: false,
    onReport: (r) => void reports.push(r),
    spend,
    store: new MemorySpendStore(),
    ...extra,
  };
  return { o, reports, calls: () => calls };
}

const isPolicy = (code: string) => (e: unknown) => e instanceof TollPolicyError && e.code === code && e instanceof TollBlockedError;

test("off the allowlist: blocked before Toll is called", async () => {
  const t = opts([ALLOW], { allow: { to: [SHOP] } });
  await assert.rejects(enforce("transaction", () => usdgTransfer(ROUTER, 1n), t.o), isPolicy("not-allowlisted"));
  assert.equal(t.calls(), 0);
  assert.equal(t.reports.length, 1);
  assert.equal(t.reports[0].decision, "blocked");
  assert.equal(t.reports[0].basis, "policy");
  assert.equal(t.reports[0].policy, "not-allowlisted");
  // on the list (any case): goes to Toll and through
  const ok = opts([ALLOW], { allow: { to: [SHOP.toUpperCase().replace("0X", "0x")] } });
  assert.equal((await enforce("transaction", () => usdgTransfer(SHOP, 1n), ok.o)).decision, "allowed");
  assert.equal(ok.calls(), 1);
  // a spender off the list
  const sp = opts([ALLOW], { allow: { spender: [ROUTER] } });
  await assert.rejects(enforce("transaction", () => usdgApprove(SHOP, 1n), sp.o), isPolicy("not-allowlisted"));
  assert.equal(sp.calls(), 0);
});

test("a cap blocks a buy, not a sell", async () => {
  const spend: SpendPolicy = { assets: { [NATIVE]: { perCall: 10n ** 15n } } };
  const buy = { chainId: RH, from: FROM, to: ROUTER, data: "0x12345678", value: 10n ** 16n };
  const b = opts([withSim([[SIM_ETH, FROM, -(10n ** 16n)], [COIN, FROM, 10n ** 24n]])], spend);
  await assert.rejects(enforce("transaction", () => buy, b.o), isPolicy("cap-per-call"));
  assert.equal(b.reports[0].basis, "policy");
  assert.equal(b.reports[0].assessment?.action, "ALLOW");
  const sell = { chainId: RH, from: FROM, to: ROUTER, data: "0x12345678", value: 0n };
  const s = opts([withSim([[COIN, FROM, -(10n ** 24n)], [SIM_ETH, FROM, 10n ** 16n]])], spend);
  assert.equal((await enforce("transaction", () => sell, s.o)).decision, "allowed");
});

test("approval above the amount passes with approvalRef; the human sees the amount", async () => {
  const seen: unknown[] = [];
  const spend: SpendPolicy = {
    approveAbove: { [USDG]: 10_000_000n },
    approve: async (r) => (seen.push(r), { approved: true, approvalRef: "ticket-42" }),
  };
  const t = opts([ALLOW], spend);
  const r = await enforce("transaction", () => usdgTransfer(SHOP, 25_000_000n), t.o);
  assert.equal(r.decision, "allowed");
  assert.equal(r.spend?.approvalRef, "ticket-42");
  assert.equal((seen[0] as { over: Array<{ asset: string; amount: bigint }> }).over[0].amount, 25_000_000n);
  // under the threshold: no approval asked
  const u = opts([ALLOW], spend);
  await enforce("transaction", () => usdgTransfer(SHOP, 1_000_000n), u.o);
  assert.equal(seen.length, 1);
});

test("a denied approval: approval-denied, and its day reservation is released", async () => {
  const store = new MemorySpendStore();
  const spend: SpendPolicy = { assets: { [USDG]: { perDay: 30_000_000n } }, approveAbove: { [USDG]: 10_000_000n }, approve: async () => ({ approved: false }) };
  const t = opts([ALLOW], spend, { store });
  await assert.rejects(enforce("transaction", () => usdgTransfer(SHOP, 25_000_000n), t.o), isPolicy("approval-denied"));
  // the whole day is still free
  const day = Date.now() - (Date.now() % 86_400_000);
  assert.equal((await store.reserve(`day:${USDG}`, 30_000_000n, 30_000_000n, day)).ok, true);
  // no approve function at all: denied too
  const n = opts([ALLOW], { approveAbove: { [USDG]: 1n } });
  await assert.rejects(enforce("transaction", () => usdgTransfer(SHOP, 2n), n.o), isPolicy("approval-denied"));
});

test("caps hold when Toll is unavailable (local decode of native and USDG)", async () => {
  const spend: SpendPolicy = { assets: { [USDG]: { perCall: 5_000_000n, perDay: 8_000_000n }, [NATIVE]: { perCall: 10n } } };
  const t = opts(["down", "down", "down", "down"], spend, { failOpen: true });
  await assert.rejects(enforce("transaction", () => usdgTransfer(SHOP, 6_000_000n), t.o), isPolicy("cap-per-call"));
  assert.equal(t.reports[0].basis, "policy");
  const r = await enforce("transaction", () => usdgTransfer(SHOP, 5_000_000n), t.o);
  assert.equal(r.decision, "allowed");
  assert.equal(r.basis, "unavailable");
  assert.equal(r.spend?.reservations.length, 1);
  await assert.rejects(enforce("transaction", () => usdgTransfer(SHOP, 4_000_000n), t.o), isPolicy("cap-per-day"));
  await assert.rejects(enforce("transaction", () => ({ chainId: RH, from: FROM, to: SHOP, data: "0x", value: 11n }), t.o), isPolicy("cap-per-call"));
  // an unlimited approve is over any per-call cap
  const a = opts(["down"], spend, { failOpen: true });
  await assert.rejects(enforce("transaction", () => usdgApprove(ROUTER, UNLIMITED), a.o), isPolicy("cap-per-call"));
  // 0.6.0: without failOpen, Toll being down refuses the request before the caps are reached
  const c = opts(["down"], spend);
  await assert.rejects(enforce("transaction", () => usdgTransfer(SHOP, 1n), c.o), TollUnavailableError);
});

test("unknown spend: blocked by default (0.6.0) and under failClosed; onUnknownSpend allow lets it through", async () => {
  const call = { chainId: RH, from: FROM, to: ROUTER, data: "0x12345678", value: 0n };
  const t = opts(["down"], {}, { failClosed: true, failOpen: true });
  await assert.rejects(enforce("transaction", () => call, t.o), isPolicy("unknown-spend"));
  const d = opts(["down"], {}, { failOpen: true });
  await assert.rejects(enforce("transaction", () => call, d.o), isPolicy("unknown-spend"));
  const a2 = opts(["down"], { onUnknownSpend: "allow" }, { failOpen: true });
  assert.equal((await enforce("transaction", () => call, a2.o)).decision, "allowed");
  // onUnknownSpend wins over failClosed
  const w = opts(["down"], { onUnknownSpend: "allow" }, { failClosed: true, failOpen: true });
  assert.equal((await enforce("transaction", () => call, w.o)).decision, "allowed");
  // a simulation read: known, so failClosed lets it go
  const s = opts([withSim([[COIN, FROM, -1n]])], {}, { failClosed: true });
  assert.equal((await enforce("transaction", () => call, s.o)).decision, "allowed");
});

test("a WARN under block-high is still blocked within caps", async () => {
  const warn: RiskAssessment = { action: "WARN", warnings: [{ code: "w", severity: "high", message: "w" }] };
  const t = opts([warn], { assets: { [USDG]: { perCall: 10n ** 12n } } });
  await assert.rejects(enforce("transaction", () => usdgTransfer(SHOP, 1n), t.o), (e: unknown) => e instanceof TollBlockedError && !(e instanceof TollPolicyError));
  assert.equal(t.reports[0].basis, "WARN");
  assert.equal(t.reports.length, 1);
});

test("without spend, nothing changes: no spend field on the report", async () => {
  const t = opts([ALLOW], {});
  delete (t.o as { spend?: unknown }).spend;
  const r = await enforce("transaction", () => usdgTransfer(SHOP, 10n ** 30n), t.o);
  assert.equal(r.decision, "allowed");
  assert.equal(r.spend, undefined);
});
