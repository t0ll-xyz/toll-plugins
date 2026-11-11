import { test } from "node:test";
import assert from "node:assert/strict";
import { enforce, TollBlockedError, TollUnavailableError, type GuardOptions, type GuardReport, type RiskAssessment } from "../src/index.js";

const TX = { chainId: 4663, from: "0x2222222222222222222222222222222222222222", to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: 0n };
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
const warn = (...sev: Array<"low" | "medium" | "high" | "critical">): RiskAssessment => ({
  action: "WARN",
  warnings: sev.map((severity, i) => ({ code: `w${i}`, severity, message: `warning ${i}` })),
});

function opts(res: Response, extra: GuardOptions = {}) {
  const logs: string[] = [];
  const reports: GuardReport[] = [];
  const o: GuardOptions = {
    fetch: async () => res,
    sleep: async () => {},
    logger: (x) => void logs.push(x),
    onReport: (r) => void reports.push(r),
    ...extra,
  };
  return { o, logs, reports };
}
const run = (res: Response, extra: GuardOptions = {}) => {
  const t = opts(res, extra);
  return { t, p: enforce("transaction", () => TX, t.o) };
};

test("default: a WARN with one high warning is blocked", async () => {
  const { t, p } = run(json(warn("medium", "high")));
  await assert.rejects(p, TollBlockedError);
  assert.equal(t.reports[0].decision, "blocked");
  assert.equal(t.reports[0].basis, "WARN");
});

test("default: a WARN with a critical warning is blocked", async () => {
  await assert.rejects(run(json(warn("critical"))).p, TollBlockedError);
});

test("default: a WARN where every warning is medium or low is allowed and logged", async () => {
  const { t, p } = run(json(warn("medium", "low")));
  const r = await p;
  assert.equal(r.decision, "allowed");
  assert.equal(r.basis, "WARN");
  assert.equal(t.logs.length, 1);
});

test('onWarn "block-high" given explicitly behaves as the default', async () => {
  await assert.rejects(run(json(warn("high")), { onWarn: "block-high" }).p, TollBlockedError);
  assert.equal((await run(json(warn("medium")), { onWarn: "block-high" }).p).decision, "allowed");
});

test('onWarn "allow" with a high warning is allowed (the 0.1.x behaviour)', async () => {
  const r = await run(json(warn("high", "critical")), { onWarn: "allow" }).p;
  assert.equal(r.decision, "allowed");
});

test("strict: Toll unavailable throws TollUnavailableError", async () => {
  await assert.rejects(run(json({ error: "down" }, 503), { strict: true }).p, TollUnavailableError);
});

test('strict with onUnavailable "allow": Toll unavailable is allowed (explicit option wins)', async () => {
  const r = await run(json({ error: "down" }, 503), { strict: true, onUnavailable: "allow" }).p;
  assert.equal(r.decision, "allowed");
  assert.equal(r.basis, "unavailable");
});

test("strict: any WARN is blocked, even all medium", async () => {
  await assert.rejects(run(json(warn("medium")), { strict: true }).p, TollBlockedError);
});

test('strict with onWarn "allow": a WARN is allowed; the rest of strict still applies', async () => {
  assert.equal((await run(json(warn("high")), { strict: true, onWarn: "allow" }).p).decision, "allowed");
  await assert.rejects(run(json({ error: "down" }, 503), { strict: true, onWarn: "allow" }).p, TollUnavailableError);
});

test("strict: an unsupported request (another chain) throws; onUnsupported allow wins", async () => {
  const other = { ...TX, chainId: 1 };
  const t = opts(json(warn()), { strict: true });
  await assert.rejects(enforce("transaction", () => other, t.o), TollUnavailableError);
  const t2 = opts(json(warn()), { strict: true, onUnsupported: "allow" });
  assert.equal((await enforce("transaction", () => other, t2.o)).basis, "unsupported");
});

test("an option present but undefined does not override strict", async () => {
  await assert.rejects(run(json({ error: "down" }, 503), { strict: true, onUnavailable: undefined }).p, TollUnavailableError);
});

test("without strict: unavailable is fail-closed by default (0.5.1), fail-open only under failOpen", async () => {
  await assert.rejects(run(json({ error: "down" }, 503)).p, TollUnavailableError);
  assert.equal((await run(json({ error: "down" }, 503), { failOpen: true }).p).decision, "allowed");
});
