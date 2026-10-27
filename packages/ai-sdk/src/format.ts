import type { TollResult } from "@tollxyz/sdk";

/** Toll's text, plus one line when the free coins are used up or the read is still running. */
export function formatResult(r: TollResult): string {
  let out = r.text.trim();
  if (r.paidUrl) {
    out += `\n\nFree coins for today are used up. You can pay per check at ${r.paidUrl} (x402, 0.05 USDG on Robinhood Chain) or hold 1M $TOLL.`;
  }
  if (r.pending) {
    out += `\n\nToll is still reading this one: ask again in ${r.pending.retryAfterS} seconds.`;
  }
  return out;
}
