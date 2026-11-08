import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guardEthers,
  guardViem,
  MemorySpendStore,
  NATIVE,
  preview,
  TollPolicyError,
  type GuardOptions,
  type GuardReport,
  type RiskAssessment,
  type SpendPolicy,
} from "../src/index.js";

const RH = 4663;
const FROM = "0x2222222222222222222222222222222222222222";
const TO = "0x000000000000000000000000000000000000dEaD";
const ETH = 10n ** 16n;
const ALLOW: RiskAssessment = { action: "ALLOW", warnings: [] };
const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });

function opts(spend: SpendPolicy, extra: GuardOptions = {}) {
  let calls = 0;
  const reports: GuardReport[] = [];
  const o: GuardOptions = {
    fetch: async () => (calls++, json(ALLOW)),
    sleep: async () => {},
    logger: false,
    onReport: (r) => void reports.push(r),
    spend,
    store: new MemorySpendStore(),
    ...extra,
  };
  return { o, reports, calls: () => calls };
}

function fakeViem(fail: { on: boolean }) {
  const sent: unknown[] = [];
  const client: Record<string, any> = {
    chain: { id: RH },
    account: { address: FROM, type: "json-rpc" },
    extend: () => client,
    request: async () => "0x",
    sendTransaction: async (a: unknown) => {
      if (fail.on) throw new Error("nonce too low");
      sent.push(a);
      return "0xhash";
    },
  };
  return { client, sent };
}

test("a send failure releases the reservation; a sent one stays counted", async () => {
  const fail = { on: true };
  const { client, sent } = fakeViem(fail);
  const t = opts({ assets: { [NATIVE]: { perDay: ETH } } });
  const g = guardViem(client, t.o);
  await assert.rejects(g.sendTransaction({ to: TO, value: ETH }), /nonce too low/);
  fail.on = false;
  assert.equal(await g.sendTransaction({ to: TO, value: ETH }), "0xhash");
  assert.equal(sent.length, 1);
  // the day is now used: one more wei is over
  await assert.rejects(g.sendTransaction({ to: TO, value: 1n }), (e: unknown) => e instanceof TollPolicyError && e.code === "cap-per-day");
});

test("a send failure releases the reservation (ethers signer)", async () => {
  let fail = true;
  const signer = {
    provider: { getNetwork: async () => ({ chainId: 4663n }) },
    getAddress: async () => FROM,
    sendTransaction: async () => {
      if (fail) throw new Error("rejected");
      return { hash: "0xhash" };
    },
  };
  const t = opts({ assets: { [NATIVE]: { perDay: ETH } } });
  const g = guardEthers(signer, t.o);
  await assert.rejects(g.sendTransaction({ to: TO, value: ETH }), /rejected/);
  fail = false;
  assert.deepEqual(await g.sendTransaction({ to: TO, value: ETH }), { hash: "0xhash" });
});

test("preview reserves nothing, asks for no approval, and says what it would do", async () => {
  let asked = 0;
  const t = opts({ assets: { [NATIVE]: { perDay: ETH } }, approveAbove: { [NATIVE]: ETH / 2n }, approve: async () => (asked++, { approved: true }) });
  const tx = { chainId: RH, from: FROM, to: TO, data: "0x", value: ETH };
  const p = await preview(tx, t.o);
  assert.equal(p.decision, "allowed");
  assert.equal(p.needsApproval, true);
  assert.equal(p.spend?.outflow[NATIVE], ETH);
  assert.ok(p.confirmId);
  assert.equal(asked, 0);
  assert.equal(t.reports.length, 0);
  // the whole day is still free
  const day = Date.now() - (Date.now() % 86_400_000);
  assert.equal((await t.o.store!.reserve(`day:${NATIVE}`, ETH, ETH, day)).ok, true);
  // a preview over a cap says blocked (no throw)
  const over = await preview({ ...tx, value: 2n * ETH }, t.o);
  assert.equal(over.decision, "blocked");
  assert.equal(over.policy, "cap-per-day");
  assert.equal(over.confirmId, "");
});

test("confirm skips the 2nd Toll call (identical request, once, tollConfirm stripped)", async () => {
  const { client, sent } = fakeViem({ on: false });
  const t = opts({ assets: { [NATIVE]: { perDay: 10n * ETH } } });
  const g = guardViem(client, t.o);
  const p = await preview({ chainId: RH, from: FROM, to: TO, data: "0x", value: ETH }, t.o);
  assert.equal(t.calls(), 1);
  await g.sendTransaction({ to: TO, value: ETH, tollConfirm: p.confirmId });
  assert.equal(t.calls(), 1);
  assert.deepEqual(sent[0], { to: TO, value: ETH });
  // used once: the same id asks Toll again
  await g.sendTransaction({ to: TO, value: ETH, tollConfirm: p.confirmId });
  assert.equal(t.calls(), 2);
  // a different request with a fresh id is checked by Toll
  const q = await preview({ chainId: RH, from: FROM, to: TO, data: "0x", value: ETH }, t.o);
  await g.sendTransaction({ to: TO, value: 2n * ETH, tollConfirm: q.confirmId });
  assert.equal(t.calls(), 4);
});

test("without spend: the wrapper behaves as 0.3.x (Toll asked, client gets the same args)", async () => {
  const { client, sent } = fakeViem({ on: false });
  let calls = 0;
  const g = guardViem(client, { fetch: async () => (calls++, json(ALLOW)), logger: false });
  const args = { to: TO, value: 10n ** 30n };
  await g.sendTransaction(args);
  assert.equal(calls, 1);
  assert.equal(sent[0], args);
});
