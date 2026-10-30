import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkTx,
  enforce,
  guard,
  guardViem,
  guardEthers,
  guardX402Fetch,
  primaryTypeOf,
  read8470,
  latestFinding8470,
  decodeGetObservation,
  decodeLatestFinding,
  encodeLatestByToken,
  encodeLatestFinding,
  FINDING_KINDS,
  NOT_READ,
  TollBlockedError,
  TollUnavailableError,
  type GuardOptions,
  type GuardReport,
  type RiskAssessment,
} from "../src/index.js";

const raw = (n: string) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8");
const fx = (n: string) => JSON.parse(raw(n)) as RiskAssessment;
const RH = 4663;
const FROM = "0x2222222222222222222222222222222222222222";
const TO = "0x000000000000000000000000000000000000dEaD";
const TOKEN = "0x54f79a21c71071685369013fe12d7f6cd2528b5b";

type Call = { url: string; init: RequestInit };
type R = Response | (() => Response | Promise<Response>);
function mockFetch(responses: R[]) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift();
    if (r === undefined) throw new Error("no more mock responses");
    return typeof r === "function" ? r() : r;
  };
  return { f, calls };
}
const json = (x: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof x === "string" ? x : JSON.stringify(x), { status, headers: { "content-type": "application/json", ...headers } });
const body = (c: Call) => JSON.parse(String(c.init.body));
const noSleep = () => {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
};
/** options for a test: mock fetch, no sleeping, a captured log and report list */
function opts(responses: R[], extra: GuardOptions = {}) {
  const m = mockFetch(responses);
  const s = noSleep();
  const logs: string[] = [];
  const reports: GuardReport[] = [];
  const o: GuardOptions = { fetch: m.f, sleep: s.sleep, logger: (x) => logs.push(x), onReport: (r) => void reports.push(r), ...extra };
  return { o, m, s, logs, reports };
}
const TX = { chainId: RH, from: FROM, to: TO, data: "0x", value: 0n };

/* ------------------------------------------------------------------ checkTx */

test("checkTx posts the transaction to /api/tx/check, bigints as strings", async () => {
  const { o, m } = opts([json(fx("allow"))]);
  const a = await checkTx({ ...TX, value: 10n ** 30n }, o);
  assert.equal(a.action, "ALLOW");
  assert.equal(m.calls[0].url, "https://t0ll.xyz/api/tx/check");
  assert.equal(m.calls[0].init.method, "POST");
  assert.deepEqual(body(m.calls[0]), { chainId: RH, from: FROM, to: TO, data: "0x", value: "1000000000000000000000000000000" });
});

test("checkTx body: typedData, x402 with the payment inside it, agentId on top; baseUrl trimmed", async () => {
  const { o, m } = opts([json(fx("allow"))], { baseUrl: "https://example.test/" });
  const td = { domain: { chainId: 4663n }, types: { Permit: [] }, primaryType: "Permit", message: { value: 5n } };
  await checkTx({ typedData: td, x402: { accepts: [{ payTo: FROM }] }, payment: { authorization: { to: FROM, value: "1" } }, agentId: 7 }, o);
  assert.equal(m.calls[0].url, "https://example.test/api/tx/check");
  assert.deepEqual(body(m.calls[0]), {
    typedData: { domain: { chainId: "4663" }, types: { Permit: [] }, primaryType: "Permit", message: { value: "5" } },
    x402: { accepts: [{ payTo: FROM }], payment: { authorization: { to: FROM, value: "1" } } },
    agentId: 7,
  });
});

test("Retry-After: one retry after the wait, the second answer returned", async () => {
  const { o, m, s } = opts([json(fx("warn_pending"), 200, { "retry-after": "3" }), json(fx("allow"))]);
  const a = await checkTx(TX, o);
  assert.equal(a.action, "ALLOW");
  assert.equal(m.calls.length, 2);
  assert.deepEqual(s.slept, [3000]);
});

