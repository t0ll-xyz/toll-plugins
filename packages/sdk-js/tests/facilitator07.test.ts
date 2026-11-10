import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUDGET_DOMAIN,
  RECEIPT_DOMAIN,
  TOLL_FACILITATOR,
  Toll,
  TollError,
  budgetTypedData,
  receiptTypedData,
  revokeTypedData,
  tollOfferReceiptOf,
  type FacilitatorSettleResponse,
} from "../src/index.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8");
const PAYER = "0x1111111111111111111111111111111111111111";
const PAYTO = "0x3954ff905bdb481ad5814d5be3cc32c3166122ac";
const OTHER = "0x2222222222222222222222222222222222222222";
const SIG = `0x${"ab".repeat(65)}`;
const TX = `0x${"cd".repeat(32)}`;

type Call = { url: string; init: RequestInit };
function mockFetch(responses: Array<string | Response>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more mock responses");
    return typeof r === "string" ? new Response(r, { status: 200 }) : r;
  };
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// the facilitator's own definitions (lib/fac/budget.ts, lib/fac/offerreceipt.ts), copied: the SDK must hash the same
const FAC_BUDGET_TYPES = {
  Budget: [
    { name: "payer", type: "address" }, { name: "perPayment", type: "uint256" }, { name: "perDay", type: "uint256" },
    { name: "perPayTo", type: "uint256" }, { name: "payToCaps", type: "PayToCap[]" }, { name: "allowedPayTos", type: "address[]" },
    { name: "validUntil", type: "uint64" }, { name: "nonce", type: "uint256" },
  ],
  PayToCap: [{ name: "payTo", type: "address" }, { name: "perDay", type: "uint256" }],
};
const FAC_REVOKE_TYPES = { Revoke: [{ name: "payer", type: "address" }, { name: "nonce", type: "uint256" }] };
const FAC_RECEIPT_TYPES = {
  Receipt: [
    { name: "version", type: "uint256" }, { name: "network", type: "string" }, { name: "resourceUrl", type: "string" }, { name: "payer", type: "string" },
    { name: "issuedAt", type: "uint256" }, { name: "transaction", type: "string" },
  ],
};

/* ------------------------------------------------------------------ paidBefore */

test("paidBefore reads GET /paid on x402.t0ll.xyz with payer and payTo lowercased (the route's shape)", async () => {
  const m = mockFetch([fx("paid")]);
  const r = await new Toll({ fetch: m.f, clientId: "c".repeat(22) }).paidBefore({ payer: PAYER.replace("0x11", "0x1A"), payTo: PAYTO.toUpperCase().replace("0X", "0x") });
  const u = new URL(m.calls[0].url);
  assert.equal(`${u.origin}${u.pathname}`, `${TOLL_FACILITATOR}/paid`);
  assert.deepEqual(Object.fromEntries(u.searchParams), { payer: PAYER.replace("0x11", "0x1a"), payTo: PAYTO });
  assert.equal(m.calls[0].init.method, "GET");
  assert.equal((m.calls[0].init.headers as Record<string, string>)["x-toll-client"], "c".repeat(22));
  assert.equal(r.paid, true);
  assert.equal(r.count, 2);
  assert.equal(r.last?.via, "settlement");
  assert.deepEqual(r.sources, { settlements: 2, escrow: 0, batch: "not-read" });
});

test("paidBefore passes resource and since (unix seconds or a Date)", async () => {
  const m = mockFetch([fx("paid"), fx("paid")]);
  const t = new Toll({ fetch: m.f });
  await t.paidBefore({ payer: PAYER, payTo: PAYTO, resource: "https://api.example/quote?x=1", since: 1_794_000_000 });
  assert.deepEqual(Object.fromEntries(new URL(m.calls[0].url).searchParams), { payer: PAYER, payTo: PAYTO, resource: "https://api.example/quote?x=1", since: "1794000000" });
  await t.paidBefore({ payer: PAYER, payTo: PAYTO, since: new Date(1_794_000_000_999) });
  assert.equal(new URL(m.calls[1].url).searchParams.get("since"), "1794000000");
});

