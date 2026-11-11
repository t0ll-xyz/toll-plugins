/**
 * What a request spends, read locally (calldata, typed data, an x402 requirement) and, when Toll's answer carries one,
 * from its simulation (x-toll.simulation). Only outflows of the spend assets count (default: native ETH, WETH and USDG
 * on Robinhood Chain), so selling a coin that is not a spend asset is never capped.
 */
import { isAddress, type CheckInput, type RiskAssessment } from "./check.js";

/** native ETH as a spend-asset key */
export const NATIVE = "native";
/** USDG on Robinhood Chain */
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
/** WETH on Robinhood Chain */
export const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
/** the spend assets when none are given */
export const DEFAULT_SPEND_ASSETS: readonly string[] = [NATIVE, WETH, USDG];
/** an unlimited allowance (type(uint256).max): larger than any cap */
export const UNLIMITED = (1n << 256n) - 1n;

/** Permit2 (same address on every chain) */
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
/** native ETH as the simulation names it */
const SIM_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export interface SpendItem {
  kind: "value" | "transfer" | "approve" | "x402" | "simulation";
  /** "native" or a lowercase token address */
  asset: string;
  /** base units; UNLIMITED for an unlimited allowance */
  amount: bigint;
  to?: string;
  spender?: string;
  payTo?: string;
}

export interface Spend {
  items: SpendItem[];
  /** per asset, base units leaving the signer: the larger of what the call declares and what the simulation shows */
  outflow: Record<string, bigint>;
  /** per asset, the largest allowance granted (UNLIMITED = infinite) */
  approvals: Record<string, bigint>;
  /** who the request pays or calls (a token transfer's recipient, else the transaction's `to`), lowercase */
  to: string[];
  /** spenders an approval or permit names, lowercase */
  spender: string[];
  /** x402 payees, lowercase */
  payTo: string[];
  /** true when what leaves the wallet could not be read (a contract call with no simulation, a raw user operation) */
  unknown: boolean;
  /** true when Toll's simulation was read */
  simulated: boolean;
}

const lc = (x: unknown): string => String(x ?? "").toLowerCase();

const big = (x: unknown): bigint | null => {
  try {
    if (typeof x === "bigint") return x;
    if (typeof x === "number") return Number.isSafeInteger(x) ? BigInt(x) : null;
    if (typeof x === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(x.trim())) return BigInt(x.trim());
  } catch {
    /* unreadable */
  }
  return null;
};

const SEL = {
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
  approve: "0x095ea7b3",
  increaseAllowance: "0x39509351",
  deposit: "0xd0e30db0",
  withdraw: "0x2e1a7d4d",
} as const;

function words(data: string): string[] {
  const body = data.slice(10);
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}
const wAddr = (w: string | undefined) => (w ? "0x" + w.slice(24).toLowerCase() : "");
const wInt = (w: string | undefined) => (w ? BigInt("0x" + w) : 0n);

class Acc {
  items: SpendItem[] = [];
  declared: Record<string, bigint> = {};
  simOut: Record<string, bigint> = {};
  approvals: Record<string, bigint> = {};
  to = new Set<string>();
  spender = new Set<string>();
  payTo = new Set<string>();
  unknown = false;
  simulated = false;
  constructor(readonly assets: Set<string>) {}
  out(asset: string, amount: bigint, item: Omit<SpendItem, "asset" | "amount">, max = false) {
    if (!this.assets.has(asset) || amount <= 0n) return;
    const cur = this.declared[asset] ?? 0n;
    this.declared[asset] = max ? (amount > cur ? amount : cur) : cur + amount;
    this.items.push({ ...item, asset, amount });
  }
  approve(asset: string, amount: bigint, spender: string) {
    if (spender) this.spender.add(spender);
    if (!this.assets.has(asset)) return;
    const cur = this.approvals[asset] ?? 0n;
    if (amount > cur) this.approvals[asset] = amount;
    this.items.push({ kind: "approve", asset, amount, spender });
  }
  done(): Spend {
    const outflow: Record<string, bigint> = {};
    for (const a of new Set([...Object.keys(this.declared), ...Object.keys(this.simOut)])) {
      const d = this.declared[a] ?? 0n;
      const s = this.simOut[a] ?? 0n;
      outflow[a] = s > d ? s : d;
    }
    return { items: this.items, outflow, approvals: this.approvals, to: [...this.to], spender: [...this.spender], payTo: [...this.payTo], unknown: this.unknown && !this.simulated, simulated: this.simulated };
  }
}

