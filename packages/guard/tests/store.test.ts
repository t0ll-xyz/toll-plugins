import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySpendStore, dayStart } from "../src/index.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

test("a reserve over perDay fails; used is reported", async () => {
  const s = new MemorySpendStore();
  const a = await s.reserve("day:native", 60n, 100n, dayStart(T0));
  assert.equal(a.ok, true);
  assert.equal(a.used, 60n);
  const b = await s.reserve("day:native", 50n, 100n, dayStart(T0));
  assert.equal(b.ok, false);
  assert.equal(b.used, 60n);
  assert.equal((await s.reserve("day:native", 40n, 100n, dayStart(T0))).ok, true);
});

test("release frees the amount; commit keeps it; both are idempotent", async () => {
  const s = new MemorySpendStore();
  const a = await s.reserve("k", 80n, 100n, dayStart(T0));
  await s.release(a.id);
  await s.release(a.id);
  const b = await s.reserve("k", 100n, 100n, dayStart(T0));
  assert.equal(b.ok, true);
  await s.commit(b.id);
  await s.commit(b.id);
  await s.release(b.id); // a committed spend is not given back
  assert.equal((await s.reserve("k", 1n, 100n, dayStart(T0))).ok, false);
});

test("the day rolls over at 00:00 UTC", async () => {
  const s = new MemorySpendStore();
  const late = Date.UTC(2026, 10, 8, 23, 59, 59);
  assert.equal(dayStart(late), Date.UTC(2026, 10, 8));
  const a = await s.reserve("k", 100n, 100n, dayStart(late));
  await s.commit(a.id);
  assert.equal((await s.reserve("k", 1n, 100n, dayStart(late))).ok, false);
  const next = late + 1000;
  assert.equal(dayStart(next), Date.UTC(2026, 10, 9));
  const b = await s.reserve("k", 100n, 100n, dayStart(next));
  assert.equal(b.ok, true);
  assert.equal(b.used, 100n);
});

test("concurrent reserves never exceed the limit", async () => {
  const s = new MemorySpendStore();
  const rs = await Promise.all(Array.from({ length: 50 }, () => s.reserve("k", 7n, 100n, dayStart(T0))));
  const ok = rs.filter((r) => r.ok).length;
  assert.equal(ok, 14); // 14 * 7 = 98
  assert.ok(rs.every((r) => r.used <= 100n));
});

test("a payment id is seen within its TTL, not after", async () => {
  let now = T0;
  const s = new MemorySpendStore({ now: () => now });
  assert.equal(await s.paymentSeen("pay_1"), false);
  await s.markPaid("pay_1", 60);
  assert.equal(await s.paymentSeen("pay_1"), true);
  now += 59_000;
  assert.equal(await s.paymentSeen("pay_1"), true);
  now += 2_000;
  assert.equal(await s.paymentSeen("pay_1"), false);
  void DAY;
});