test("Retry-After: still not read after the one retry stays WARN coin-not-read, never ALLOW, no third call", async () => {
  const p = () => json(fx("warn_pending"), 200, { "retry-after": "3" });
  const { o, m } = opts([p(), p(), p()]);
  const a = await checkTx(TX, o);
  assert.equal(a.action, "WARN");
  assert.equal(a.warnings[0].code, "coin-not-read");
  assert.equal(m.calls.length, 2);
});

test("Retry-After longer than maxRetryWaitMs, or retry:false: no retry", async () => {
  for (const extra of [{ maxRetryWaitMs: 2000 }, { retry: false }] as GuardOptions[]) {
    const { o, m, s } = opts([json(fx("warn_pending"), 200, { "retry-after": "3" })], extra);
    assert.equal((await checkTx(TX, o)).action, "WARN");
    assert.equal(m.calls.length, 1);
    assert.deepEqual(s.slept, []);
  }
});

test("Retry-After: a failed retry keeps the first WARN", async () => {
  const { o } = opts([json(fx("warn_pending"), 200, { "retry-after": "1" }), json({ error: "x" }, 503)]);
  assert.equal((await checkTx(TX, o)).warnings[0].code, "coin-not-read");
});

test("checkTx: 429 / 5xx / 400 / bad JSON / network / timeout are TollUnavailableError", async () => {
  const cases: Array<[R, string, number | null]> = [
    [json({ error: "Too many checks" }, 429, { "retry-after": "60" }), "rate-limited", 429],
    [json({ error: "down" }, 502), "server-error", 502],
    [json({ error: "to must be an address" }, 400), "bad-request", 400],
    [json("<html>", 200), "bad-answer", 200],
    [() => { throw new TypeError("fetch failed"); }, "network", null],
  ];
  for (const [r, reason, status] of cases) {
    const { o } = opts([r]);
    await assert.rejects(checkTx(TX, o), (e: unknown) => e instanceof TollUnavailableError && e.reason === reason && e.status === status);
  }
  const { o } = opts([json({}, 429)]);
  await assert.rejects(checkTx(TX, o), (e: TollUnavailableError) => e.paidUrl === "https://t0ll.xyz/api/x402/tx" && /api\/x402\/tx/.test(e.message));
  // timeout: the fetch waits for the abort signal
  const hang = async (_u: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
  await assert.rejects(checkTx(TX, { fetch: hang, timeoutMs: 20 }), (e: TollUnavailableError) => e.reason === "timeout");
});

/* ------------------------------------------------------------------ the policy matrix */

const build = () => TX;
const outcome = async (fixture: string, extra: GuardOptions) => {
  const t = opts([json(fx(fixture))], extra);
  try {
    const r = await enforce("transaction", build, t.o);
    return { result: r.decision, basis: r.basis, t };
  } catch (e) {
    return { result: e instanceof TollBlockedError ? "throw" : "other", basis: null, t, e };
  }
};

test("policy matrix: ALLOW / WARN / BLOCK x onWarn / onBlock", async () => {
  const yes = async () => true;
  const no = () => false;
  const rows: Array<[string, GuardOptions, string]> = [
    ["allow", {}, "allowed"],
    ["allow", { onWarn: "block" }, "allowed"],
    ["warn_over", {}, "allowed"], // default onWarn "allow"
    ["warn_over", { onWarn: "allow" }, "allowed"],
    ["warn_over", { onWarn: "block" }, "throw"],
    ["warn_over", { onWarn: yes }, "allowed"],
    ["warn_over", { onWarn: no }, "throw"],
    ["block", {}, "throw"], // default onBlock "throw"
    ["block", { onWarn: "allow" }, "throw"],
    ["block", { onBlock: "throw" }, "throw"],
    ["block", { onBlock: yes }, "allowed"],
    ["block", { onBlock: no }, "throw"],
  ];
  for (const [fixture, extra, want] of rows) {
    const got = await outcome(fixture, extra);
    assert.equal(got.result, want, `${fixture} ${JSON.stringify(Object.keys(extra))}`);
    assert.equal(got.t.reports.length, 1);
    assert.equal(got.t.reports[0].decision, want === "throw" ? "blocked" : "allowed");
  }
});

test("BLOCK: TollBlockedError carries the assessment, codes and messages", async () => {
  const { e } = await outcome("block", {});
  assert.ok(e instanceof TollBlockedError);
  assert.equal(e.assessment.action, "BLOCK");
  assert.deepEqual(e.codes, ["unbounded-approval-to-eoa", "unbounded-approval"]);
  assert.match(e.message, /unbounded-approval-to-eoa: This approves an unlimited amount/);
  assert.match(e.message, /t0ll\.xyz\/agents\/x402#presign/);
});

test("WARN allowed by default is logged with the paid URL when over quota, and reported", async () => {
  const { t } = await outcome("warn_over", {});
  assert.equal(t.logs.length, 1);
  assert.match(t.logs[0], /coin-over-quota/);
  assert.match(t.logs[0], /https:\/\/t0ll\.xyz\/api\/x402\/tx/);
  assert.equal(t.reports[0].paidUrl, "https://t0ll.xyz/api/x402/tx");
  assert.equal(t.reports[0].basis, "WARN");
});

test("an action that is not ALLOW/WARN/BLOCK is never treated as ALLOW", async () => {
  const t = opts([json({ ...fx("allow"), action: "MAYBE" })], { onWarn: "block" });
  // not a valid assessment: unavailable (fail-open by default) ...
  const r = await enforce("transaction", build, t.o);
  assert.equal(r.basis, "unavailable");
});

test("unavailable: fail-open by default (logged, reported), fail-closed throws TollUnavailableError", async () => {
  const open = opts([json({ error: "down" }, 503)]);
  const r = await enforce("transaction", build, open.o);
  assert.equal(r.decision, "allowed");
  assert.equal(r.basis, "unavailable");
  assert.equal(r.assessment, null);
  assert.match(open.logs[0], /NOT checked/);
  assert.equal(open.reports[0].error?.reason, "server-error");

  const closed = opts([json({ error: "Too many" }, 429)], { onUnavailable: "block" });
  await assert.rejects(enforce("transaction", build, closed.o), (e: TollUnavailableError) => e.reason === "rate-limited" && e.paidUrl !== null);
  assert.equal(closed.reports[0].decision, "blocked");
});

test("unsupported (another chain, a deployment): not sent; allowed by default, onUnsupported block throws", async () => {
  const t = opts([]);
  const r = await enforce("transaction", () => ({ ...TX, chainId: 8453 }), t.o);
  assert.equal(r.basis, "unsupported");
  assert.equal(t.m.calls.length, 0);
  const d = await enforce("transaction", () => ({ ...TX, to: undefined }), t.o);
  assert.equal(d.basis, "unsupported");
  const td = await enforce("typedData", () => ({ typedData: { domain: { chainId: 1 }, types: {}, primaryType: "Permit", message: {} } }), t.o);
  assert.equal(td.basis, "unsupported");
  await assert.rejects(enforce("transaction", () => ({ ...TX, chainId: "eip155:1" }), { ...t.o, onUnsupported: "block" }), TollUnavailableError);
  assert.equal(t.m.calls.length, 0);
});

test("onReport and logger that throw never stop the signature", async () => {
  const t = opts([json(fx("allow"))], { onReport: () => { throw new Error("boom"); } });
  assert.equal((await enforce("transaction", build, t.o)).decision, "allowed");
  assert.match(t.logs[0], /onReport threw: boom/);
  const t2 = opts([json(fx("warn_over"))], { logger: () => { throw new Error("x"); } });
  assert.equal((await enforce("transaction", build, t2.o)).decision, "allowed");
});

test("a request that cannot be built (encode failure) goes to onUnavailable", async () => {
  const t = opts([]);
  const r = await enforce("transaction", () => { throw new Error("bad abi"); }, t.o);
  assert.equal(r.error?.reason, "encode");
  await assert.rejects(enforce("transaction", () => { throw new Error("bad abi"); }, { ...t.o, onUnavailable: "block" }), TollUnavailableError);
});

/* ------------------------------------------------------------------ viem-shaped client */

function fakeViem() {
  const sent: string[] = [];
  const client = {
    chain: { id: RH },
    account: { address: FROM, type: "local" },
    request: async () => null,
    extend: () => client,
    sendTransaction: async (args: unknown) => (sent.push("send:" + JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))), "0xhash"),
    writeContract: async () => (sent.push("write"), "0xwhash"),
    signTypedData: async () => (sent.push("sign712"), "0xsig"),
    getAddresses: async () => [FROM],
  };
  return { client, sent };
}
const ERC20 = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];

