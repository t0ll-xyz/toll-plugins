import type { TollResult } from "@tollxyz/sdk";
import { LIMITS_NOTE } from "./markets.js";

/** Toll's text, plus one line when the free coins are used up or the read is still running. */
export function formatResult(r: TollResult): string {
  let out = r.text.trim();
  if (r.paidUrl) {
    out += `\n\nFree coins for today are used up. You can pay per check at ${r.paidUrl} (x402: 0.05 USDG on Robinhood Chain or USDC on Base; pay only with the owner's consent). ${LIMITS_NOTE}`;
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

/** First Robinhood Chain token address (0x + 40 hex) in a message. Toll reads Robinhood Chain only. */
export function extractAddress(text: string): { address: string } | null {
  const evm = EVM.exec(text);
  return evm ? { address: evm[0] } : null;
}

/** Every distinct token address in a message (lower-cased, first 20), for TOLL_CHECK_COINS. */
export function extractAddresses(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(EVM.source, "g"))) {
    const a = m[0].toLowerCase();
    if (!out.includes(a)) out.push(a);
    if (out.length === 20) break;
  }
  return out;
}

/** First wallet (0x + 40 hex) in a message. */
export function extractWallet(text: string): { wallet: string } | null {
  const evm = EVM.exec(text);
  return evm ? { wallet: evm[0] } : null;
}

/** An ERC-8004 agent id in a message: "agent 20030", "agent #20030", "agent id 20030". Null when there is none. */
export function extractAgentId(text: string): number | null {
  const m = /\bagent\s*(?:id\s*)?#?\s*(\d{1,10})\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n <= 1_000_000_000 ? n : null;
}

/** The first JSON object in a message (a pasted transaction, typed data, x402 402 body or PresignRequest), or null. */
export function extractJson(text: string): Record<string, unknown> | null {
  const end = text.lastIndexOf("}");
  for (let i = text.indexOf("{"); i !== -1 && i < end; i = text.indexOf("{", i + 1)) {
    try {
      const v = JSON.parse(text.slice(i, end + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try the next brace */
    }
  }
  return null;
}

// Capitalised words that are not tickers when they stand alone in a message.
const NOT_TICKERS = new Set([
  "I", "A", "RH", "US", "USA", "USD", "USDG", "USDC", "ETH", "SEC", "ETF", "CEO", "API", "OK", "NYSE", "UTC", "AI", "IPO", "TOLL", "LARP", "BSC", "SOL", "NFT", "DM", "PM", "AM",
  // Words a fundamentals, insider or macro question carries.
  "P", "E", "PE", "EPS", "TTM", "YOY", "QOQ", "FY", "CFO", "COO", "CTO", "EVP", "SVP", "CPI", "GDP", "FED", "FOMC", "EFFR", "BLS",
  // Words an institutions or guidance question carries.
  "KPI", "KPIS", "GAAP", "Q", "ERC",
]);
const CASHTAG = /(?<![A-Za-z0-9])\$([A-Za-z][A-Za-z0-9.\-]{0,11})(?![A-Za-z0-9])/;
const CAPS = /(?<![A-Za-z0-9$.])([A-Z]{1,5}(?:\.[A-Z])?)(?![A-Za-z0-9])/g;

/**
 * The Stock Token a message names: a 0x contract, a cashtag ($NVDA), or a standalone capitalised ticker (NVDA, BRK.B).
 * Null when it names none.
 */
export function extractStockId(text: string): string | null {
  const evm = EVM.exec(text);
  if (evm) return evm[0];
  const tag = CASHTAG.exec(text);
  if (tag) return tag[1].replace(/[.\-]+$/, "").toUpperCase();
  for (const m of text.matchAll(CAPS)) {
    if (!NOT_TICKERS.has(m[1])) return m[1];
  }
  return null;
}
