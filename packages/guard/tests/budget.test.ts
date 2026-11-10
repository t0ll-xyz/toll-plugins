import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET_DOMAIN, USDG, WETH, guardBudget, type SpendPolicy } from "../src/index.js";

const PAYER = "0x1111111111111111111111111111111111111111";
const PAYTO = "0x3954ff905bdb481ad5814d5be3cc32c3166122ac";
const OTHER = "0x2222222222222222222222222222222222222222";
const USDG_MIXED = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

// the facilitator's own definitions (lib/fac/budget.ts), copied: the typed data must hash the same
const FAC_BUDGET_TYPES = {
  Budget: [
    { name: "payer", type: "address" }, { name: "perPayment", type: "uint256" }, { name: "perDay", type: "uint256" },
    { name: "perPayTo", type: "uint256" }, { name: "payToCaps", type: "PayToCap[]" }, { name: "allowedPayTos", type: "address[]" },
    { name: "validUntil", type: "uint64" }, { name: "nonce", type: "uint256" },
  ],
  PayToCap: [{ name: "payTo", type: "address" }, { name: "perDay", type: "uint256" }],
};

const POLICY: SpendPolicy = {
  assets: { [USDG_MIXED]: { perCall: 100_000n, perDay: 1_000_000n } },
  perEndpoint: {
    "https://api.example/quotes": { perDay: 250_000n },
    "https://api.example/news": { perDay: 400_000n, perCall: 10_000n },
    [OTHER]: { perDay: 300_000n },
  },
  allow: { payTo: [PAYTO, OTHER, PAYTO.toUpperCase().replace("0X", "0x")] },
};

test("guardBudget maps guard's caps: perCall -> perPayment, perDay -> perDay, perEndpoint -> payToCaps, allow.payTo -> allowedPayTos", () => {
  const g = guardBudget(POLICY, { payer: PAYER, nonce: 7n, endpointPayTo: { "https://api.example/quotes": PAYTO, "https://api.example/news": PAYTO } });
  assert.deepEqual(g.budget, {
    payer: PAYER, perPayment: 100_000n, perDay: 1_000_000n, perPayTo: 0n,
    // two endpoints paying one wallet: the stricter day cap; an address key is its own payTo
    payToCaps: [{ payTo: PAYTO, perDay: 250_000n }, { payTo: OTHER, perDay: 300_000n }],
    allowedPayTos: [PAYTO, OTHER], validUntil: 0n, nonce: 7n,
  });
  assert.deepEqual(g.typedData.domain, { name: "Toll Facilitator Budget", version: "1", chainId: 4663 });
  assert.deepEqual(g.typedData.domain, BUDGET_DOMAIN);
  assert.equal(g.typedData.primaryType, "Budget");
  assert.deepEqual(JSON.parse(JSON.stringify(g.typedData.types)), FAC_BUDGET_TYPES);
  assert.equal(g.typedData.message, g.budget);
  assert.deepEqual(g.notMirrored, ['perEndpoint["https://api.example/news"].perCall: the facilitator has no per-payTo per-payment cap (perPayment applies)']);
});

test("guardBudget takes GuardOptions ({ spend }) too, and reports what it cannot mirror", () => {
  const g = guardBudget({
    spend: {
      assets: { [USDG]: { perCall: 5n, perDay: 50n }, [WETH]: { perDay: 1n } },
      perEndpoint: { "https://unknown.example/": { perDay: 9n } },
      allow: { to: [OTHER] },
      approveAbove: { [USDG]: 1n },
    },
  }, { payer: PAYER, nonce: "1", validUntil: 1_900_000_000, perPayTo: 20n });
  assert.equal(g.budget.perPayTo, 20n);
  assert.equal(g.budget.validUntil, 1_900_000_000n);
  assert.deepEqual(g.budget.payToCaps, []);
  assert.deepEqual(g.notMirrored, [
    `assets["${WETH}"]: the facilitator budget is USDG only`,
    'perEndpoint["https://unknown.example/"].perDay: no payTo known for it (pass endpointPayTo)',
    "allow.to / allow.spender: the facilitator only sees x402 payments (payTo)",
    "approveAbove / approve: human approval stays in guard",
  ]);
});

test("guardBudget: no USDG cap and none passed throws (a missing cap is 0 at the facilitator); overrides fill it", () => {
  assert.throws(() => guardBudget({}, { payer: PAYER, nonce: 1 }), /per-call/);
  assert.throws(() => guardBudget({ assets: { [USDG]: { perCall: 1n } } }, { payer: PAYER, nonce: 1 }), /per-day/);
  assert.equal(guardBudget({}, { payer: PAYER, nonce: 1, perPayment: 3n, perDay: 30n }).budget.perDay, 30n);
  assert.throws(() => guardBudget(POLICY, { payer: "0x12", nonce: 1 }), /payer/);
  assert.throws(() => guardBudget(POLICY, { payer: PAYER, nonce: -1 }), /nonce/);
  assert.throws(() => guardBudget(POLICY, { payer: PAYER, nonce: 1, endpointPayTo: { "https://api.example/quotes": "nope" } }), /endpointPayTo/);
  assert.throws(() => guardBudget({ ...POLICY, allow: { payTo: ["x"] } }, { payer: PAYER, nonce: 1 }), /allow.payTo/);
  const many = Array.from({ length: 51 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);
  assert.throws(() => guardBudget({ ...POLICY, allow: { payTo: many } }, { payer: PAYER, nonce: 1 }), /50/);
});

test("guardBudget leaves the policy untouched (no behaviour change to guard)", () => {
  const before = JSON.stringify(POLICY, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  guardBudget(POLICY, { payer: PAYER, nonce: 1 });
  assert.equal(JSON.stringify(POLICY, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), before);
});

test("a budget signed from guardBudget's typed data recovers to the payer under the facilitator's types (viem)", async (tt) => {
  let viem: any, accounts: any;
  try {
    viem = await import("viem" as string);
    accounts = await import("viem/accounts" as string);
  } catch {
    tt.skip("viem not installed");
    return;
  }
  const acct = accounts.privateKeyToAccount(`0x${"42".repeat(32)}`);
  const g = guardBudget(POLICY, { payer: acct.address, nonce: 7n, endpointPayTo: { "https://api.example/quotes": PAYTO } });
  const sig = await acct.signTypedData(g.typedData);
  const who = await viem.recoverTypedDataAddress({ domain: { name: "Toll Facilitator Budget", version: "1", chainId: 4663 }, types: FAC_BUDGET_TYPES, primaryType: "Budget", message: g.budget, signature: sig });
  assert.equal(who, acct.address);
  // the same bytes @tollxyz/sdk and toll-sdk sign for this budget and key
  const fixed = guardBudget({ assets: { [USDG]: { perCall: 100000n, perDay: 1000000n } }, perEndpoint: { [PAYTO]: { perDay: 250000n } }, allow: { payTo: [OTHER] } },
    { payer: PAYER, nonce: 5 });
  assert.equal(await acct.signTypedData(fixed.typedData),
    "0x55bd30a77dfa93656da268faba906975e123f19256770ae375eeaff46d30cb145d2babecaecbcbb1f538c537a1cdc336fb8f77a8da29c0effebfe2fe75bccf261c");
});