test("viem: sendTransaction is checked first (chain and account from the client), then sent", async () => {
  const { client, sent } = fakeViem();
  const t = opts([json(fx("allow"))]);
  const g = guard(client, t.o);
  assert.equal(await g.sendTransaction({ to: TO, value: 5n }), "0xhash");
  assert.deepEqual(body(t.m.calls[0]), { chainId: RH, from: FROM, to: TO, data: "0x", value: "5" });
  assert.equal(sent.length, 1);
  assert.deepEqual(await g.getAddresses(), [FROM]); // everything else passes through
  assert.equal(g.chain.id, RH);
});

test("viem: BLOCK stops sendTransaction, writeContract and signTypedData before the wallet", async () => {
  const { client, sent } = fakeViem();
  const t = opts([json(fx("block")), json(fx("block")), json(fx("block"))], { encodeFunctionData: () => "0x095ea7b3" + "00".repeat(64) });
  const g = guardViem(client, t.o);
  await assert.rejects(g.sendTransaction({ to: TO, data: "0x095ea7b3" }), TollBlockedError);
  await assert.rejects(g.writeContract({ address: TOKEN, abi: ERC20, functionName: "approve", args: [FROM, 2n ** 256n - 1n] }), TollBlockedError);
  await assert.rejects(g.signTypedData({ domain: { chainId: RH }, types: { Permit: [] }, primaryType: "Permit", message: {} }), TollBlockedError);
  assert.deepEqual(sent, []);
  assert.equal(t.m.calls.length, 3);
  assert.equal(body(t.m.calls[1]).to, TOKEN);
  assert.equal(body(t.m.calls[2]).typedData.primaryType, "Permit");
});

