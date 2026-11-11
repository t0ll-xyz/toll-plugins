import { test } from "node:test";
import assert from "node:assert/strict";
import { enforce, resolvePolicy, TollUnavailableError, type GuardOptions, type GuardReport } from "../src/index.js";

/**
 * 0.5.1 (audit 2026-11-11): the guard FAILS CLOSED by default. Before, an answer Toll refused to give (HTTP 400, 413
 * for a request padded past 64 KB, 5xx, a timeout, a body that is not a RiskAssessment) was "unavailable" and the
 * signature went ahead: whoever built the request could switch the check off. Now nothing is signed unless Toll
 * answered; `failOpen: true` (or the older `onUnavailable: "allow"`) is the explicit opt-in to the old behaviour.
 */
const TX = { chainId: 4663, from: "0x2222222222222222222222222222222222222222", to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: 0n };
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

function run(f: GuardOptions["fetch"], extra: GuardOptions = {}) {
  const logs: string[] = [];
  const reports: GuardReport[] = [];
  const o: GuardOptions = { fetch: f, sleep: async () => {}, logger: (x) => void logs.push(x), onReport: (r) => void reports.push(r), ...extra };
  return { logs, reports, p: enforce("transaction", () => TX, o) };
}
const answers = (res: () => Response): GuardOptions["fetch"] => async () => res();
const hangs: GuardOptions["fetch"] = (_u, init) => new Promise((_ok, no) => {
  (init as { signal: AbortSignal }).signal.addEventListener("abort", () => no(new Error("aborted")));
});

const CASES: Array<[string, GuardOptions["fetch"], string, GuardOptions]> = [
  ["HTTP 400 (a request Toll refuses to read)", answers(() => json({ error: "data must be hex" }, 400)), "bad-request", {}],
  ["HTTP 413 (a request padded past Toll's size limit)", answers(() => json({ error: "Request too large." }, 413)), "bad-request", {}],
  ["HTTP 500", answers(() => json({ error: "boom" }, 500)), "server-error", {}],
  ["HTTP 404 (any other non-2xx)", answers(() => json({ error: "gone" }, 404)), "bad-answer", {}],
  ["a timeout", hangs, "timeout", { timeoutMs: 20 }],
  ["a 200 that is not JSON", answers(() => new Response("<html>oops</html>", { status: 200 })), "bad-answer", {}],
  ["a 200 JSON that is not a RiskAssessment", answers(() => json({ ok: true })), "bad-answer", {}],
  ["the network failing", async () => { throw new Error("ECONNRESET"); }, "network", {}],
];

for (const [name, f, reason, extra] of CASES) {
  test(`default: ${name} refuses to sign`, async () => {
    const r = run(f, extra);
    await assert.rejects(r.p, (e: unknown) => {
      assert.ok(e instanceof TollUnavailableError);
      assert.equal(e.reason, reason);
      // the error says what happened and how to opt out
      assert.match(e.message, /Not signed/);
      assert.match(e.message, /failOpen: true/);
      return true;
    });
    assert.equal(r.reports.length, 1);
    assert.equal(r.reports[0].decision, "blocked");
    assert.equal(r.reports[0].basis, "unavailable");
  });

  test(`failOpen: true: ${name} goes ahead, logged as NOT checked`, async () => {
    const r = run(f, { ...extra, failOpen: true });
    const rep = await r.p;
    assert.equal(rep.decision, "allowed");
    assert.equal(rep.basis, "unavailable");
    assert.ok(r.logs.some((l) => /NOT checked/.test(l)));
  });
}

test("the policy: fail closed by default; failOpen and the explicit onUnavailable both opt out; explicit onUnavailable wins", () => {
  assert.equal(resolvePolicy({}).onUnavailable, "block");
  assert.equal(resolvePolicy({ failOpen: true }).onUnavailable, "allow");
  assert.equal(resolvePolicy({ onUnavailable: "allow" }).onUnavailable, "allow");
  assert.equal(resolvePolicy({ failOpen: true, onUnavailable: "block" }).onUnavailable, "block");
  assert.equal(resolvePolicy({ failOpen: true, strict: true }).onUnavailable, "block");
  assert.equal(resolvePolicy({ failOpen: false }).onUnavailable, "block");
});

test("a request that could not be encoded for the check refuses to sign by default", async () => {
  await assert.rejects(enforce("transaction", () => { throw new Error("bad abi"); }, { logger: false }), TollUnavailableError);
});
