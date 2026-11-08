import { test } from "node:test";
import assert from "node:assert/strict";
import { guardX402Fetch, MemorySpendStore, TollPolicyError, USDG, type GuardOptions, type GuardReport, type RiskAssessment, type SpendPolicy } from "../src/index.js";

const PAYEE = "0x1111111111111111111111111111111111111111";
const ALLOW: RiskAssessment = { action: "ALLOW", warnings: [] };
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
const b64 = (x: unknown) => btoa(JSON.stringify(x));
const pr = (amount: string) => ({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:4663", asset: USDG, amount, payTo: PAYEE }] });
const res402 = (amount = "50000") => new Response("{}", { status: 402, headers: { "payment-required": b64(pr(amount)) } });
const payment = (id?: string) => b64({ x402Version: 2, payload: { signature: "0xsig" }, ...(id ? { extensions: { "payment-identifier": { info: { required: false, id } } } } : {}) });

function setup(spend: SpendPolicy, answers: Response[], extra: GuardOptions = {}) {
  let tollCalls = 0;
  const reports: GuardReport[] = [];
  const seen: Array<{ url: string; paid: boolean }> = [];
  const inner = async (input: string, init?: { headers?: Record<string, string> }) => {
    const paid = !!init?.headers?.["PAYMENT-SIGNATURE"];
    seen.push({ url: input, paid });
    const r = answers.shift();
    if (!r) throw new Error("no more seller answers");
    return r;
  };
  const o: GuardOptions = { fetch: async () => (tollCalls++, json(ALLOW)), sleep: async () => {}, logger: false, onReport: (r) => void reports.push(r), spend, store: new MemorySpendStore(), ...extra };
  return { f: guardX402Fetch(inner, o), seen, reports, tollCalls: () => tollCalls };
}

test("a repeated payment id: duplicate-payment, never sent twice", async () => {
  const t = setup({}, [json({ ok: 1 }), json({ ok: 2 })]);
  const h = { headers: { "PAYMENT-SIGNATURE": payment("pay_7d5d747be160e280504c099d984bcfe0") } };
  assert.equal((await t.f("https://seller.test/api/a", h)).status, 200);
  await assert.rejects(t.f("https://seller.test/api/a", h), (e: unknown) => e instanceof TollPolicyError && e.code === "duplicate-payment");
  assert.equal(t.seen.length, 1);
  // another id goes through
  assert.equal((await t.f("https://seller.test/api/a", { headers: { "PAYMENT-SIGNATURE": payment("pay_other") } })).status, 200);
  // no id: nothing to compare, passes
  assert.equal(t.seen.length, 2);
});

test("a per-endpoint day cap holds across two 402s (the paid one is committed)", async () => {
  const spend: SpendPolicy = { perEndpoint: { "https://seller.test/api/": { perDay: 80_000n } } };
  const t = setup(spend, [res402(), json({ ok: 1 }), res402(), res402()]);
  // 1st: 402 checked and held, then paid
  assert.equal((await t.f("https://seller.test/api/a")).status, 402);
  assert.equal((await t.f("https://seller.test/api/a", { headers: { "PAYMENT-SIGNATURE": payment("pay_1") } })).status, 200);
  // 2nd: 50000 more is over 80000 today
  await assert.rejects(t.f("https://seller.test/api/b"), (e: unknown) => e instanceof TollPolicyError && e.code === "cap-endpoint");
  // another endpoint has no cap
  assert.equal((await t.f("https://other.test/api/a")).status, 402);
});

test("a per-endpoint per-call cap and a payee allowlist block the 402 before it reaches the payer", async () => {
  const t = setup({ perEndpoint: { "https://seller.test/": { perCall: 10_000n } } }, [res402()]);
  await assert.rejects(t.f("https://seller.test/x"), (e: unknown) => e instanceof TollPolicyError && e.code === "cap-endpoint");
  const a = setup({ allow: { payTo: ["0x9999999999999999999999999999999999999999"] } }, [res402()]);
  await assert.rejects(a.f("https://seller.test/x"), (e: unknown) => e instanceof TollPolicyError && e.code === "not-allowlisted");
  assert.equal(a.tollCalls(), 0);
});

test("a paid retry the seller refuses (402 again) gives the reservation back", async () => {
  const spend: SpendPolicy = { assets: { [USDG]: { perDay: 60_000n } } };
  const t = setup(spend, [res402(), res402(), res402(), json({ ok: 1 })]);
  await t.f("https://seller.test/api/a");
  // the payment is refused: 402 again (a fresh 402 is checked as a new one)
  assert.equal((await t.f("https://seller.test/api/a", { headers: { "PAYMENT-SIGNATURE": payment("pay_1") } })).status, 402);
  // the first hold is gone, so a new 402 of 50000 fits under 60000
  assert.equal((await t.f("https://seller.test/api/a")).status, 402);
});

test("same id retried after a network error is allowed and not double-counted", async () => {
  const spend: SpendPolicy = { assets: { [USDG]: { perDay: 100_000n } } };
  const answers: Array<Response | "down"> = [res402(), "down", json({ ok: 1 }), res402(), res402()];
  let sent = 0;
  const inner = async () => {
    sent++;
    const a = answers.shift();
    if (a === "down") throw new TypeError("fetch failed");
    if (!a) throw new Error("no more seller answers");
    return a;
  };
  const f = guardX402Fetch(inner, { fetch: async () => json(ALLOW), logger: false, spend, store: new MemorySpendStore() });
  const h = { headers: { "PAYMENT-SIGNATURE": payment("pay_retry") } };
  assert.equal((await f("https://seller.test/api/a")).status, 402); // 50000 held
  await assert.rejects(f("https://seller.test/api/a", h), /fetch failed/);
  assert.equal((await f("https://seller.test/api/a", h)).status, 200); // the same id again: allowed, reuses the hold
  assert.equal(sent, 3);
  // exactly 50000 counted: one more 402 of 50000 fits, the next does not
  assert.equal((await f("https://seller.test/api/b")).status, 402);
  await assert.rejects(f("https://seller.test/api/c"), (e: unknown) => e instanceof TollPolicyError && e.code === "cap-per-day");
});

test("same id in flight twice concurrently: the second is refused", async () => {
  let open!: (r: Response) => void;
  let sent = 0;
  const inner = async () => (sent++, new Promise<Response>((r) => (open = r)));
  const f = guardX402Fetch(inner, { fetch: async () => json(ALLOW), logger: false, spend: {}, store: new MemorySpendStore() });
  const h = { headers: { "PAYMENT-SIGNATURE": payment("pay_dup") } };
  const first = f("https://seller.test/api/a", h);
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(f("https://seller.test/api/a", h), (e: unknown) => e instanceof TollPolicyError && e.code === "duplicate-payment");
  open(json({ ok: 1 }));
  assert.equal((await first).status, 200);
  assert.equal(sent, 1);
});

test("same id after a successful paid answer: refused; after a 402 answer: not marked", async () => {
  const t = setup({}, [json({}, 402), json({ ok: 1 })]);
  const h = { headers: { "PAYMENT-SIGNATURE": payment("pay_once") } };
  assert.equal((await t.f("https://seller.test/api/a", h)).status, 402); // refused by the seller: not paid
  assert.equal((await t.f("https://seller.test/api/a", h)).status, 200); // so the same id may go again
  await assert.rejects(t.f("https://seller.test/api/a", h), (e: unknown) => e instanceof TollPolicyError && e.code === "duplicate-payment");
  assert.equal(t.seen.length, 2);
});