test("viem: writeContract encodes with viem's own encodeFunctionData when not given one", async (tt) => {
  let viem: { encodeFunctionData: (a: unknown) => string };
  try {
    viem = (await import("viem" as string)) as typeof viem;
  } catch {
    tt.skip("viem not installed");
    return;
  }
  const { client, sent } = fakeViem();
  const t = opts([json(fx("allow"))]);
  await guardViem(client, t.o).writeContract({ address: TOKEN, abi: ERC20, functionName: "approve", args: [FROM, 1n], value: 0n });
  assert.equal(body(t.m.calls[0]).data, viem.encodeFunctionData({ abi: ERC20, functionName: "approve", args: [FROM, 1n] }));
  assert.deepEqual(sent, ["write"]);
});

test("viem: a transaction on another chain is not sent to Toll and goes through", async () => {
  const { client, sent } = fakeViem();
  const t = opts([]);
  await guardViem(client, t.o).sendTransaction({ to: TO, chain: { id: 8453 } });
  assert.equal(t.m.calls.length, 0);
  assert.equal(sent.length, 1);
});

/* ------------------------------------------------------------------ ethers-shaped signer */

function fakeEthers() {
  const sent: string[] = [];
  class FakeSigner {
    provider = { getNetwork: async () => ({ chainId: 4663n, name: "rh" }) };
    async getAddress() {
      return FROM;
    }
    async signTransaction(_tx: unknown) {
      sent.push("signTx");
      return "0xsigned";
    }
    // like ethers' AbstractSigner: sendTransaction calls this.signTransaction
    async sendTransaction(tx: unknown) {
      await this.signTransaction(tx);
      sent.push("send");
      return { hash: "0xhash" };
    }
    async signTypedData(_d: unknown, _t: unknown, _v: unknown) {
      sent.push("sign712");
      return "0xsig";
    }
    async resolveName(name: string) {
      return name === "vitalik.eth" ? TO : null;
    }
  }
  return { signer: new FakeSigner(), sent };
}