test("paidBefore: a not-paid answer, bad input before any request, a 503 throws (never a false not-paid)", async () => {
  const none = { paid: false, count: 0, last: null, network: "eip155:4663", sources: { settlements: 0, escrow: "not-read", batch: "not-applicable" } };
  const m = mockFetch([json(none), json({ error: "The settlement record could not be read right now." }, 503), json({ error: "payer must be a 0x address (40 hex characters)." }, 400)]);
  const t = new Toll({ fetch: m.f, facilitatorUrl: "https://fac.example/" });
  assert.deepEqual(await t.paidBefore({ payer: PAYER, payTo: PAYTO }), none);
  assert.equal(new URL(m.calls[0].url).origin, "https://fac.example");
  await assert.rejects(t.paidBefore({ payer: "0x12", payTo: PAYTO }), /payer/);
  await assert.rejects(t.paidBefore({ payer: PAYER, payTo: "nope" }), /payTo/);
  await assert.rejects(t.paidBefore({ payer: PAYER, payTo: PAYTO, resource: "ftp://x" }), /resource/);
  await assert.rejects(t.paidBefore({ payer: PAYER, payTo: PAYTO, since: 1.5 }), /since/);
  await assert.rejects(t.paidBefore({ payer: PAYER, payTo: PAYTO, since: 1_794_000_000_000 }), /since/);
  assert.equal(m.calls.length, 1);
  await assert.rejects(t.paidBefore({ payer: PAYER, payTo: PAYTO }), (e: TollError) => e.status === 503 && /could not be read/.test(e.message));
  await assert.rejects(t.paidBefore({ payer: PAYER, payTo: PAYTO }), (e: TollError) => e.status === 400);
});

/* ------------------------------------------------------------------ budgets: typed data */

const BUDGET = {
  payer: PAYER,
  perPayment: 100_000n,
  perDay: "1000000",
  payToCaps: [{ payTo: PAYTO, perDay: 250_000 }, { payTo: OTHER, perDay: "0" }],
  allowedPayTos: [PAYTO, OTHER],
  nonce: 1_794_312_000_000n,
};

test("budgetTypedData: the facilitator's domain (no verifyingContract) and types, uints as bigint, caps in order", () => {
  const td = budgetTypedData(BUDGET);
  assert.deepEqual(td.domain, { name: "Toll Facilitator Budget", version: "1", chainId: 4663 });
  assert.equal("verifyingContract" in td.domain, false);
  assert.deepEqual(td.domain, BUDGET_DOMAIN);
  assert.deepEqual(JSON.parse(JSON.stringify(td.types)), FAC_BUDGET_TYPES);
  assert.equal(td.primaryType, "Budget");
  assert.deepEqual(td.message, {
    payer: PAYER, perPayment: 100_000n, perDay: 1_000_000n, perPayTo: 0n,
    payToCaps: [{ payTo: PAYTO, perDay: 250_000n }, { payTo: OTHER, perDay: 0n }],
    allowedPayTos: [PAYTO, OTHER], validUntil: 0n, nonce: 1_794_312_000_000n,
  });
});

test("budgetTypedData / revokeTypedData refuse a malformed budget before anything is signed", () => {
  assert.throws(() => budgetTypedData({ ...BUDGET, payer: "0x12" }), TollError);
  assert.throws(() => budgetTypedData({ ...BUDGET, perDay: -1 }), /perDay/);
  assert.throws(() => budgetTypedData({ ...BUDGET, perDay: 1.5 }), /perDay/);
  assert.throws(() => budgetTypedData({ ...BUDGET, perDay: "1e6" }), /perDay/);
  assert.throws(() => budgetTypedData({ ...BUDGET, validUntil: (1n << 64n) }), /validUntil/);
  assert.throws(() => budgetTypedData({ ...BUDGET, nonce: undefined as never }), /nonce/);
  assert.throws(() => budgetTypedData({ ...BUDGET, payToCaps: [{ payTo: PAYTO, perDay: 1 }, { payTo: PAYTO.toUpperCase().replace("0X", "0x"), perDay: 2 }] }), /twice/);
  assert.throws(() => budgetTypedData({ ...BUDGET, allowedPayTos: Array(51).fill(PAYTO) }), /50/);
  assert.throws(() => budgetTypedData({ ...BUDGET, allowedPayTos: ["x"] }), /allowedPayTos\[0\]/);
  assert.deepEqual(revokeTypedData({ payer: PAYER, nonce: "7" }).message, { payer: PAYER, nonce: 7n });
  assert.equal(revokeTypedData({ payer: PAYER, nonce: 7 }).primaryType, "Revoke");
  assert.deepEqual(JSON.parse(JSON.stringify(revokeTypedData({ payer: PAYER, nonce: 7 }).types)), FAC_REVOKE_TYPES);
  assert.throws(() => revokeTypedData({ payer: PAYER, nonce: -1 }), /nonce/);
});

