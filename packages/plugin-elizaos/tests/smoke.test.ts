// Live smoke against t0ll.xyz's free tier. Skipped unless TOLL_LIVE=1 (it uses the network and one free coin read).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTollPlugin } from "../src/index.js";

const LIVE = process.env.TOLL_LIVE === "1";
const TOKEN = "0x2f009d7d6227f7c17d688d60ddc0e581c9c4fc02";
const msg = (text: string): any => ({ entityId: "e", roomId: "r", content: { text } });
const rt: any = { getSetting: () => undefined };

test("live: pre-buy, check_tx with a budget, check_agent and the provider answer from t0ll.xyz", { skip: !LIVE, timeout: 120_000 }, async () => {
  const p = createTollPlugin({ budgetMs: 4000 });
  const act = (n: string) => p.actions!.find((a) => a.name === n)!;
  const pre: any = await act("TOLL_PRE_BUY_CHECK").handler(rt, msg(`should I buy ${TOKEN}?`));
  assert.equal(pre.success, true, pre.text);
  assert.match(pre.text, /Decision: (BLOCK|WARN|ALLOW|WAIT)/);
  const tx: any = await act("TOLL_CHECK_TX").handler(rt, msg(`check before I sign: {"to":"${TOKEN}","data":"0x095ea7b3000000000000000000000000111111125421ca6dc452d289314280a0f8842a65ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","from":"0x000000000000000000000000000000000000dEaD"}`));
  assert.equal(tx.success, true, tx.text);
  assert.match(tx.text, /^(WARN|BLOCK)/); // an unlimited approval to an unknown contract is never ALLOW
  const ag: any = await act("TOLL_CHECK_AGENT").handler(rt, msg("check agent #20030"));
  assert.equal(ag.success, true, ag.text);
  const hint = await p.providers![0].get(rt, msg(`ape ${TOKEN}`), {} as any);
  assert.match(hint.text!, /Toll/);
  console.log("[live] pre-buy:", pre.text.split("\n")[0], "| check_tx:", tx.text.split("\n")[0], "| provider verdict:", hint.values?.tollVerdict);
});
