/**
 * The decision rule of the guarded agent. Pure functions, no network.
 * Information only, not financial advice: this is a pattern, not a recommendation.
 */

export interface Tally {
  against: number;
  careful: number;
  clear: number;
}

export type ProductLabel = "found" | "partly found" | "not found" | "not read";

/**
 * Reads "Findings: 2 against, 1 careful, 5 clear" from a check_coin answer.
 * Falls back to counting "- against:" / "- careful:" / "- clear:" bullets.
 * Returns null when neither is present (for example an over-quota answer).
 */
export function parseTally(text: string): Tally | null {
  const line = /^\s*Findings:\s*(.+)$/im.exec(text);
  if (line) {
    const n = (word: string) => {
      const m = new RegExp(`(\\d+)\\s+${word}\\b`, "i").exec(line[1]);
      return m ? Number(m[1]) : 0;
    };
    const t = { against: n("against"), careful: n("careful"), clear: n("clear") };
    if (/\d/.test(line[1])) return t;
  }
  const count = (word: string) => (text.match(new RegExp(`^\\s*-\\s*${word}:`, "gim")) ?? []).length;
  const t = { against: count("against"), careful: count("careful"), clear: count("clear") };
  return t.against + t.careful + t.clear > 0 ? t : null;
}

/** Reads the label from "LARP check of $X on Robinhood Chain: product found." */
export function parseProductLabel(text: string): ProductLabel | null {
  const head = /^LARP check of [^\n]*?:\s*(?:product\s+)?(partly found|not found|not read|found)\b/im.exec(text);
  return head ? (head[1].toLowerCase() as ProductLabel) : null;
}

export interface Decision {
  outcome: "refuse" | "would proceed";
  reasons: string[];
}

/**
 * The rule, in order:
 *  1. Toll's tally shows any "against" finding            -> refuse
 *  2. the product label is "not found"                    -> refuse
 *  3. the tally or the label could not be read            -> refuse (no answer is not a pass)
 *  4. otherwise                                           -> would proceed
 * "partly found" and "not read" do not refuse by themselves; they are listed in the reasons.
 */
export function decide(checkText: string, larpText: string | null): Decision {
  const reasons: string[] = [];
  const tally = parseTally(checkText);
  // larpText null = the LARP check was not run (it does not cover BSC): the label counts as not read.
  const label = larpText === null ? "not read" : parseProductLabel(larpText);
  let refuse = false;

  if (!tally) {
    refuse = true;
    reasons.push("could not read Toll's tally (no Findings line in the check answer)");
  } else if (tally.against > 0) {
    refuse = true;
    reasons.push(`Toll's tally shows ${tally.against} against`);
  }
  if (!label) {
    refuse = true;
    reasons.push("could not read the product label (no LARP label in the answer)");
  } else if (label === "not found") {
    refuse = true;
    reasons.push("product label is not found");
  } else if (label !== "found") {
    reasons.push(`product label is ${label} (not a refusal on its own)`);
  }
  if (!refuse) {
    reasons.unshift(`tally: ${tally!.against} against, ${tally!.careful} careful, ${tally!.clear} clear; product ${label}`);
  }
  return { outcome: refuse ? "refuse" : "would proceed", reasons };
}
