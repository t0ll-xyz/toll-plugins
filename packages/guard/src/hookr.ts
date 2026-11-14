/**
 * guardHookr (the release after 0.6.1): Toll's check on every unsigned call a Hookr builder returns, before the wallet sees it.
 *
 * Hookr's SDK (npm hookr-sdk) and its MCP (hookr_build_*) hand back unsigned calls: `{ to, data, value? }`, one or
 * several. The wallet then signs them. This wraps the builders so each call goes through Toll's check_tx first, under
 * the same policy as every other guard here (BLOCK throws TollBlockedError; a WARN with a high or critical warning is
 * blocked by default; Toll unreachable fails closed).
 *
 *   import * as hookr from "hookr-sdk";
 *   import { guardHookr } from "@tollxyz/guard";
 *
 *   const checked = guardHookr(hookr, { from: account });
 *   const swapCall = await checked.buildSwap(manifest, swap);      // the one change: `await`
 *   await wallet.sendTransaction({ account, ...swapCall });
 *
 * Opt-in by import: nothing else in this package changes. Notes on what it does and does not do:
 *   - Only functions whose name starts with `build` are wrapped. `buildQuote` is left as it is: its call is read with
 *     eth_call, never signed. Everything else on the object (reads, ABIs, constants) passes through untouched.
 *   - A builder's result that carries no call (a predicted token address, a number) is returned as it is, unchecked:
 *     there is nothing to sign in it.
 *   - The call is returned unchanged. Nothing is added to it and nothing is sent anywhere but to Toll's check.
 *   - Toll reads Robinhood Chain (4663) only. A call built for another chain is "unsupported": by default it goes
 *     ahead unchecked and is logged and reported as not checked; `onUnsupported: "block"` or `strict` refuses it.
 *   - For a swap, Toll's check_tx reads the pool's hook itself (what it can do, the Agent gate): no second request.
 * The builders are synchronous in Hookr's SDK; the wrapped ones return a promise, because the check is a network call.
 */
import { TX_CHAIN_ID, type CheckInput, type Numberish } from "./check.js";
import { enforce, type GuardOptions, type GuardReport } from "./policy.js";

/** an unsigned call as Hookr's SDK and MCP return it */
export interface HookrCall {
  to: string;
  data: string;
  value?: Numberish;
}

export interface HookrGuardOptions extends GuardOptions {
  /** the wallet that will sign (or a function that returns it): Toll compares who a call pays with it */
  from?: string | (() => string | undefined | null);
  /** the chain the calls were built for (default 4663, Robinhood Chain) */
  chainId?: Numberish;
  /** builder names to leave unwrapped, beside buildQuote */
  skip?: readonly string[];
  /** called with each call's report, after the check (as onReport, but with the call) */
  onCall?: (call: HookrCall, report: GuardReport) => void | Promise<void>;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
/** never signed: its call is read with eth_call */
const NOT_SIGNED: ReadonlySet<string> = new Set(["buildQuote"]);

/** is this value one unsigned call: an address in `to` and hex calldata in `data` */
export function isHookrCall(x: unknown): x is HookrCall {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const c = x as Record<string, unknown>;
  return typeof c.to === "string" && ADDR.test(c.to) && typeof c.data === "string" && HEX.test(c.data);
}

/**
 * The unsigned calls inside what a builder returned: the value itself, an array of calls, or an object with a `calls`
 * array (Hookr's MCP answers `{ calls: [...] }`). Anything else has no call in it: [].
 */
export function hookrCallsOf(built: unknown): HookrCall[] {
  if (isHookrCall(built)) return [built];
  if (Array.isArray(built)) return built.filter(isHookrCall);
  if (built && typeof built === "object" && Array.isArray((built as { calls?: unknown }).calls)) {
    return ((built as { calls: unknown[] }).calls).filter(isHookrCall);
  }
  return [];
}

function fromOf(o: HookrGuardOptions): string | undefined {
  const f = typeof o.from === "function" ? o.from() : o.from;
  return typeof f === "string" && ADDR.test(f) ? f : undefined;
}

/**
 * Check what a Hookr builder (or a hookr_build_* MCP tool) returned, one call after the other, in order. Resolves with
 * the same value, untouched, when every call may go ahead; throws at the first one that may not (the calls after it
 * are not checked: none of them should be signed). A value with no call in it resolves at once, unchecked.
 */
export async function checkHookrCalls<T>(built: T, o: HookrGuardOptions = {}): Promise<T> {
  const from = fromOf(o);
  for (const call of hookrCallsOf(built)) {
    const input: CheckInput = { chainId: o.chainId ?? TX_CHAIN_ID, to: call.to, data: call.data,
      ...(call.value !== undefined ? { value: call.value } : {}), ...(from ? { from } : {}) };
    const report = await enforce("transaction", () => input, o);
    if (o.onCall) {
      try { await o.onCall(call, report); } catch { /* a reporting hook never changes the decision */ }
    }
  }
  return built;
}

/** the wrapped object's type: each `build*` function now returns a promise of what it returned; the rest is as it was */
export type GuardedHookr<T> = {
  [K in keyof T]: K extends `build${string}`
    ? K extends "buildQuote" ? T[K]
      : T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : T[K]
    : T[K];
};

/**
 * Wrap Hookr's SDK (the module namespace, or any object of builders): every `build*` function's result is checked by
 * Toll before it is returned. See the file's header for the one-line change and what is left alone.
 */
export function guardHookr<T extends object>(sdk: T, o: HookrGuardOptions = {}): GuardedHookr<T> {
  const skip = new Set<string>([...NOT_SIGNED, ...(o.skip ?? [])]);
  const made = new Map<PropertyKey, unknown>();
  return new Proxy(sdk, {
    get(target, prop, receiver) {
      // read with the target as `this`: a module namespace object refuses a foreign receiver
      const v = Reflect.get(target, prop, target === receiver ? receiver : target);
      if (typeof prop !== "string" || typeof v !== "function" || !prop.startsWith("build") || skip.has(prop)) return v;
      const had = made.get(prop);
      if (had) return had;
      const wrapped = async (...args: unknown[]) => checkHookrCalls(await (v as (...a: unknown[]) => unknown).apply(target, args), o);
      made.set(prop, wrapped);
      return wrapped;
    },
  }) as unknown as GuardedHookr<T>;
}
