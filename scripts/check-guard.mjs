// Toll's guard is on by default in everything this repo hands out as a starting point: examples/ and templates/.
// Today none of them signs or pays (the map is in FOLDERS below). This check fails when one starts to without going
// through @tollxyz/guard on the strict preset with the TOLL_GUARD=off switch, and when a folder's README stops saying
// which of the two it is. Run by `npm test` at the root (scripts/check-guard.test.mjs). No network.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

/** the one switch, the same name as in toll-agent-templates: the guard is on unless TOLL_GUARD is "off" */
export const SWITCH = "TOLL_GUARD";

/**
 * THE MAP (2026-11-16): every example and template, and whether it signs or pays.
 *   false = it never signs and never pays; its README says so.
 *   true  = it signs or pays, through @tollxyz/guard; its README says the guard is on and how to turn it off.
 */
export const FOLDERS = {
  "examples/crewai": false, // an MCP client: reads Toll's tools, holds no wallet
  "examples/openai-agents": false, // an MCP client: reads Toll's tools, holds no wallet
  "examples/langchain-mcp": false, // an MCP client (langchain-mcp-adapters): reads Toll's tools, holds no wallet
  "examples/guarded-agent": false, // buy() is a stub that prints
  "templates/x402-starter": false, // a seller: the buyer signs, the facilitator settles
};

// what a signing or paying call looks like in code (JS / TS, then Python)
export const SIGNING = [
  /\bprivateKeyToAccount\b/, /\bmnemonicToAccount\b/, /\bhdKeyToAccount\b/, /\bcreateWalletClient\b/, /\bnew\s+(?:ethers\.)?Wallet\s*\(/,
  /\.(?:signMessage|signTypedData|signTransaction|signAuthorization|sendTransaction|sendRawTransaction|writeContract|sendCalls|sendUserOperation)\s*\(/,
  /\beth_(?:sign|signTypedData_v4|sendTransaction|sendRawTransaction)\b/, /\bpersonal_sign\b/, /\bwallet_sendCalls\b/,
  /\bwrapFetchWithPayment\b/, /\bx402Client\b/, /\bwithPaymentInterceptor\b/, /\bcreatePaymentHeader\b/, /\.pay\s*\(/,
  /["'](?:@x402\/(?:fetch|axios|evm)[^"']*|x402-fetch|x402-axios|viem\/accounts|ethers)["']/,
  /\bAccount\.from_key\b/, /\bfrom_mnemonic\b/, /\b(?:sign_transaction|send_raw_transaction|send_transaction|sign_message|sign_typed_data)\s*\(/,
  /^\s*(?:from|import)\s+(?:eth_account|x402)\b/m,
];
export const signsOrPays = (text) => SIGNING.filter((re) => re.test(text)).map(String);

const WRAPS = /\b(?:guard|guardViem|guardEthers|guardSmartAccount|guardX402Fetch|guardHookr)\s*\(/;
/** why a file that signs or pays is not behind the guard by default; [] when it is */
export function unguarded(text, file = "") {
  const why = [];
  if (/\.py$/.test(file)) {
    // there is no Python guard package: a Python file asks check_tx itself before it signs
    if (!/\bcheck_tx\b/.test(text)) why.push("it does not ask Toll's check_tx before signing");
  } else {
    if (!/["']@tollxyz\/guard["']/.test(text) || !WRAPS.test(text)) why.push("it does not wrap the wallet or the fetch with @tollxyz/guard");
    if (!/\bstrict:\s*true\b/.test(text)) why.push("the guard is not on the strict preset (strict: true)");
    if (!/\bbudgetMs\b/.test(text)) why.push("the check has no time budget (budgetMs)");
  }
  if (!text.includes(SWITCH)) why.push(`it does not read the ${SWITCH} switch (on unless "off")`);
  return why;
}

const SKIP = new Set(["node_modules", "dist", "__pycache__", ".next", ".venv", "tests", "test", "fixtures"]);
function* files(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(mjs|cjs|js|jsx|ts|tsx|py)$/.test(n)) yield p;
  }
}

const NEVER = /never signs (?:and never|or) pays/i;
const ON = /guard is on/i;

/** every problem in the repo at `root` (a path); [] = the guard is on wherever something signs or pays */
export function scan(root, folders = FOLDERS) {
  const problems = [];
  const here = new Set();
  for (const group of ["examples", "templates"]) {
    for (const n of readdirSync(join(root, group))) if (statSync(join(root, group, n)).isDirectory()) here.add(`${group}/${n}`);
  }
  for (const f of here) if (!(f in folders)) problems.push(`${f}: a new folder. Add it to FOLDERS in scripts/check-guard.mjs and say whether it signs or pays.`);
  for (const [folder, signs] of Object.entries(folders)) {
    if (!here.has(folder)) { problems.push(`${folder}: listed in FOLDERS but not there`); continue; }
    let found = false;
    for (const f of files(join(root, folder))) {
      const text = readFileSync(f, "utf8");
      const hits = signsOrPays(text);
      if (!hits.length) continue;
      found = true;
      const where = relative(root, f).split("\\").join("/");
      if (!signs) problems.push(`${where} signs or pays (${hits[0]}) but FOLDERS says ${folder} never does: set it to true there, and put the call behind @tollxyz/guard.`);
      for (const why of unguarded(text, f)) problems.push(`${where} signs or pays, and ${why}.`);
    }
    if (signs && !found) problems.push(`${folder}: FOLDERS says it signs or pays, but no file does. Set it to false.`);
    let readme = "";
    try { readme = readFileSync(join(root, folder, "README.md"), "utf8"); } catch { /* reported below */ }
    if (signs ? !(ON.test(readme) && readme.includes(`${SWITCH}=off`)) : !(NEVER.test(readme) && readme.includes(`${SWITCH}=off`))) {
      problems.push(`${folder}/README.md: one line is missing: ${signs ? `"the guard is on" and how to turn it off (${SWITCH}=off)` : `that it never signs or pays, and that the guard (off switch ${SWITCH}=off) goes in front of a wallet when one is added`}.`);
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = scan(fileURLToPath(new URL("../", import.meta.url)));
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log("guard: on wherever an example or a template signs or pays");
}