test("a budget signed from budgetTypedData recovers to the payer under the facilitator's own types (viem)", async (tt) => {
  let viem: any, accounts: any;
  try {
    viem = await import("viem" as string);
    accounts = await import("viem/accounts" as string);
  } catch {
    tt.skip("viem not installed");
    return;
  }
  const acct = accounts.privateKeyToAccount(`0x${"42".repeat(32)}`);
  const td = budgetTypedData({ ...BUDGET, payer: acct.address });
  const signature = await acct.signTypedData(td);
  // the facilitator rebuilds the message from the POST body (decimal strings) and recovers with its types
  const m = mockFetch([json({ ok: true, payer: acct.address.toLowerCase(), nonce: "1794312000000", revoked: false })]);
  await new Toll({ fetch: m.f }).setBudget({ budget: { ...BUDGET, payer: acct.address }, signature });
  const body = JSON.parse(String(m.calls[0].init.body));
  const b = body.budget;
  const message = { payer: b.payer, perPayment: BigInt(b.perPayment), perDay: BigInt(b.perDay), perPayTo: BigInt(b.perPayTo),
    payToCaps: b.payToCaps.map((c: any) => ({ payTo: c.payTo, perDay: BigInt(c.perDay) })), allowedPayTos: b.allowedPayTos,
    validUntil: BigInt(b.validUntil), nonce: BigInt(b.nonce) };
  const who = await viem.recoverTypedDataAddress({ domain: { name: "Toll Facilitator Budget", version: "1", chainId: 4663 }, types: FAC_BUDGET_TYPES, primaryType: "Budget", message, signature: body.signature });
  assert.equal(who.toLowerCase(), acct.address.toLowerCase());

  const rsig = await acct.signTypedData(revokeTypedData({ payer: acct.address, nonce: 9n }));
  const rwho = await viem.recoverTypedDataAddress({ domain: { name: "Toll Facilitator Budget", version: "1", chainId: 4663 }, types: FAC_REVOKE_TYPES, primaryType: "Revoke", message: { payer: acct.address, nonce: 9n }, signature: rsig });
  assert.equal(rwho, acct.address);

  // the same bytes as toll-sdk (Python) signs with eth_account for this key: both SDKs hash the facilitator's types
  const fixed = await acct.signTypedData(budgetTypedData({ payer: PAYER, perPayment: 100000, perDay: 1000000, payToCaps: [{ payTo: PAYTO, perDay: 250000 }], allowedPayTos: [OTHER], nonce: 5 }));
  assert.equal(fixed, "0x55bd30a77dfa93656da268faba906975e123f19256770ae375eeaff46d30cb145d2babecaecbcbb1f538c537a1cdc336fb8f77a8da29c0effebfe2fe75bccf261c");
});

/* ------------------------------------------------------------------ budgets: the routes */

test("setBudget POSTs { budget (decimal strings, caps in the signed order), signature } to /budget", async () => {
  const m = mockFetch([json({ ok: true, payer: PAYER, nonce: "1794312000000", revoked: false })]);
  const r = await new Toll({ fetch: m.f }).setBudget({ budget: BUDGET, signature: SIG });
  assert.equal(m.calls[0].url, `${TOLL_FACILITATOR}/budget`);
  assert.equal(m.calls[0].init.method, "POST");
  assert.equal((m.calls[0].init.headers as Record<string, string>)["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)), {
    budget: {
      payer: PAYER, perPayment: "100000", perDay: "1000000", perPayTo: "0",
      payToCaps: [{ payTo: PAYTO, perDay: "250000" }, { payTo: OTHER, perDay: "0" }],
      allowedPayTos: [PAYTO, OTHER], validUntil: "0", nonce: "1794312000000",
    },
    signature: SIG,
  });
  assert.deepEqual(r, { ok: true, payer: PAYER, nonce: "1794312000000", revoked: false });
});

test("revokeBudget POSTs { revoke: { payer, nonce }, signature }", async () => {
  const m = mockFetch([json({ ok: true, payer: PAYER, nonce: "8", revoked: true })]);
  const r = await new Toll({ fetch: m.f }).revokeBudget({ payer: PAYER, nonce: 8n, signature: SIG });
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)), { revoke: { payer: PAYER, nonce: "8" }, signature: SIG });
  assert.equal(r.revoked, true);
});

test("getBudget reads GET /budget?payer= (the route's shape)", async () => {
  const m = mockFetch([fx("budget_get")]);
  const r = await new Toll({ fetch: m.f }).getBudget(PAYER.toUpperCase().replace("0X", "0x"));
  assert.equal(m.calls[0].url, `${TOLL_FACILITATOR}/budget?payer=${PAYER}`);
  assert.equal(r.budget?.perDay, "1000000");
  assert.equal(r.remainingToday, "850000");
  assert.equal(r.spentByPayTo[PAYTO], "150000");
});

