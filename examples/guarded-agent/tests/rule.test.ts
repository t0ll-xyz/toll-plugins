import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decide, parseProductLabel, parseTally } from "../src/rule.js";
import { buy, parseArgs } from "../src/index.js";

const fxText = (n: string): string => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8")).result.content[0].text;
const CHECK = fxText("check_coin"); // Findings: 2 against, 1 careful, 5 clear
const LARP = fxText("larp_check"); // product found
const CLEAN = "Findings: 0 against, 1 careful, 7 clear\nAt launch:\n- clear: x";

test("parseTally reads the real Findings line", () => {
  assert.deepEqual(parseTally(CHECK), { against: 2, careful: 1, clear: 5 });
  assert.deepEqual(parseTally(CLEAN), { against: 0, careful: 1, clear: 7 });
});

test("parseTally tolerates missing words and falls back to bullets", () => {
  assert.deepEqual(parseTally("Findings: 3 clear"), { against: 0, careful: 0, clear: 3 });
  assert.deepEqual(parseTally("At launch:\n- against: a\n- against: b\n- clear: c"), { against: 2, careful: 0, clear: 1 });
  assert.equal(parseTally(fxText("check_coin_over")), null);
  assert.equal(parseTally(""), null);
});

test("parseProductLabel reads the four labels", () => {
  assert.equal(parseProductLabel(LARP), "found");
  assert.equal(parseProductLabel("LARP check of $X on Solana: product partly found.\nrest"), "partly found");
  assert.equal(parseProductLabel("LARP check of $X on Solana: product not found."), "not found");
  assert.equal(parseProductLabel("LARP check of $X on Solana: product not read."), "not read");
  assert.equal(parseProductLabel("LARP check of $X on Solana: not found."), "not found");
  assert.equal(parseProductLabel("Still reading 0xabc on Robinhood Chain"), null);
});

test("refuses on any against finding", () => {
  const d = decide(CHECK, LARP);
  assert.equal(d.outcome, "refuse");
  assert.match(d.reasons.join(" "), /2 against/);
});

test("refuses when the product is not found, even with a clean tally", () => {
  const d = decide(CLEAN, "LARP check of $X on Robinhood Chain: product not found.");
  assert.equal(d.outcome, "refuse");
  assert.match(d.reasons.join(" "), /not found/);
});

test("would proceed on a clean tally and a found product", () => {
  const d = decide(CLEAN, LARP);
  assert.equal(d.outcome, "would proceed");
  assert.match(d.reasons[0], /0 against, 1 careful, 7 clear; product found/);
});

test("partly found and not read do not refuse on their own", () => {
  assert.equal(decide(CLEAN, "LARP check of $X on Solana: product partly found.").outcome, "would proceed");
  assert.equal(decide(CLEAN, "LARP check of $X on Solana: product not read.").outcome, "would proceed");
  assert.equal(decide(CLEAN, null).outcome, "would proceed"); // BSC: LARP not run
});

test("an unreadable answer is not a pass", () => {
  assert.equal(decide(fxText("check_coin_over"), LARP).outcome, "refuse");
  assert.equal(decide(CLEAN, "Still reading, ask again in 20 s").outcome, "refuse");
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs(["0xabc", "--chain", "bsc"]), { token: "0xabc", chain: "bsc" });
  assert.deepEqual(parseArgs(["--chain", "sol", "So111"]), { token: "So111", chain: "sol" });
  assert.deepEqual(parseArgs(["0xabc"]), { token: "0xabc" });
  assert.ok("error" in parseArgs(["0xabc", "--chain", "arc"]));
  assert.ok("error" in parseArgs([]));
});

test("buy() is a stub that only prints", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    buy("0xabc", "rh");
  } finally {
    console.log = orig;
  }
  assert.match(lines[0], /Nothing was sent/);
});
