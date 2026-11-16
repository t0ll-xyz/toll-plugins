import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkTx,
  checkBudgetMs,
  budgetOf,
  enforce,
  guardX402Fetch,
  TollBlockedError,
  TollUnavailableError,
  CHECK_BUDGET_MIN_MS,
  CHECK_BUDGET_MAX_MS,
  type CheckOptions,
  type GuardOptions,
} from "../src/index.js";

/**
 * 0.7.1: `budgetMs`, the time budget Toll's check takes (300 to 30000 ms, the caller's timeout minus its round trip).
 * Sent in the body only when set; with it, a coin still being read is not asked a second time (the wait would run
 * past the caller's deadline) and stays a WARN "coin-not-read", never an ALLOW.
 */
const TX = { chainId: 4663, from: "0x2222222222222222222222222222222222222222", to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: 0n };
const json = (x: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json", ...headers } });
const ALLOW = { action: "ALLOW", warnings: [] };
const NOT_READ = { action: "WARN", warnings: [{ code: "coin-not-read", severity: "medium", message: "The coin was not read in time." }], "x-toll": { retry_after_s: 2 } };

function spy(answer: () => Response) {
  const bodies: Record<string, unknown>[] = [];
  const f: CheckOptions["fetch"] = async (_u, init) => {
    bodies.push(JSON.parse(String((init as { body: string }).body)));
    return answer();
  };
  return { bodies, f };
}

test("no budgetMs: the body carries none (as before)", async () => {
  const s = spy(() => json(ALLOW));
  await checkTx(TX, { fetch: s.f });
  assert.equal("budgetMs" in s.bodies[0], false);
});

test("budgetMs is sent in the body, beside the transaction and a ticket ask", async () => {
  const s = spy(() => json(ALLOW));
  await checkTx(TX, { fetch: s.f, budgetMs: 1100, ticket: true });
  assert.equal(s.bodies[0].budgetMs, 1100);
  assert.equal(s.bodies[0].to, TX.to);
  assert.ok(s.bodies[0].ticket);
});

test("a budget outside 300..30000 is moved to the nearest end, a fraction is rounded, a non-number is not sent", async () => {
  for (const [given, sent] of [[50, CHECK_BUDGET_MIN_MS], [99_999, CHECK_BUDGET_MAX_MS], [1100.6, 1101], [-1, 300]] as const) {
    const s = spy(() => json(ALLOW));
    await checkTx(TX, { fetch: s.f, budgetMs: given });
    assert.equal(s.bodies[0].budgetMs, sent, String(given));
  }
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "1500" as unknown as number]) {
    const s = spy(() => json(ALLOW));
    await checkTx(TX, { fetch: s.f, budgetMs: bad });
    assert.equal("budgetMs" in s.bodies[0], false, String(bad));
  }
  assert.equal(budgetOf(undefined), undefined);
});

test("checkBudgetMs: the timeout minus the round trip (400 ms unless given), never under 300", () => {
  assert.equal(checkBudgetMs(1500), 1100);
  assert.equal(checkBudgetMs(1500, 200), 1300);
  assert.equal(checkBudgetMs(500), 300);
  assert.equal(checkBudgetMs(60_000), 30_000);
  assert.equal(checkBudgetMs(Number.NaN), 300);
});

test("with a budget, a coin still being read is not asked again: the WARN stands and nothing sleeps", async () => {
  const s = spy(() => json(NOT_READ, 200, { "retry-after": "2" }));
  let slept = 0;
  const a = await checkTx(TX, { fetch: s.f, budgetMs: 1100, sleep: async () => void slept++ });
  assert.equal(a.action, "WARN");
  assert.equal(a.warnings[0].code, "coin-not-read");
  assert.equal(s.bodies.length, 1);
  assert.equal(slept, 0);
});

test("with a budget and retry: true it is asked once more; without a budget the retry is the default, as before", async () => {
  for (const o of [{ budgetMs: 1100, retry: true }, {}] as CheckOptions[]) {
    const s = spy(() => json(NOT_READ, 200, { "retry-after": "2" }));
    let slept = 0;
    await checkTx(TX, { fetch: s.f, sleep: async () => void slept++, ...o });
    assert.equal(s.bodies.length, 2);
    assert.equal(slept, 1);
  }
});

test("strict with a budget: a coin not read in time is refused with its reason, never signed as clear", async () => {
  const s = spy(() => json(NOT_READ, 200, { "retry-after": "2" }));
  const o: GuardOptions = { fetch: s.f, strict: true, budgetMs: 1100, logger: false };
  await assert.rejects(enforce("transaction", () => TX, o), (e: unknown) => {
    assert.ok(e instanceof TollBlockedError);
    assert.equal(e.assessment.action, "WARN");
    assert.deepEqual(e.codes, ["coin-not-read"]);
    assert.match(e.message, /Toll WARN, not signed/);
    return true;
  });
  assert.equal(s.bodies[0].budgetMs, 1100);
});

test("strict with a budget: no answer inside the timeout is not signed, and the error says it was not checked", async () => {
  const hangs: GuardOptions["fetch"] = (_u, init) => new Promise((_ok, no) => {
    (init as { signal: AbortSignal }).signal.addEventListener("abort", () => no(new Error("aborted")));
  });
  await assert.rejects(enforce("transaction", () => TX, { fetch: hangs, strict: true, timeoutMs: 20, budgetMs: 300, logger: false }), (e: unknown) => {
    assert.ok(e instanceof TollUnavailableError);
    assert.equal(e.reason, "timeout");
    assert.match(e.message, /Not signed: Toll did not check this request/);
    return true;
  });
});

test("guardX402Fetch passes the budget on: the check of a 402 carries budgetMs", async () => {
  const s = spy(() => json(ALLOW));
  const pr = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:4663", asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", amount: "5000", payTo: "0x000000000000000000000000000000000000dEaD" }] };
  const seller = async () => json(pr, 402);
  const res = await guardX402Fetch(seller, { fetch: s.f, strict: true, budgetMs: checkBudgetMs(5000, 1000), logger: false })("https://seller.example/paid");
  assert.equal(res.status, 402);
  assert.equal(s.bodies.length, 1);
  assert.equal(s.bodies[0].budgetMs, 4000);
  assert.ok(s.bodies[0].x402);
});
