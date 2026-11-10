import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOLL_FACILITATOR, TOOL_NAMES, Toll, TollError, screenOf, type FacilitatorSettleResponse } from "../src/index.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8");
const PAYTO = "0x3954ff905bdb481ad5814d5be3cc32c3166122ac";

type Call = { url: string; init: RequestInit };
function mockFetch(responses: Array<string | Response>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more mock responses");
    return typeof r === "string" ? new Response(r, { status: 200 }) : r;
  };
  return { f, calls };
}

test("find_paid_api is in TOOL_NAMES after check_agent (28 tools, the live order)", () => {
  assert.equal(TOOL_NAMES.length, 28);
  assert.equal(TOOL_NAMES[TOOL_NAMES.indexOf("check_agent") + 1], "find_paid_api");
});

test("findPaidApi calls the MCP tool with query and limit (live answer)", async () => {
  const m = mockFetch([fx("find_paid_api"), fx("find_paid_api")]);
  const t = new Toll({ fetch: m.f });
  const r = await t.findPaidApi({ query: "  stock ", limit: 2 });
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)).params, { name: "find_paid_api", arguments: { query: "stock", limit: 2 } });
  assert.match(r.text, /^Paid APIs on Robinhood Chain for "stock"/);
  await t.findPaidApi();
  assert.deepEqual(JSON.parse(String(m.calls[1].init.body)).params.arguments, {});
  await assert.rejects(t.findPaidApi({ limit: 21 }), TollError);
  await assert.rejects(t.findPaidApi({ query: "x".repeat(201) }), TollError);
});

test("findPaidApis without a query reads /discovery/resources on x402.t0ll.xyz (live shape)", async () => {
  const m = mockFetch([fx("discovery_resources")]);
  const r = await new Toll({ fetch: m.f, clientId: "c".repeat(22) }).findPaidApis({ limit: 2, offset: 0, type: "http", operator: "agent:7622" });
  const u = new URL(m.calls[0].url);
  assert.equal(`${u.origin}${u.pathname}`, `${TOLL_FACILITATOR}/discovery/resources`);
  assert.deepEqual(Object.fromEntries(u.searchParams), { type: "http", operator: "agent:7622", limit: "2", offset: "0" });
  assert.equal((m.calls[0].init.headers as Record<string, string>)["x-toll-client"], "c".repeat(22));
  assert.equal(r.x402Version, 2);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].verified, true);
  assert.equal(typeof r.items[0].settledViaToll, "number");
  assert.ok(r.items[0].operator && typeof r.items[0].operator.key === "string");
  assert.deepEqual(Object.keys(r.pagination ?? {}).sort(), ["limit", "offset", "total"]);
  assert.equal(r.partialResults, undefined);
});

test("findPaidApis with a query reads /discovery/search and maps resources to items", async () => {
  const m = mockFetch([fx("discovery_search")]);
  const r = await new Toll({ fetch: m.f }).findPaidApis({ query: "stock", payTo: PAYTO.toUpperCase().replace("0X", "0x"), limit: 1 });
  const u = new URL(m.calls[0].url);
  assert.equal(u.pathname, "/discovery/search");
  assert.deepEqual(Object.fromEntries(u.searchParams), { query: "stock", payTo: PAYTO, limit: "1" });
  assert.equal(r.items[0].payTo, PAYTO);
  assert.equal(r.items[0].price, "0.05 USDG");
  assert.equal(r.pagination, null);
  assert.equal(r.partialResults, true);
});

test("findPaidApis: a custom baseUrl uses its /api/facilitator; facilitatorUrl wins", async () => {
  const m = mockFetch([fx("discovery_resources"), fx("discovery_resources")]);
  await new Toll({ fetch: m.f, baseUrl: "https://staging.example/" }).findPaidApis();
  assert.equal(m.calls[0].url, "https://staging.example/api/facilitator/discovery/resources");
  await new Toll({ fetch: m.f, facilitatorUrl: "https://fac.example//" }).findPaidApis();
  assert.equal(m.calls[1].url, "https://fac.example/discovery/resources");
});

test("findPaidApis: bad options throw before any request; a non-catalog answer throws", async () => {
  const m = mockFetch([new Response('{"error":"Too many requests"}', { status: 429, headers: { "retry-after": "30" } }), new Response("{}", { status: 200 })]);
  const t = new Toll({ fetch: m.f });
  await assert.rejects(t.findPaidApis({ payTo: "0x12" }), /payTo/);
  await assert.rejects(t.findPaidApis({ type: "ws" as any }), /type/);
  await assert.rejects(t.findPaidApis({ limit: 0 }), /limit/);
  await assert.rejects(t.findPaidApis({ offset: -1 }), /offset/);
  await assert.rejects(t.findPaidApis({ query: "a", offset: 5 }), /offset/);
  await assert.rejects(t.findPaidApis({ operator: "has space" }), /operator/);
  assert.equal(m.calls.length, 0);
  await assert.rejects(t.findPaidApis(), (e: TollError) => e.status === 429 && e.retryAfterS === 30);
  await assert.rejects(t.findPaidApis(), TollError);
});

test("screenOf reads extensions.screen of a verify or settle answer", () => {
  const settled: FacilitatorSettleResponse = {
    success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:4663",
    extensions: { erc8478: { outcome: "verified" }, receipt: null, screen: { outcome: "warn", codes: ["unverified_payee"] } },
  };
  assert.deepEqual(screenOf(settled), { outcome: "warn", codes: ["unverified_payee"] });
  assert.deepEqual(screenOf({ isValid: true, extensions: { screen: { outcome: "not-read" } } }), { outcome: "not-read", codes: [] });
  assert.deepEqual(screenOf({ extensions: { screen: { outcome: "block", codes: ["x", 1] } } }), { outcome: "block", codes: ["x"] });
  assert.equal(screenOf({ extensions: { screen: { outcome: "maybe", codes: [] } } }), null);
  assert.equal(screenOf({ extensions: {} }), null);
  assert.equal(screenOf(null), null);
});
