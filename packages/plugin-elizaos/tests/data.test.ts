import { test } from "node:test";
import assert from "node:assert/strict";
import { createTollPlugin, extractStockId, periodOf, tollPlugin, MARKETS_NOTE, MACRO_NOTE, fundamentals, insiderTrades, macro, paidMarketsUrl } from "../src/index.js";

const NAMES: Record<string, string> = { fundamentals: "TOLL_FUNDAMENTALS", insider_trades: "TOLL_INSIDER_TRADES", macro: "TOLL_MACRO" };
const msg = (text: string): any => ({ entityId: "e", roomId: "r", content: { text } });
const act = (p: any, name: string) => p.actions.find((a: any) => a.name === name);
const desc = async (n: string) => act(tollPlugin, NAMES[n]).description as string;
// elizaOS reads the message, so the args become a message the action's triggers pick up.
function say(n: string, args: any): string {
  if (n === "fundamentals") return `${args.period ? `${args.period} ` : ""}fundamentals for ${args.id}`;
  if (n === "insider_trades") return `${args.limit ? `last ${args.limit} ` : ""}insider trades at ${args.id}`;
  return "what's the macro picture?";
}
const run = async (f: any, tollKey: string | undefined, n: string, args: any) => {
  const p = createTollPlugin({ fetch: f, ...(tollKey ? { tollKey } : {}) });
  const res = await act(p, NAMES[n]).handler({}, msg(say(n, args)));
  return String(res.text);
};

test("triggers: fundamentals, insider and macro words", async () => {
  const v = (name: string, t: string) => act(tollPlugin, name).validate({}, msg(t));
  assert.equal(await v("TOLL_FUNDAMENTALS", "what are NVDA's fundamentals?"), true);
  assert.equal(await v("TOLL_FUNDAMENTALS", "AAPL revenue last quarter"), true);
  assert.equal(await v("TOLL_FUNDAMENTALS", "what's the P/E on $TSLA"), true);
  assert.equal(await v("TOLL_FUNDAMENTALS", "show me earnings"), false);
  assert.equal(await v("TOLL_FUNDAMENTALS", "NVDA stock token"), false);
  assert.equal(await v("TOLL_INSIDER_TRADES", "any insider selling at NVDA?"), true);
  assert.equal(await v("TOLL_INSIDER_TRADES", "Form 4 filings for $AAPL"), true);
  assert.equal(await v("TOLL_INSIDER_TRADES", "who are the insiders?"), false);
  for (const t of ["macro update", "where are rates?", "is inflation cooling", "show the yield curve", "jobs report", "CPI print"]) {
    assert.equal(await v("TOLL_MACRO", t), true, t);
  }
  assert.equal(await v("TOLL_MACRO", "gm"), false);
});

test("ticker and period extraction around P/E, EPS, CPI", () => {
  assert.equal(extractStockId("what's the P/E on TSLA"), "TSLA");
  assert.equal(extractStockId("EPS TTM for AAPL"), "AAPL");
  assert.equal(periodOf("NVDA quarterly revenue"), "quarterly");
  assert.equal(periodOf("annual financials for AAPL"), "annual");
  assert.equal(periodOf("ttm earnings MSFT"), "ttm");
  assert.equal(periodOf("NVDA fundamentals"), undefined);
});

test("TOLL_INSIDER_TRADES clamps 'last N' to 100; a missing ticker sends nothing", async () => {
  const { f, calls } = fake([{ body: INS }]);
  const p = createTollPlugin({ fetch: f });
  await act(p, "TOLL_INSIDER_TRADES").handler({}, msg("last 500 insider trades at NVDA"));
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/insiders/NVDA?limit=100");
  const res = await act(p, "TOLL_FUNDAMENTALS").handler({}, msg("show me fundamentals"));
  assert.equal(res.success, false);
  assert.match(res.text, /No company in the message for TOLL_FUNDAMENTALS/);
  assert.equal(calls.length, 1);
});

const FUND = { ticker: "NVDA", name: "NVIDIA", state: "ok", ttm: { revenue: { value: 302969000000, url: "https://www.sec.gov/x" } }, quota: { used: 3, limit: 50, left: 47, tier: "free" } };
const INS = { ticker: "NVDA", state: "ok", rows: [{ code: "S", shares: 12483, form: "4" }], totals: {}, quota: { used: 4, limit: 50, left: 46, tier: "free" } };
const MACRO = { as_of: "2026-11-02T18:11:35.759Z", treasury: { read: true }, effr: { read: true }, bls: { read: true }, quota: { used: 5, limit: 50, left: 45, tier: "free" } };
const OVER = { error: "50 Markets calls used today (free).", quota: { used: 50, limit: 50, left: 0, tier: "free" } };
type R = { status?: number; body: unknown; headers?: Record<string, string> };

function fake(responses: R[]) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more responses");
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
  return { f, calls };
}