function decodeTx(i: CheckInput, acc: Acc) {
  const from = isAddress(i.from) ? lc(i.from) : null;
  const target = lc(i.to);
  // a value that cannot be read (a JS number past 2^53, text) is not "nothing sent": unknown (0.6.0)
  const read = big(i.value ?? 0);
  if (read === null) acc.unknown = true;
  const value = read ?? 0n;
  const data = typeof i.data === "string" ? i.data : "0x";
  if (value > 0n) acc.out(NATIVE, value, { kind: "value", to: target });
  if (data.length < 10) {
    if (target) acc.to.add(target);
    return;
  }
  const sel = data.slice(0, 10).toLowerCase();
  const w = words(data);
  if (sel === SEL.transfer && w.length >= 2) {
    const to = wAddr(w[0]);
    acc.to.add(to);
    acc.out(target, wInt(w[1]), { kind: "transfer", to });
    return;
  }
  if (sel === SEL.transferFrom && w.length >= 3) {
    const src = wAddr(w[0]);
    // transferFrom(from, to, amount): the recipient is the SECOND word (0.6.0: it was read from the amount word)
    const to = wAddr(w[1]);
    acc.to.add(to);
    // only the signer's own tokens are its spend
    if (!from || src === from) acc.out(target, wInt(w[2]), { kind: "transfer", to });
    return;
  }
  if ((sel === SEL.approve || sel === SEL.increaseAllowance) && w.length >= 2) {
    acc.approve(target, wInt(w[1]), wAddr(w[0]));
    return;
  }
  acc.to.add(target);
  // WETH deposit (the value is already counted) and withdraw (WETH back to ETH): no new spend
  if (target === WETH && (sel === SEL.deposit || sel === SEL.withdraw)) return;
  acc.unknown = true;
}

function decodeTyped(td: { domain?: Record<string, unknown>; primaryType?: string; message?: Record<string, unknown> }, acc: Acc, signer: string | null) {
  const vc = lc(td.domain?.verifyingContract);
  const m = (td.message ?? {}) as Record<string, any>;
  const p = String(td.primaryType ?? "");
  if (vc === PERMIT2) {
    const spender = lc(m.spender);
    if (p === "PermitSingle") acc.approve(lc(m.details?.token), big(m.details?.amount) ?? UNLIMITED, spender);
    else if (p === "PermitBatch") for (const d of Array.isArray(m.details) ? m.details : []) acc.approve(lc(d?.token), big(d?.amount) ?? UNLIMITED, spender);
    else if (p === "PermitTransferFrom" || p === "PermitWitnessTransferFrom") acc.approve(lc(m.permitted?.token), big(m.permitted?.amount) ?? UNLIMITED, spender);
    else if (p === "PermitBatchTransferFrom" || p === "PermitBatchWitnessTransferFrom") for (const d of Array.isArray(m.permitted) ? m.permitted : []) acc.approve(lc(d?.token), big(d?.amount) ?? UNLIMITED, spender);
    return;
  }
  if (p === "Permit" && m.spender !== undefined) {
    acc.approve(vc, big(m.value) ?? UNLIMITED, lc(m.spender));
    return;
  }
  if ((p === "TransferWithAuthorization" || p === "ReceiveWithAuthorization") && (!signer || lc(m.from) === signer || m.from === undefined)) {
    const to = lc(m.to);
    acc.to.add(to);
    acc.out(vc, big(m.value) ?? 0n, { kind: "transfer", to });
  }
}

