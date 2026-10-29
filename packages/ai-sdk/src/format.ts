import type { TollResult } from "@tollxyz/sdk";

/** Toll's text, plus one line when the free coins are used up or the read is still running. */
export function formatResult(r: TollResult): string {
  let out = r.text.trim();
  if (r.paidUrl) {
    out += `\n\nFree coins for today are used up. You can pay per check at ${r.paidUrl} (x402, 0.05 USDG on Robinhood Chain) or hold 1M $TOLL.`;
  }
  if (r.pending) {
    const note = `Part of the answer is still being read: ask again in ${r.pending.retryAfterS} seconds.`;
    // Keep Toll's closing t0ll.xyz link as the last line.
    const lines = out.split("\n");
    const last = lines[lines.length - 1] ?? "";
    out = lines.length > 1 && /https:\/\/t0ll\.xyz\//.test(last)
      ? `${lines.slice(0, -1).join("\n").trimEnd()}\n\n${note}\n\n${last}`
      : `${out}\n\n${note}`;
  }
  return out;
}
