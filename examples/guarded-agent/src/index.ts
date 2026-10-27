/**
 * An agent that will not buy until Toll's check passes.
 *   npm start -- <token> [--chain rh|sol|bsc]
 * Information only, not financial advice. buy() is a stub: it prints and sends nothing.
 */
import { Toll, TollError, type Chain } from "@tollxyz/sdk";
import { decide } from "./rule.js";

/** Stub. A real agent would swap here; this one only prints. It never signs or sends a transaction. */
export function buy(token: string, chain: string): void {
  console.log(`[stub] would buy ${token} on ${chain} here. Nothing was sent.`);
}

export function parseArgs(argv: string[]): { token: string; chain?: Chain } | { error: string } {
  const args = [...argv];
  let chain: string | undefined;
  const i = args.indexOf("--chain");
  if (i >= 0) {
    chain = args[i + 1];
    args.splice(i, 2);
  }
  if (chain !== undefined && !["rh", "sol", "bsc"].includes(chain)) return { error: `Invalid --chain "${chain}": use rh, sol or bsc.` };
  const token = args[0];
  if (!token) return { error: "Usage: npm start -- <token> [--chain rh|sol|bsc]" };
  return { token, ...(chain ? { chain: chain as Chain } : {}) };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const { token, chain } = parsed;
  const toll = new Toll();
  try {
    const check = await toll.checkCoin(token, chain ? { chain } : {});
    // The LARP check reads Robinhood Chain and Solana only; for BSC the product label stays unread.
    const larpChain = chain === "rh" || chain === "sol" ? chain : undefined;
    const larp = chain === "bsc" ? null : await toll.larpCheck(token, { wait: true, ...(larpChain ? { chain: larpChain } : {}) });

    console.log(check.text);
    if (larp) console.log("\n" + larp.text);
    for (const r of [check, larp]) if (r?.paidUrl) console.log(`\nFree coins used up. Pay per check at ${r.paidUrl} (x402, 0.05 USDG on Robinhood Chain) or hold 1M $TOLL.`);

    const d = decide(check.text, larp ? larp.text : null);
    console.log(`\nDecision: ${d.outcome}`);
    for (const r of d.reasons) console.log(`- ${r}`);
    console.log("Information only, not financial advice.");
    if (d.outcome === "would proceed") buy(token, chain ?? "auto");
    return d.outcome === "refuse" ? 1 : 0;
  } catch (e) {
    console.error(e instanceof TollError ? e.message : "Request failed.");
    return 2;
  }
}

if (process.argv[1]?.endsWith("index.ts")) {
  main().then((code) => process.exit(code));
}