test("budgets: bad input throws before any request; budgets_off, stale nonce and a bad signature throw with the code", async () => {
  const m = mockFetch([
    json({ error: "budgets_off", message: "Per-payer budgets are not switched on here." }, 404),
    json({ error: "budget_nonce_stale", message: "a budget with the same or a newer nonce is already set: sign with a higher nonce" }, 409),
    json({ error: "invalid_budget_signature", message: "the signature is not the payer's own" }, 403),
    json({ error: "budgets_off", message: "Per-payer budgets are not switched on here." }, 404),
  ]);
  const t = new Toll({ fetch: m.f });
  await assert.rejects(t.setBudget({ budget: BUDGET, signature: "0x12" }), /signature/);
  await assert.rejects(t.setBudget({ budget: { ...BUDGET, payer: "x" }, signature: SIG }), /payer/);
  await assert.rejects(t.revokeBudget({ payer: PAYER, nonce: "x", signature: SIG }), /nonce/);
  await assert.rejects(t.getBudget("0x12"), /payer/);
  assert.equal(m.calls.length, 0);
  await assert.rejects(t.setBudget({ budget: BUDGET, signature: SIG }), (e: TollError) => e.status === 404 && /budgets_off/.test(e.message) && /not switched on/.test(e.message));
  await assert.rejects(t.setBudget({ budget: BUDGET, signature: SIG }), (e: TollError) => e.status === 409 && /budget_nonce_stale/.test(e.message));
  await assert.rejects(t.revokeBudget({ payer: PAYER, nonce: 1, signature: SIG }), (e: TollError) => e.status === 403 && /invalid_budget_signature/.test(e.message));
  await assert.rejects(t.getBudget(PAYER), (e: TollError) => e.status === 404);
});

/* ------------------------------------------------------------------ offer-receipt */

const PAYLOAD = { version: 1, network: "eip155:4663", resourceUrl: "https://s.example/a", payer: PAYER, issuedAt: 1_800_000_100, transaction: TX };

test("tollOfferReceiptOf reads extensions['toll-offer-receipt'] of a settle answer", () => {
  const settled: FacilitatorSettleResponse = {
    success: true, transaction: TX, network: "eip155:4663", payer: PAYER,
    extensions: { "toll-offer-receipt": { offer: { read: "none" }, receiptPayload: PAYLOAD } },
  };
  assert.deepEqual(tollOfferReceiptOf(settled), { offer: { read: "none" }, receiptPayload: PAYLOAD });
  assert.deepEqual(tollOfferReceiptOf({ extensions: { "toll-offer-receipt": { offer: { read: "invalid" }, receiptPayload: null } } }), { offer: { read: "invalid" }, receiptPayload: null });
  assert.equal(tollOfferReceiptOf({ extensions: { "toll-offer-receipt": { offer: { read: "none" }, receiptPayload: { ...PAYLOAD, issuedAt: "x" } } } })?.receiptPayload, null);
  assert.equal(tollOfferReceiptOf({ extensions: {} }), null);
  assert.equal(tollOfferReceiptOf(null), null);
});

test("receiptTypedData: the spec's domain (chainId 1) and canonical types, the payload as given", () => {
  const td = receiptTypedData(PAYLOAD);
  assert.deepEqual(td.domain, { name: "x402 receipt", version: "1", chainId: 1 });
  assert.deepEqual(td.domain, RECEIPT_DOMAIN);
  assert.deepEqual(JSON.parse(JSON.stringify(td.types)), FAC_RECEIPT_TYPES);
  assert.equal(td.primaryType, "Receipt");
  assert.deepEqual(td.message, { ...PAYLOAD, version: 1n, issuedAt: 1_800_000_100n });
  assert.equal(receiptTypedData({ ...PAYLOAD, transaction: undefined as never }).message.transaction, "");
  assert.throws(() => receiptTypedData({ ...PAYLOAD, issuedAt: -1 }), /issuedAt/);
  assert.throws(() => receiptTypedData({ ...PAYLOAD, payer: 1 as never }), /payer/);
});

test("a receipt signed from receiptTypedData verifies as the spec says (viem)", async (tt) => {
  let viem: any, accounts: any;
  try {
    viem = await import("viem" as string);
    accounts = await import("viem/accounts" as string);
  } catch {
    tt.skip("viem not installed");
    return;
  }
  const seller = accounts.privateKeyToAccount(`0x${"43".repeat(32)}`);
  const signature = await seller.signTypedData(receiptTypedData(PAYLOAD));
  const who = await viem.recoverTypedDataAddress({ domain: { name: "x402 receipt", version: "1", chainId: 1 }, types: FAC_RECEIPT_TYPES, primaryType: "Receipt",
    message: { ...PAYLOAD, version: 1n, issuedAt: BigInt(PAYLOAD.issuedAt) }, signature });
  assert.equal(who, seller.address);
});
