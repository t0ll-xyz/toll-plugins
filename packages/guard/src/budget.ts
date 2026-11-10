/**
 * Mirror guard's spend caps into a per-payer budget at Toll's x402 facilitator (x402.t0ll.xyz/budget, COMING: the
 * facilitator answers 404 budgets_off until budgets are switched on). guard enforces caps in the agent's process; the
 * facilitator budget enforces them again where the payment settles, so a second process, a leaked key used elsewhere or
 * a bug in the agent cannot spend past them through that facilitator.
 *
 * The words match: guard's assets[USDG].perCall is the budget's perPayment, assets[USDG].perDay its perDay, perEndpoint
 * day caps become payToCaps (the facilitator sees a payTo, not a URL, so each endpoint needs its payTo) and allow.payTo
 * becomes allowedPayTos. Nothing here changes how guard itself behaves. Amounts are USDG base units (6 decimals).
 */
import { isAddress } from "./check.js";
import type { SpendPolicy } from "./policy.js";
import { USDG } from "./spend.js";

/** The budget's EIP-712 domain: no verifyingContract (nothing on chain checks it). */
export const BUDGET_DOMAIN = { name: "Toll Facilitator Budget", version: "1", chainId: 4663 } as const;
export const BUDGET_TYPES = {
  Budget: [
    { name: "payer", type: "address" },
    { name: "perPayment", type: "uint256" },
    { name: "perDay", type: "uint256" },
    { name: "perPayTo", type: "uint256" },
    { name: "payToCaps", type: "PayToCap[]" },
    { name: "allowedPayTos", type: "address[]" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
  PayToCap: [
    { name: "payTo", type: "address" },
    { name: "perDay", type: "uint256" },
  ],
} as const;
/** at most this many payToCaps and allowedPayTos */
export const BUDGET_MAX_PAYTOS = 50;

export interface GuardBudgetOptions {
  /** the agent's paying wallet (it signs the budget) */
  payer: string;
  /** newer wins at the facilitator: use a growing number, e.g. BigInt(Date.now()) */
  nonce: bigint | number | string;
  /** unix seconds the budget ends; 0 or unset = no end */
  validUntil?: bigint | number | string;
  /** the payTo of each perEndpoint prefix (same keys); a perEndpoint key that is itself an address is its own payTo */
  endpointPayTo?: Record<string, string>;
  /** one day cap for every payTo, base units; 0 or unset = not set */
  perPayTo?: bigint;
  /** perPayment when the policy has no assets[USDG].perCall (the facilitator needs one: 0 lets nothing through) */
  perPayment?: bigint;
  /** perDay when the policy has no assets[USDG].perDay */
  perDay?: bigint;
}

export interface GuardBudgetMessage {
  payer: string;
  perPayment: bigint;
  perDay: bigint;
  perPayTo: bigint;
  payToCaps: Array<{ payTo: string; perDay: bigint }>;
  allowedPayTos: string[];
  validUntil: bigint;
  nonce: bigint;
}

export interface GuardBudget {
  /** the budget (the typed message), for @tollxyz/sdk's setBudget({ budget, signature }) */
  budget: GuardBudgetMessage;
  /** EIP-712 typed data for the payer to sign (viem: account.signTypedData(typedData)) */
  typedData: { domain: { name: string; version: string; chainId: number }; types: typeof BUDGET_TYPES; primaryType: "Budget"; message: GuardBudgetMessage };
  /** guard rules the facilitator budget cannot hold (guard still enforces them in-process) */
  notMirrored: string[];
}

const MAX_U64 = (1n << 64n) - 1n;

function uint(v: unknown, name: string, max = (1n << 256n) - 1n): bigint {
  let n: bigint | null = null;
  if (typeof v === "bigint") n = v;
  else if (typeof v === "number" && Number.isSafeInteger(v)) n = BigInt(v);
  else if (typeof v === "string" && /^\d{1,78}$/.test(v.trim())) n = BigInt(v.trim());
  if (n === null || n < 0n || n > max) throw new Error(`guardBudget: ${name} must be a whole number from 0`);
  return n;
}

/**
 * The facilitator budget that mirrors a guard SpendPolicy. Throws when the policy has no USDG per-call or per-day cap
 * and none is passed (the facilitator treats a missing cap as 0, which refuses every payment), or when a list is over 50.
 */
export function guardBudget(policy: SpendPolicy | { spend?: SpendPolicy }, opts: GuardBudgetOptions): GuardBudget {
  const sp: SpendPolicy = (policy && "spend" in policy ? (policy as { spend?: SpendPolicy }).spend : (policy as SpendPolicy)) ?? {};
  if (!isAddress(opts.payer)) throw new Error("guardBudget: payer must be a 0x address");
  const notMirrored: string[] = [];

  const assets = sp.assets ?? {};
  const usdgKey = Object.keys(assets).find((k) => k.toLowerCase() === USDG);
  const caps = usdgKey ? assets[usdgKey] : undefined;
  for (const k of Object.keys(assets)) if (k !== usdgKey) notMirrored.push(`assets["${k}"]: the facilitator budget is USDG only`);
  const perPayment = opts.perPayment ?? caps?.perCall;
  const perDay = opts.perDay ?? caps?.perDay;
  if (perPayment === undefined) throw new Error("guardBudget: no USDG per-call cap (set spend.assets[USDG].perCall or pass perPayment)");
  if (perDay === undefined) throw new Error("guardBudget: no USDG per-day cap (set spend.assets[USDG].perDay or pass perDay)");

  const byPayTo = new Map<string, { payTo: string; perDay: bigint }>();
  for (const [prefix, c] of Object.entries(sp.perEndpoint ?? {})) {
    const payTo = opts.endpointPayTo?.[prefix] ?? (isAddress(prefix) ? prefix : undefined);
    if (c.perCall !== undefined) notMirrored.push(`perEndpoint["${prefix}"].perCall: the facilitator has no per-payTo per-payment cap (perPayment applies)`);
    if (c.perDay === undefined) continue;
    if (!payTo) { notMirrored.push(`perEndpoint["${prefix}"].perDay: no payTo known for it (pass endpointPayTo)`); continue; }
    if (!isAddress(payTo)) throw new Error(`guardBudget: endpointPayTo["${prefix}"] must be a 0x address`);
    const had = byPayTo.get(payTo.toLowerCase());
    // two endpoints paying one wallet: the stricter day cap holds for both
    if (!had || c.perDay < had.perDay) byPayTo.set(payTo.toLowerCase(), { payTo, perDay: uint(c.perDay, `perEndpoint["${prefix}"].perDay`) });
  }
  const payToCaps = [...byPayTo.values()];

  const allowed: string[] = [];
  for (const a of sp.allow?.payTo ?? []) {
    if (!isAddress(a)) throw new Error(`guardBudget: allow.payTo entry "${a}" is not an address`);
    if (!allowed.some((x) => x.toLowerCase() === a.toLowerCase())) allowed.push(a);
  }
  if (payToCaps.length > BUDGET_MAX_PAYTOS || allowed.length > BUDGET_MAX_PAYTOS) throw new Error(`guardBudget: at most ${BUDGET_MAX_PAYTOS} payToCaps and allowed payTos`);
  if (sp.allow?.to?.length || sp.allow?.spender?.length) notMirrored.push("allow.to / allow.spender: the facilitator only sees x402 payments (payTo)");
  if (sp.approveAbove || sp.approve) notMirrored.push("approveAbove / approve: human approval stays in guard");

  const budget: GuardBudgetMessage = {
    payer: opts.payer,
    perPayment: uint(perPayment, "perPayment"),
    perDay: uint(perDay, "perDay"),
    perPayTo: uint(opts.perPayTo ?? 0n, "perPayTo"),
    payToCaps,
    allowedPayTos: allowed,
    validUntil: uint(opts.validUntil ?? 0, "validUntil", MAX_U64),
    nonce: uint(opts.nonce, "nonce"),
  };
  return { budget, typedData: { domain: { ...BUDGET_DOMAIN }, types: BUDGET_TYPES, primaryType: "Budget", message: budget }, notMirrored };
}