test("ethers: sendTransaction is checked once (chain from the provider, from getAddress), then sent", async () => {
  const { signer, sent } = fakeEthers();
  const t = opts([json(fx("allow"))]);
  const g = guard(signer, t.o);
  const r = await g.sendTransaction({ to: "vitalik.eth", value: 1n });
  assert.equal(r.hash, "0xhash");
  assert.equal(t.m.calls.length, 1); // the inner this.signTransaction is not checked twice
  assert.deepEqual(body(t.m.calls[0]), { chainId: "4663", from: FROM, to: TO, data: "0x", value: "1" });
  assert.deepEqual(sent, ["signTx", "send"]);
  assert.equal(await g.getAddress(), FROM);
});

test("ethers: signTypedData sends the primary type; BLOCK stops it", async () => {
  const { signer, sent } = fakeEthers();
  const t = opts([json(fx("block"))]);
  const types = { Permit: [{ name: "owner", type: "address" }, { name: "details", type: "Details" }], Details: [{ name: "amount", type: "uint256" }] };
  await assert.rejects(guardEthers(signer, t.o).signTypedData({ chainId: RH }, types, { owner: FROM, details: { amount: 1n } }), TollBlockedError);
  assert.equal(body(t.m.calls[0]).typedData.primaryType, "Permit");
  assert.deepEqual(sent, []);
});

test("primaryTypeOf matches ethers' rule (the type nobody refers to, arrays included)", () => {
  assert.equal(primaryTypeOf({ EIP712Domain: [], Mail: [{ name: "to", type: "Person[]" }], Person: [{ name: "w", type: "address" }] }), "Mail");
  assert.throws(() => primaryTypeOf({ A: [], B: [] }), /ambiguous/);
});

test("guard() refuses an object that is neither", () => {
  assert.throws(() => guard({}), TypeError);
});

/* ------------------------------------------------------------------ x402 */

const PR = {
  x402Version: 2,
  resource: { url: "https://seller.test/api/thing" },
  accepts: [{ scheme: "exact", network: "eip155:4663", asset: "0x5fc5360d0400a2cfc7a6d0d8bb7e3b3d68d8f6c7", amount: "10000", payTo: FROM, extra: { erc8004: { agentId: 42 } } }],
};
const b64 = (x: unknown) => btoa(JSON.stringify(x));
const res402 = (v: 1 | 2 = 2) =>
  v === 2 ? new Response("{}", { status: 402, headers: { "payment-required": b64(PR) } }) : json({ x402Version: 1, accepts: PR.accepts }, 402);

test("x402: a 402 is checked before the payer sees it; ALLOW hands the 402 on unchanged", async () => {
  const t = opts([json(fx("allow"))], { agentId: (u) => (u.includes("seller") ? 42 : undefined) });
  const inner = mockFetch([res402()]);
  const r = await guardX402Fetch(inner.f, t.o)("https://seller.test/api/thing");
  assert.equal(r.status, 402);
  assert.ok(r.headers.get("payment-required"));
  const b = body(t.m.calls[0]);
  assert.deepEqual(b.x402.accepts, PR.accepts);
  assert.equal(b.agentId, 42);
  assert.equal(t.reports[0].kind, "x402");
});

