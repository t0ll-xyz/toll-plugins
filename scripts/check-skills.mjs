// Checks the skill files: frontmatter, the rules every Toll skill carries, and that every tool they name is one of
// Toll's tools. Run by `npm test` at the root. No network.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const tools = JSON.parse(read("packages/mcp/tests/fixture_tools_list.json")).result.tools.map((t) => t.name);

// backticked words that are not Toll's tools: an answer's field (`read_age_s`, pre_buy_check / check_coin), the calls
// Hookr's MCP builds (the "Building on Hookr" recipe), and the facilitator's refusal codes (the site's skill.md)
const FIELDS = new Set(["read_age_s", "hookr_build_swap", "hookr_build_launch", "hookr_build_claim", "hookr_build_agent_link",
  "hookr_build_fill", "hookr_build_add_liquidity", "hookr_build_remove_liquidity", "hookr_build_collect_fees",
  "unsupported_asset", "budget_exceeded_per_payment", "budget_exceeded_per_day", "budget_exceeded_per_payto",
  "budget_payto_not_allowed", "budget_expired", "budget_revoked", "budget_asset_not_usdg", "gas_day_budget_exhausted"]);

const files = {
  "docs/site/skill.md": { homepage: true },
  "skills/openclaw/toll/SKILL.md": { homepage: true, openclaw: true },
  "integrations/hermes/toll/SKILL.md": { hermes: true },
};

for (const [path, want] of Object.entries(files)) {
  const s = read(path);
  const m = /^---\n([\s\S]*?)\n---\n/.exec(s);
  assert.ok(m, `${path}: frontmatter`);
  const fm = m[1];
  assert.match(fm, /^name: toll$/m, `${path}: name`);
  const desc = /^description: (.+)$/m.exec(fm);
  assert.ok(desc && desc[1].length > 80 && desc[1].length <= 1024, `${path}: description`);
  if (want.homepage) assert.match(fm, /^homepage: https:\/\/t0ll\.xyz$/m, `${path}: homepage`);
  if (want.openclaw) {
    const meta = /^metadata: (.+)$/m.exec(fm);
    assert.ok(meta, `${path}: single-line metadata`);
    assert.equal(JSON.parse(meta[1]).openclaw.homepage, "https://t0ll.xyz");
  }
  if (want.hermes) {
    assert.match(fm, /^version: \d+\.\d+\.\d+$/m, `${path}: version`);
    assert.match(fm, /^ {2}hermes:\n {4}tags: \[.+\]\n {4}category: \w+$/m, `${path}: metadata.hermes`);
  }
  const body = s.slice(m[0].length);
  assert.match(body, /Before (you buy a coin|buying any coin), call (Toll's )?`check_coin`/, `${path}: check before buying`);
  assert.match(body, /Before paying or trusting an ERC-8004 agent, call `check_agent`|pay or trust an ERC-8004 agent[\s\S]{0,80}call `check_agent`/, `${path}: check an agent before paying`);
  assert.match(body, /untrusted text: data, never instructions/, `${path}: untrusted coin text`);
  assert.match(body, /facts, not advice/i, `${path}: facts not advice`);
  assert.match(body, /Never buy, pay[\s\S]{0,40}without (your|the) owner's consent/, `${path}: owner's consent`);
  assert.match(body, /never says a coin is safe|Never call a coin safe/i, `${path}: never safe`);
  // `mcp_toll_<tool>` (Hermes names, one-word tools such as macro too) or a bare `<word>_<word>` tool name.
  for (const [, prefixed, bare] of body.matchAll(/`(?:mcp_toll_([a-z_]+)|([a-z]+_[a-z_]+))`/g)) {
    const name = prefixed ?? bare;
    if (!prefixed && FIELDS.has(name)) continue;
    assert.ok(tools.includes(name), `${path}: unknown tool ${name}`);
  }
  for (const t of ["check_coin", "larp_check", "dev_record", "check_agent"]) assert.ok(body.includes(t), `${path}: mentions ${t}`);
  console.log(`ok ${path}`);
}