function typedOf(i: CheckInput): Record<string, any> | null {
  if (i.typedData) return i.typedData as Record<string, any>;
  if (i.rpc?.method !== "eth_signTypedData_v4") return null;
  let td: unknown = i.rpc.params?.[1];
  if (typeof td === "string") {
    try {
      td = JSON.parse(td);
    } catch {
      return null;
    }
  }
  return td && typeof td === "object" ? (td as Record<string, any>) : null;
}

function decodeX402(x: Record<string, unknown>, acc: Acc) {
  const entries = Array.isArray(x.accepts) ? (x.accepts as unknown[]) : [x];
  for (const raw of entries) {
    const e = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const payTo = lc(e.payTo);
    if (payTo) acc.payTo.add(payTo);
    const amt = big(e.amount ?? e.maxAmountRequired);
    // the client pays one entry: the largest per asset counts. An amount that cannot be read (0.6.0: "+5000000",
    // "5e6", none) is not zero: the caps cannot be applied to it, so the spend is unknown
    if (amt !== null) acc.out(lc(e.asset), amt, { kind: "x402", payTo }, true);
    else acc.unknown = true;
  }
}

function readSim(a: RiskAssessment | null | undefined, from: string | null, acc: Acc) {
  const s = a?.["x-toll"]?.simulation as Record<string, any> | undefined;
  if (!s || !from) return;
  const eff = s.status === "success" || s.status === "reverted" ? s : s.status === "insufficient-eth" ? s.effects : null;
  if (!eff || !Array.isArray(eff.deltas)) return;
  acc.simulated = true;
  for (const d of eff.deltas) {
    if (lc(d?.holder) !== from) continue;
    const delta = big(String(d?.delta ?? "").replace(/^-/, ""));
    if (delta === null || !String(d?.delta).startsWith("-")) continue;
    const tok = lc(d?.token);
    const asset = tok === SIM_NATIVE || tok === "0x0000000000000000000000000000000000000000" ? NATIVE : tok;
    if (!acc.assets.has(asset)) continue;
    acc.simOut[asset] = (acc.simOut[asset] ?? 0n) + delta;
    acc.items.push({ kind: "simulation", asset, amount: delta });
  }
  for (const ap of Array.isArray(eff.approvals) ? eff.approvals : []) {
    if (lc(ap?.owner) !== from || ap?.kind === "nft-all") continue;
    acc.approve(lc(ap?.token), ap?.amount === null || ap?.amount === undefined ? UNLIMITED : (big(ap.amount) ?? UNLIMITED), lc(ap?.spender));
  }
}

/**
 * What a request spends. `assessment` is Toll's answer (null when Toll was not asked or could not answer): its
 * simulation, when read, beats the declared amounts upward. `assets` are the spend assets ("native" or token addresses).
 */
export function spendOf(input: CheckInput, assessment: RiskAssessment | null | undefined, assets: readonly string[] = DEFAULT_SPEND_ASSETS): Spend {
  const acc = new Acc(new Set(assets.map(lc)));
  const isTx = input.to !== undefined || input.data !== undefined;
  const signer = isAddress(input.from) ? lc(input.from) : isAddress(input.message?.from) ? lc(input.message?.from) : null;
  if (isTx) decodeTx(input, acc);
  else if (input.authorizationList && input.authorizationList.length) acc.unknown = true; // a delegation can move anything
  if (input.userOp) acc.unknown = true; // raw callData is not decoded here
  const td = typedOf(input);
  if (td) decodeTyped(td, acc, signer);
  if (input.x402) decodeX402(input.x402, acc);
  if (isTx) readSim(assessment, signer, acc);
  return acc.done();
}
