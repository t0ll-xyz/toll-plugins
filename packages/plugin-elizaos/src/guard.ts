/**
 * withTollPreBuy (0.6.0): put Toll's pre_buy_check in front of another plugin's buy or swap action.
 *
 * elizaOS has no pre-sign hook in its EVM plugin (@elizaos/plugin-evm 1.0.13 builds and sends inside each action), so
 * the gate wraps the action itself: before its handler runs, Toll is asked about the coin it would buy. Only
 * Decision: ALLOW lets the handler run. BLOCK, WAIT, a WARN (unless onWarn: "allow"), no decision, no token address and
 * Toll not answering all refuse: fail closed. TOLL_GUARD=off (setting or env) is the one switch that turns it off.
 * Robinhood Chain (4663) only. Information only, not advice.
 */
import type { Action, HandlerCallback, IAgentRuntime, Memory, State } from "@elizaos/core";
import { Toll, TollError } from "@tollxyz/sdk";
import { extractAddress } from "./format.js";

export interface PreBuyGuardOptions {
  /** A ready Toll client. Default: new Toll({ tollKey }). */
  client?: Toll;
  /** A Toll key, sent with every call. Ignored when client is given. */
  tollKey?: string;
  /** Your time budget in ms (your timeout minus your round trip). Not read in time = WAIT = refused, asked again later. */
  budgetMs?: number;
  /** What a WARN does: "block" (default, the strict preset) or "allow" (the warning is passed on, the buy runs). */
  onWarn?: "block" | "allow";
  /** Where the token to buy is: default the first 0x address in the message text. Return null when there is none. */
  addressOf?: (message: Memory, options: unknown) => string | null;
}

/** the switch: on unless TOLL_GUARD is "off" (the agent's setting first, then the environment) */
function guardOff(rt: IAgentRuntime | undefined): boolean {
  let v: unknown;
  try {
    v = (rt as { getSetting?: (k: string) => unknown } | undefined)?.getSetting?.("TOLL_GUARD");
  } catch {
    v = undefined;
  }
  if (typeof v !== "string") v = typeof process !== "undefined" ? process.env?.TOLL_GUARD : undefined;
  return typeof v === "string" && v.trim().toLowerCase() === "off";
}

/** Returns the same action with Toll's pre_buy_check run first; the original handler runs only on ALLOW (or WARN with onWarn: "allow"). */
export function withTollPreBuy(action: Action, opts: PreBuyGuardOptions = {}): Action {
  const toll = opts.client ?? new Toll({ ...(opts.tollKey ? { tollKey: opts.tollKey } : {}) });
  const budget = opts.budgetMs === undefined ? {} : { budgetMs: opts.budgetMs };
  const original = action.handler;
  const handler = (async (rt: IAgentRuntime, message: Memory, state?: State, options?: unknown, callback?: HandlerCallback, responses?: Memory[]) => {
    const run = () => (original as (...a: unknown[]) => Promise<unknown>)(rt, message, state, options, callback, responses);
    if (guardOff(rt)) return run();
    const refuse = async (why: string) => {
      const text = `${action.name} was not run: ${why}`;
      await callback?.({ text, actions: [action.name], source: message?.content?.source });
      return { success: false, text, error: text, data: { actionName: action.name, toll: "refused" } };
    };
    const text = typeof message?.content?.text === "string" ? message.content.text : "";
    const address = opts.addressOf ? opts.addressOf(message, options) : (extractAddress(text)?.address ?? null);
    if (!address) return refuse("no token address to check with Toll (send the full 0x address).");
    let r;
    try {
      r = await toll.preBuyCheck(address, budget);
    } catch (e) {
      return refuse(`Toll could not answer (${e instanceof TollError ? e.message : "request failed"}), so nothing was bought. Ask again.`);
    }
    const reasons = r.text.split(/\r?\n/).slice(1, 4).filter((l) => l.trim()).join(" ");
    switch (r.decision) {
      case "ALLOW":
        return run();
      case "WARN":
        if (opts.onWarn === "allow") {
          await callback?.({ text: `Toll warned before ${action.name}: ${reasons}`, actions: [action.name], source: message?.content?.source });
          return run();
        }
        return refuse(`Toll answered WARN for ${address}: ${reasons}`);
      case "BLOCK":
        return refuse(`Toll answered BLOCK for ${address}: ${reasons} Do not buy without the user's say.`);
      case "WAIT":
        return refuse(`Toll is still reading ${address}: ask again in ${r.pending?.retryAfterS ?? 5} s.`);
      default:
        return refuse(`Toll gave no decision for ${address}: ${r.text.split(/\r?\n/)[0] ?? ""}`);
    }
  }) as Action["handler"];
  return { ...action, handler };
}
