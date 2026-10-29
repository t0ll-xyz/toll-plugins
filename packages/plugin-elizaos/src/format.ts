import type { TollResult } from "@tollxyz/sdk";

/** Toll's text, plus one line when the free coins are used up or the read is still running. */
export function formatResult(r: TollResult): string {
  let out = r.text.trim();
  if (r.paidUrl) {
    out += `\n\nFree coins for today are used up. You can pay per check at ${r.paidUrl} (x402: 0.05 USDG on Robinhood Chain or USDC on Base). Holding $TOLL does not lift this limit.`;
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

const EVM = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
// A Solana mint only as a whole word: start/end of text, whitespace or punctuation on both sides.
const BASE58 = /(?<![^\s.,;:!?()[\]{}<>"'`*~|\/\-])[1-9A-HJ-NP-Za-km-z]{32,44}(?![^\s.,;:!?()[\]{}<>"'`*~|\/\-])/;

/** First token address (0x + 40 hex, or Solana base58) in a message, with a chain when the text names one. */
export function extractAddress(text: string): { address: string; chain?: "rh" | "sol" | "bsc" } | null {
  const evm = EVM.exec(text);
  if (evm) {
    const t = text.toLowerCase();
    const chain = /\b(bsc|bnb|binance)\b/.test(t) ? "bsc" : /\b(robinhood|rh)\b/.test(t) ? "rh" : undefined;
    return { address: evm[0], ...(chain ? { chain } : {}) };
  }
  const sol = BASE58.exec(text);
  if (sol) return { address: sol[0], chain: "sol" };
  return null;
}

/** First wallet (0x + 40 hex) in a message. */
export function extractWallet(text: string): { wallet: string; chain?: "bsc" } | null {
  const evm = EVM.exec(text);
  if (!evm) return null;
  const chain = /\b(bsc|bnb|binance)\b/i.test(text) ? "bsc" : undefined;
  return { wallet: evm[0], ...(chain ? { chain } : {}) };
}
