// Tests of scripts/check-guard.mjs: the guard is on by default wherever an example or a template signs or pays.
// Run: node --test scripts/check-guard.test.mjs (part of `npm test` at the root). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scan, signsOrPays, unguarded, FOLDERS, SWITCH } from "./check-guard.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/** a made-up repo on disk: { "examples/x/README.md": "text", ... } */
function repo(tree) {
  const dir = mkdtempSync(join(tmpdir(), "guard-scan-"));
  mkdirSync(join(dir, "examples"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const NEVER = `It never signs or pays. Add a wallet behind the guard (${SWITCH}=off turns it off).`;
const ON = `Toll's guard is on. ${SWITCH}=off turns it off.`;
const GUARDED = `import { guard, checkBudgetMs } from "@tollxyz/guard";
import { createWalletClient } from "viem";
const on = (process.env.${SWITCH} ?? "").trim().toLowerCase() !== "off";
const raw = createWalletClient({ account, transport });
export const wallet = on ? guard(raw, { strict: true, timeoutMs: 1500, budgetMs: checkBudgetMs(1500) }) : raw;
await wallet.sendTransaction(tx);`;

test("the repo as it is: nothing signs or pays outside the guard, and every README says which it is", () => {
  assert.deepEqual(scan(root), []);
});

test("the switch has one name, the same as in toll-agent-templates", () => {
  assert.equal(SWITCH, "TOLL_GUARD");
});

test("a signing or paying call is seen, in JS and in Python; a read is not", () => {
  for (const line of [
    "const account = privateKeyToAccount(key);", "const w = createWalletClient({ account });", "await wallet.sendTransaction(tx);",
    "await signer.signTypedData(domain, types, value);", "const s = new Wallet(key);", "const s = new ethers.Wallet(key);",
    "const pay = wrapFetchWithPayment(fetch, client);", 'import { x402Client } from "@x402/fetch";', "console.log(await toll.pay(r.paidUrl));",
    'await provider.request({ method: "personal_sign", params });', "acct = Account.from_key(key)", "signed = w3.eth.account.sign_transaction(tx, key)",
    "w3.eth.send_raw_transaction(signed.raw_transaction)", "from eth_account import Account",
  ]) assert.ok(signsOrPays(line).length > 0, line);
  for (const line of [
    'console.log(`[stub] would buy ${token} on ${chain} here. Nothing was sent.`);', "const check = await toll.checkCoin(token);",
    'handler ??= paywall({ payTo: process.env.PAY_TO ?? "" }, forecast);', 'Agent(name="Trader", instructions="Call pre_buy_check before any buy.")',
    "Pay per check at ${r.paidUrl} (x402, 0.005 USDG)",
  ]) assert.deepEqual(signsOrPays(line), [], line);
});

test("default on: a wallet behind @tollxyz/guard, strict, with a budget and the switch passes", () => {
  assert.deepEqual(unguarded(GUARDED, "agent.mjs"), []);
  const r = repo({ "examples/trader/README.md": ON, "examples/trader/agent.mjs": GUARDED });
  try { assert.deepEqual(scan(r.dir, { "examples/trader": true }), []); } finally { r.done(); }
});

test("a signing call with no guard fails, and so does one in a folder the map says never signs", () => {
  const bare = 'import { createWalletClient } from "viem";\nawait createWalletClient({ account }).sendTransaction(tx);';
  const r = repo({ "examples/trader/README.md": NEVER, "examples/trader/agent.mjs": bare });
  try {
    const problems = scan(r.dir, { "examples/trader": false });
    assert.ok(problems.some((p) => /agent\.mjs signs or pays .* never does/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /does not wrap the wallet or the fetch with @tollxyz\/guard/.test(p)));
    assert.ok(problems.some((p) => /does not read the TOLL_GUARD switch/.test(p)));
  } finally { r.done(); }
});

test("each missing piece is named: the strict preset, the budget, the switch", () => {
  assert.match(unguarded(GUARDED.replace("strict: true, ", ""), "a.ts").join("|"), /strict preset/);
  assert.match(unguarded(GUARDED.replace(", budgetMs: checkBudgetMs(1500)", ""), "a.ts").join("|"), /no time budget/);
  assert.match(unguarded(GUARDED.replaceAll(SWITCH, "MY_SWITCH"), "a.ts").join("|"), /TOLL_GUARD switch/);
  assert.match(unguarded("acct = Account.from_key(key)", "a.py").join("|"), /check_tx before signing/);
});

test("a new folder nobody mapped fails, and so does a README without its line", () => {
  const r = repo({ "examples/known/README.md": "An example.", "examples/known/a.mjs": "export const x = 1;", "templates/fresh/README.md": NEVER });
  try {
    const problems = scan(r.dir, { "examples/known": false });
    assert.ok(problems.some((p) => /^templates\/fresh: a new folder/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /^examples\/known\/README\.md: one line is missing/.test(p)));
  } finally { r.done(); }
});

test("the map lists every example and template of this repo, none of which signs or pays today", () => {
  assert.deepEqual(Object.keys(FOLDERS).sort(), ["examples/crewai", "examples/guarded-agent", "examples/langchain-mcp", "examples/openai-agents", "templates/x402-starter"]);
  assert.ok(Object.values(FOLDERS).every((v) => v === false));
});
