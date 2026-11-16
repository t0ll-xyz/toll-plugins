// Live smoke against t0ll.xyz's free tier. Skipped unless TOLL_LIVE=1 (network; one free coin read at most).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Toll } from "@tollxyz/sdk";
import { tollTools } from "../src/index.js";

const LIVE = process.env.TOLL_LIVE === "1";
const TOKEN = "0x2f009d7d6227f7c17d688d60ddc0e581c9c4fc02";
const DEV = "0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc";
const APPROVE = "0x095ea7b3000000000000000000000000111111125421ca6dc452d289314280a0f8842a65ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const make = (o: any) => { const by = Object.fromEntries(tollTools(o).map((t) => [t.name, t])); return (n: string, a: any) => by[n].invoke(a).then(String); };

test("live: the core tools answer from t0ll.xyz", { skip: !LIVE, timeout: 180_000 }, async () => {
  const call = make({ client: new Toll({ fetch: (u, i) => fetch(u, i) }), budgetMs: 4000 });
  const coin = await call("check_coin", { address: TOKEN });
  assert.doesNotMatch(coin, /^Toll could not answer/, coin);
  const pre = await call("pre_buy_check", { address: TOKEN });
  assert.match(pre, /Decision: (BLOCK|WARN|ALLOW|WAIT)/, pre);
  const tx = await call("check_tx", { to: TOKEN, data: APPROVE, from: "0x000000000000000000000000000000000000dEaD" });
  assert.match(tx, /^(WARN|BLOCK)/, tx); // an unlimited approval to a contract Toll has no record of is never ALLOW
  const agent = await call("check_agent", { id: 20030 });
  assert.doesNotMatch(agent, /^Toll could not answer/, agent);
  const appr = await call("wallet_approvals", { wallet: DEV });
  assert.ok(appr.length > 0);
  console.log(`[live] check_coin: ${coin.split("\n")[0].slice(0, 80)} | pre_buy: ${(/Decision: \w+/.exec(pre) ?? [""])[0]} | check_tx: ${tx.split("\n")[0].slice(0, 60)} | check_agent: ${agent.split("\n")[0].slice(0, 60)} | approvals: ${appr.split("\n")[0].slice(0, 60)}`);
});