test("data tools: facts not advice; stock ones say debt securities; macro carries the New York Fed terms", async () => {
  for (const n of ["fundamentals", "insider_trades"]) {
    const d = await desc(n);
    assert.ok(d.includes(MARKETS_NOTE));
    assert.ok(!/\b(buy|sell|trade)\b/i.test(d));
  }
  const m = await desc("macro");
  assert.ok(m.includes(MACRO_NOTE));
  assert.ok(m.endsWith("Facts with their sources, not advice. The EFFR is subject to the Terms of Use posted at newyorkfed.org; Toll is not affiliated with the New York Fed."));
  assert.ok(!/debt securities/.test(m));
});

test("fundamentals GETs /api/markets/fundamentals/{id}?period= with the Toll key and returns the JSON unchanged", async () => {
  const { f, calls } = fake([{ body: FUND }, { body: FUND }]);
  const out = await run(f, "tk_1", "fundamentals", { id: "$NVDA", period: "quarterly" });
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/fundamentals/NVDA?period=quarterly");
  assert.equal(calls[0].headers.get("x-toll-pass"), "tk_1");
  assert.deepEqual(JSON.parse(out), FUND);
  await run(f, undefined, "fundamentals", { id: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" });
  assert.equal(calls[1].url, "https://t0ll.xyz/api/markets/fundamentals/0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
  assert.equal(calls[1].headers.get("x-toll-pass"), null);
});

test("insider_trades GETs /api/markets/insiders/{id}?limit=; macro GETs /api/markets/macro", async () => {
  const { f, calls } = fake([{ body: INS }, { body: MACRO }]);
  assert.deepEqual(JSON.parse(await run(f, undefined, "insider_trades", { id: "NVDA", limit: 5 })), INS);
  assert.equal(calls[0].url, "https://t0ll.xyz/api/markets/insiders/NVDA?limit=5");
  assert.deepEqual(JSON.parse(await run(f, "tk_2", "macro", {})), MACRO);
  assert.equal(calls[1].url, "https://t0ll.xyz/api/markets/macro");
  assert.equal(calls[1].headers.get("x-toll-pass"), "tk_2");
});

test("over the daily Markets quota each points to its x402 URL at 0.01 USDG on Robinhood Chain, never paying", async () => {
  const over = () => ({ status: 429, body: OVER, headers: { "retry-after": "3600" } });
  const { f, calls } = fake([over(), over(), over()]);
  const a = await run(f, undefined, "fundamentals", { id: "NVDA" });
  const b = await run(f, undefined, "insider_trades", { id: "NVDA" });
  const c = await run(f, undefined, "macro", {});
  assert.match(a, /These fundamentals over x402: https:\/\/t0ll\.xyz\/api\/x402\/markets\/fundamentals\/NVDA \(0\.01 USDG on Robinhood Chain; pay only with the owner's consent\)/);
  assert.match(b, /These insider trades over x402: https:\/\/t0ll\.xyz\/api\/x402\/markets\/insiders\/NVDA \(0\.01 USDG on Robinhood Chain; pay only/);
  assert.match(c, /Macro over x402: https:\/\/t0ll\.xyz\/api\/x402\/markets\/macro \(0\.01 USDG on Robinhood Chain; pay only/);
  for (const t of [a, b, c]) {
    assert.match(t, /50 Markets calls used today \(free; resets 00:00 UTC\)/);
    assert.match(t, /Markets calls a day 50 \/ 1,000 \/ 5,000 \/ 20,000/);
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every((x) => x.url.includes("/api/markets/")));
});

test("the shared calls: bad ids, bad period, bad limit and errors come back as one line", async () => {
  const { f, calls } = fake([{ status: 404, body: { error: "ZZZZZZ is not one of the Stock Tokens Robinhood lists on Robinhood Chain." } }]);
  const o = { fetch: f };
  assert.match(await fundamentals({ id: "not a ticker!" }, o), /^Toll could not answer: Not a ticker/);
  assert.match(await fundamentals({ id: "NVDA", period: "weekly" as any }, o), /period is ttm, annual or quarterly/);
  assert.match(await insiderTrades({ id: "NVDA", limit: 101 }, o), /limit is a whole number from 1 to 100/);
  assert.match(await insiderTrades({ id: "NVDA", limit: 0 }, o), /limit is a whole number from 1 to 100/);
  assert.equal(calls.length, 0);
  assert.match(await insiderTrades({ id: "ZZZZZZ" }, o), /^Toll could not answer: ZZZZZZ is not one/);
  assert.equal(paidMarketsUrl("macro"), "https://t0ll.xyz/api/x402/markets/macro");
  assert.equal(paidMarketsUrl("insiders", "$BRK.B"), "https://t0ll.xyz/api/x402/markets/insiders/BRK.B");
  assert.match(await macro({ fetch: async () => { throw new Error("offline"); } }), /^Toll could not answer: request failed: offline$/);
});