test("x402: BLOCK throws, so the payer never pays; v1 body read the same; url added when the 402 has no resource", async () => {
  const t = opts([json(fx("block"))]);
  const inner = mockFetch([res402(1)]);
  await assert.rejects(guardX402Fetch(inner.f, t.o)("https://seller.test/x"), TollBlockedError);
  assert.equal(body(t.m.calls[0]).x402.url, "https://seller.test/x");
});

test("x402: the paid retry (payment header) and non-402 answers pass through unchecked", async () => {
  const t = opts([]);
  const inner = mockFetch([res402(), json({ ok: 1 })]);
  const f = guardX402Fetch(inner.f, t.o);
  assert.equal((await f("https://seller.test/a", { headers: { "PAYMENT-SIGNATURE": "abc" } })).status, 402);
  assert.equal((await f("https://seller.test/a")).status, 200);
  assert.equal(t.m.calls.length, 0);
});

test("x402: Toll unavailable is fail-open by default, fail-closed when asked", async () => {
  const open = opts([json({}, 503)]);
  assert.equal((await guardX402Fetch(mockFetch([res402()]).f, open.o)("https://seller.test/a")).status, 402);
  const closed = opts([json({}, 503)], { onUnavailable: "block" });
  await assert.rejects(guardX402Fetch(mockFetch([res402()]).f, closed.o)("https://seller.test/a"), TollUnavailableError);
});

/* ------------------------------------------------------------------ ERC-8470 */

const OBS = JSON.parse(raw("get_observation_1")).result as string;
const KIND = (n: string) => FINDING_KINDS[n].id;

test("8470: decodes a recorded getObservation(1) eth_call; not read stays null, never 0", () => {
  const o = decodeGetObservation(OBS, 1n);
  assert.equal(o.token, TOKEN);
  assert.equal(o.chainId, 4663n);
  assert.equal(o.keyKind, "token");
  assert.equal(o.observedBlock, 101664550n);
  assert.equal(o.hashChecked, true);
  assert.equal(o.detector, "0x02593abff31f4e8ec1d5c2f297a347c51ef06e5c");
  assert.equal(o.recordedAt, 1793357964n);
  assert.deepEqual(o.tally, { against: 1, careful: 3, clear: 3 });
  assert.equal(o.reportHash, "0x0b065696865d5057a597a44935b3003d0da39fe59edb7c1a695cf433a4095403");
  assert.equal(o.reportURI, "ipfs://QmegWWxkHUh94no4bsc4sjJYAmZ9qZgrvsAy9NNdjjpFU8");
  assert.equal(o.findings.length, 7);
  const by = Object.fromEntries(o.findings.map((f) => [`${f.name}:${f.param}`, f]));
  assert.equal(by["first-block-share:0"].value, 143n);
  assert.equal(by["early-buyer-share:3"].value, 143n);
  for (const k of ["creator-prior-launches:0", "funding-linked-share:1", "product-label:0"]) {
    assert.equal(by[k].value, null, k);
    assert.equal(by[k].notRead, true, k);
  }
  assert.equal(by["text-flags:0"].value, 0n); // read, none found: a real 0
  assert.equal(by["xyz.t0ll.dev-sold-share:0"].unit, "bps");
});

test("8470: read8470 calls latestByToken then getObservation; id 0 is null; RPC error throws", async () => {
  const m = mockFetch([json(JSON.parse(raw("latest_by_token"))), json(JSON.parse(raw("get_observation_1")))]);
  const o = await read8470(TOKEN, { fetch: m.f });
  assert.equal(o?.id, 1n);
  assert.equal(m.calls[0].url, "https://rpc.mainnet.chain.robinhood.com");
  const p = body(m.calls[0]).params[0];
  assert.equal(p.to, "0x730e3c356299c9203cb042f6c0a9274aeabf9af3");
  assert.equal(p.data, encodeLatestByToken(4663n, TOKEN, "0x02593AbFf31f4E8eC1D5c2F297a347C51ef06E5c"));
  assert.ok(p.data.startsWith("0x8c9b1620"));
  assert.equal(body(m.calls[1]).params[0].data, "0xf5fec8b1" + "0".repeat(63) + "1");

  const none = mockFetch([json({ jsonrpc: "2.0", id: 1, result: "0x" + "0".repeat(64) })]);
  assert.equal(await read8470(TOKEN, { fetch: none.f }), null);
  const bad = mockFetch([json({ jsonrpc: "2.0", id: 1, error: { message: "execution reverted" } })]);
  await assert.rejects(read8470(TOKEN, { fetch: bad.f }), /execution reverted/);
});

test("8470: latestFinding encodes by kind name and decodes NOT_READ as null", async () => {
  const w = (n: bigint) => n.toString(16).padStart(64, "0");
  const ret = "0x" + w(1n) + w(101664550n) + w(1793357964n) + w(NOT_READ) + w(0n);
  const m = mockFetch([json({ jsonrpc: "2.0", id: 1, result: ret })]);
  const f = await latestFinding8470(TOKEN, "product-label", 0, { fetch: m.f });
  assert.equal(f.value, null);
  assert.equal(f.notRead, true);
  assert.equal(f.observationId, 1n);
  assert.equal(body(m.calls[0]).params[0].data, encodeLatestFinding(4663n, TOKEN, "0x02593AbFf31f4E8eC1D5c2F297a347C51ef06E5c", KIND("product-label"), 0n));
  assert.ok(body(m.calls[0]).params[0].data.startsWith("0xcf5fd50d"));
  const real = decodeLatestFinding("0x" + w(1n) + w(1n) + w(2n) + w(143n) + w(3n));
  assert.deepEqual([real.value, real.lean], [143n, "against"]);
});

/* ------------------------------------------------------------------ the real libraries, when installed (no network) */

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DOMAIN = { name: "T", version: "1", chainId: RH, verifyingContract: TOKEN };
const TYPES = { Permit: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }] };
const MSG = { spender: FROM, value: 1n };

test("real ethers v6 Wallet: wrapped signTypedData signs the same bytes after ALLOW", async (tt) => {
  let ethers: any;
  try {
    ethers = await import("ethers" as string);
  } catch {
    return tt.skip("ethers not installed");
  }
  const w = new ethers.Wallet(PK);
  const t = opts([json(fx("allow"))]);
  const g = guard(w, t.o);
  assert.equal(await g.signTypedData(DOMAIN, TYPES, MSG), await w.signTypedData(DOMAIN, TYPES, MSG));
  assert.equal(await g.getAddress(), w.address);
  assert.equal(body(t.m.calls[0]).typedData.primaryType, "Permit");
});

test("real viem WalletClient: wrapped signTypedData signs the same after ALLOW, BLOCK stops it", async (tt) => {
  let viem: any, accounts: any;
  try {
    viem = await import("viem" as string);
    accounts = await import("viem/accounts" as string);
  } catch {
    return tt.skip("viem not installed");
  }
  const chain = viem.defineChain({ id: RH, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:1"] } } });
  const c = viem.createWalletClient({ account: accounts.privateKeyToAccount(PK), chain, transport: viem.http() });
  const t = opts([json(fx("allow")), json(fx("block"))]);
  const g = guard(c, t.o);
  const args = { domain: DOMAIN, types: TYPES, primaryType: "Permit", message: MSG };
  assert.equal(await g.signTypedData(args), await c.signTypedData(args));
  await assert.rejects(g.signTypedData(args), TollBlockedError);
  assert.equal(body(t.m.calls[0]).typedData.domain.chainId, RH);
});
