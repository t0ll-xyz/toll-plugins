import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyOf,
  enforce,
  guard,
  guardEthers,
  guardSmartAccount,
  guardViem,
  TollBlockedError,
  TollUnavailableError,
  type GuardOptions,
  type GuardReport,
  type RiskAssessment,
} from "../src/index.js";

const RH = 4663;
const FROM = "0x2222222222222222222222222222222222222222";
const TO = "0x000000000000000000000000000000000000dEaD";
const DELEGATE = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
const SMART = "0x3333333333333333333333333333333333333333";
const EP = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ALLOW: RiskAssessment = { action: "ALLOW", warnings: [] };
const BLOCK = (code: string): RiskAssessment => ({ action: "BLOCK", warnings: [{ code, severity: "critical", message: code }] });
const WARN_MED = (code: string): RiskAssessment => ({ action: "WARN", warnings: [{ code, severity: "medium", message: code }] });

type Call = { url: string; init: RequestInit };
type R = Response | (() => Response | Promise<Response>);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
const down = () => {
  throw new TypeError("fetch failed");
};
function opts(responses: R[], extra: GuardOptions = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const reports: GuardReport[] = [];
  const o: GuardOptions = {
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      const r = responses.shift();
      if (r === undefined) throw new Error("no more mock responses");
      return typeof r === "function" ? r() : r;
    },
    sleep: async () => {},
    logger: (x) => void logs.push(x),
    onReport: (r) => void reports.push(r),
    ...extra,
  };
  const body = (i: number) => JSON.parse(String(calls[i].init.body));
  return { o, calls, logs, reports, body };
}

function fakeViem() {
  const sent: string[] = [];
  const client: Record<string, any> = {
    chain: { id: RH },
    account: { address: FROM, type: "json-rpc" },
    extend: () => client,
    request: async (a: { method: string }) => (sent.push(`request:${a.method}`), "0xresult"),
    sendTransaction: async () => (sent.push("send"), "0xhash"),
    signMessage: async () => (sent.push("signMessage"), "0xsig"),
    signTypedData: async () => (sent.push("sign712"), "0xsig"),
    sendCalls: async () => (sent.push("sendCalls"), { id: "0xbatch" }),
    signAuthorization: async () => (sent.push("signAuthorization"), { address: DELEGATE }),
  };
  return { client, sent };
}

function fakeBundler() {
  const sent: string[] = [];
  const account = { address: SMART, entryPoint: { address: EP, version: "0.7" }, getNonce: async () => 7n };
  const client: Record<string, any> = {
    chain: { id: RH },
    account,
    extend: () => client,
    request: async () => null,
    sendUserOperation: async () => (sent.push("sendUserOperation"), "0xuserophash"),
    prepareUserOperation: async (a: unknown) => (sent.push("prepareUserOperation"), a),
  };
  return { client, sent };
}

/* ------------------------------------------------------------------ the plan's named tests */

test("signMessage via eth_sign blocked", async () => {
  const { client, sent } = fakeViem();
  const t = opts([json(BLOCK("eth-sign-raw-hash"))]);
  const g = guardViem(client, t.o);
  const hash = "0x" + "ab".repeat(32);
  await assert.rejects(g.request({ method: "eth_sign", params: [FROM, hash] }), (e: unknown) => e instanceof TollBlockedError && e.codes[0] === "eth-sign-raw-hash");
  assert.deepEqual(t.body(0), { rpc: { method: "eth_sign", params: [FROM, hash] } });
  assert.deepEqual(sent, []);
  assert.equal(t.reports[0].kind, "message");
});

test("request personal_sign forwarded as rpc", async () => {
  const { client, sent } = fakeViem();
  const t = opts([json(ALLOW)], { origin: "https://app.example" });
  const g = guardViem(client, t.o);
  assert.equal(await g.request({ method: "personal_sign", params: ["0x68656c6c6f", FROM] }), "0xresult");
  assert.deepEqual(t.body(0), { rpc: { method: "personal_sign", params: ["0x68656c6c6f", FROM] }, origin: "https://app.example" });
  assert.deepEqual(sent, ["request:personal_sign"]);
  // a method that signs nothing passes through unchecked
  await g.request({ method: "eth_chainId" });
  assert.equal(t.calls.length, 1);
});

test("sendUserOperation calls checked", async () => {
  const { client, sent } = fakeBundler();
  const t = opts([json(ALLOW), json(BLOCK("unbounded-approval"))]);
  const g = guard(client, t.o); // a bundler client is detected before a viem WalletClient
  const calls = [
    { to: TO, value: 1n },
    { to: TO, data: "0x095ea7b3" + "00".repeat(64) },
  ];
  await assert.rejects(g.sendUserOperation({ calls }), TollBlockedError);
  assert.equal(t.calls.length, 2);
  assert.deepEqual(t.body(0), { chainId: RH, from: SMART, to: TO, data: "0x", value: "1" });
  assert.equal(t.body(1).from, SMART);
  assert.deepEqual(sent, []);
  assert.ok(t.reports.every((r) => r.kind === "calls"));
});

test("sendUserOperation / prepareUserOperation with callData: sent as a userOp with the account's EntryPoint", async () => {
  const { client, sent } = fakeBundler();
  const t = opts([json(ALLOW), json(ALLOW)]);
  const g = guardSmartAccount(client, t.o);
  await g.sendUserOperation({ callData: "0xb61d27f6" });
  assert.deepEqual(t.body(0), { userOp: { sender: SMART, nonce: "7", callData: "0xb61d27f6" }, entryPoint: EP });
  await g.prepareUserOperation({ callData: "0x", nonce: 3n, paymaster: TO });
  assert.deepEqual(t.body(1), { userOp: { sender: SMART, nonce: "3", callData: "0x", paymaster: TO }, entryPoint: EP });
  assert.deepEqual(sent, ["sendUserOperation", "prepareUserOperation"]);
  assert.equal(t.reports[0].kind, "userOp");
});

test("signAuthorization known delegate WARN passes under block-high", async () => {
  const { client, sent } = fakeViem();
  const t = opts([json(WARN_MED("eip7702-known-delegate"))]);
  const g = guardViem(client, t.o); // default onAuthorization: "check", default onWarn: "block-high"
  await g.signAuthorization({ contractAddress: DELEGATE, nonce: 0 });
  assert.deepEqual(t.body(0), { chainId: RH, from: FROM, authorizationList: [{ address: DELEGATE, chainId: RH, nonce: 0 }] });
  assert.deepEqual(sent, ["signAuthorization"]);
  // an unknown delegate comes back BLOCK
  const u = opts([json(BLOCK("eip7702-unknown-delegate"))]);
  await assert.rejects(guardViem(client, u.o).signAuthorization({ contractAddress: TO }), TollBlockedError);
  assert.deepEqual(sent, ["signAuthorization"]);
});

test("typed-data 400 other chain → blocked for signatures", async () => {
  const { client, sent } = fakeViem();
  // the server refuses a signature for another chain with a 400
  const t = opts([json({ error: "Only Robinhood Chain (chainId 4663) for now: chainId 1 is not read. Nothing was checked." }, 400)]);
  const g = guardViem(client, t.o);
  const td = { domain: { name: "X" }, types: { Order: [] }, primaryType: "Order", message: {} };
  await assert.rejects(g.signTypedData(td), (e: unknown) => e instanceof TollBlockedError && e.codes[0] === "signature-other-chain");
  // and one whose domain names another chain is blocked without asking (it is not "unsupported -> allow")
  const t2 = opts([]);
  await assert.rejects(guardViem(client, t2.o).signTypedData({ ...td, domain: { chainId: 8453 } }), TollBlockedError);
  await assert.rejects(
    guardViem(client, t2.o).request({ method: "eth_signTypedData_v4", params: [FROM, JSON.stringify({ ...td, domain: { chainId: 1 } })] }),
    TollBlockedError,
  );
  assert.equal(t2.calls.length, 0);
  assert.deepEqual(sent, []);
  // a transaction on another chain stays unsupported (allowed by default)
  const t3 = opts([]);
  await guardViem(client, t3.o).sendTransaction({ to: TO, chain: { id: 8453 } });
  assert.deepEqual(sent, ["send"]);
});

test("eth_sign with Toll unreachable → blocked", async () => {
  const { client, sent } = fakeViem();
  const t = opts([down]); // onUnavailable defaults to "allow", but eth_sign fails closed
  await assert.rejects(guardViem(client, t.o).request({ method: "eth_sign", params: [FROM, "0x" + "11".repeat(32)] }), TollUnavailableError);
  assert.deepEqual(sent, []);
  assert.equal(t.reports[0].decision, "blocked");
  // personal_sign with Toll unreachable keeps the onUnavailable default (allowed, logged)
  const p = opts([down]);
  await guardViem(client, p.o).request({ method: "personal_sign", params: ["0x68656c6c6f", FROM] });
  assert.deepEqual(sent, ["request:personal_sign"]);
});

/* ------------------------------------------------------------------ the rest of the surface */

test("viem signMessage: text and raw are sent hex as personal_sign, with from", async () => {
  const { client, sent } = fakeViem();
  const t = opts([json(ALLOW), json(ALLOW), json(ALLOW)]);
  const g = guardViem(client, t.o);
  await g.signMessage({ message: "hello" });
  await g.signMessage({ message: { raw: "0xdeadbeef" } });
  await g.signMessage({ message: { raw: new Uint8Array([1, 2]) } });
  assert.deepEqual(t.body(0), { message: { kind: "personal_sign", data: "0x68656c6c6f", from: FROM } });
  assert.equal(t.body(1).message.data, "0xdeadbeef");
  assert.equal(t.body(2).message.data, "0x0102");
  assert.equal(sent.length, 3);
});

test("ethers signMessage: a string is its UTF-8 bytes (even one that looks like hex)", async () => {
  const sent: string[] = [];
  const signer = { getAddress: async () => FROM, signMessage: async () => (sent.push("sign"), "0xsig"), signTypedData: async () => "0x" };
  const t = opts([json(ALLOW), json(BLOCK("permit-drain"))]);
  const g = guardEthers(signer, t.o);
  await g.signMessage("0x12");
  assert.deepEqual(t.body(0), { message: { kind: "personal_sign", data: "0x30783132", from: FROM } });
  await assert.rejects(g.signMessage(new Uint8Array([255])), TollBlockedError);
  assert.equal(t.body(1).message.data, "0xff");
  assert.deepEqual(sent, ["sign"]);
});

test("viem sendCalls and request wallet_sendCalls: each call checked; request eth_sendTransaction / eth_signTransaction as a transaction", async () => {
  const { client, sent } = fakeViem();
  const t = opts([json(ALLOW), json(ALLOW), json(ALLOW), json(ALLOW), json(ALLOW)]);
  const g = guardViem(client, t.o);
  await g.sendCalls({ calls: [{ to: TO, value: 2n }, { to: TO, data: "0x01" }] });
  assert.deepEqual(t.body(0), { chainId: RH, from: FROM, to: TO, data: "0x", value: "2" });
  assert.equal(t.body(1).data, "0x01");
  await g.request({ method: "wallet_sendCalls", params: [{ version: "2.0.0", chainId: "0x1237", from: FROM, calls: [{ to: TO, data: "0x02", value: "0x3" }] }] });
  assert.deepEqual(t.body(2), { chainId: RH, from: FROM, to: TO, data: "0x02", value: "0x3" });
  await g.request({ method: "eth_sendTransaction", params: [{ from: FROM, to: TO, data: "0x", value: "0x1" }] });
  assert.deepEqual(t.body(3), { chainId: RH, from: FROM, to: TO, data: "0x", value: "0x1" });
  await g.request({ method: "eth_signTransaction", params: [{ from: FROM, to: TO }] });
  assert.equal(t.body(4).to, TO);
  assert.deepEqual(sent, ["sendCalls", "request:wallet_sendCalls", "request:eth_sendTransaction", "request:eth_signTransaction"]);
});

test("7702 in a transaction under the default: checked by Toll with the list; Toll unreachable blocks it", async () => {
  const { client, sent } = fakeViem();
  const AUTH = [{ address: DELEGATE, chainId: RH, nonce: 1 }];
  const t = opts([json(ALLOW)]);
  await guardViem(client, t.o).sendTransaction({ to: TO, authorizationList: AUTH });
  assert.deepEqual(t.body(0), { chainId: RH, from: FROM, to: TO, data: "0x", value: "0", authorizationList: AUTH });
  assert.equal(t.calls.length, 1); // one check, not two
  const d = opts([down]);
  await assert.rejects(guardViem(client, d.o).sendTransaction({ to: TO, authorizationList: AUTH }), (e: unknown) => e instanceof TollBlockedError && e.codes[0] === "eip7702-authorization");
  assert.deepEqual(sent, ["send"]);
});

test("ethers authorize() under the default is checked as an authorization list", async () => {
  const sent: string[] = [];
  const signer = {
    provider: { getNetwork: async () => ({ chainId: 4663n }) },
    getAddress: async () => FROM,
    sendTransaction: async () => ({ hash: "0x" }),
    authorize: async () => (sent.push("authorize"), {}),
  };
  const t = opts([json(WARN_MED("eip7702-known-delegate"))]);
  await guardEthers(signer, t.o).authorize({ address: DELEGATE, nonce: 2 });
  assert.deepEqual(t.body(0), { chainId: RH, from: FROM, authorizationList: [{ address: DELEGATE, chainId: RH, nonce: 2 }] });
  assert.deepEqual(sent, ["authorize"]);
});

test("bodyOf: message, userOp + entryPoint, rpc, origin, authorizationList alone", () => {
  assert.deepEqual(bodyOf({ message: { kind: "personal_sign", data: "0x01" }, origin: "x.test" }), { message: { kind: "personal_sign", data: "0x01" }, origin: "x.test" });
  assert.deepEqual(bodyOf({ userOp: { sender: SMART }, entryPoint: EP }), { userOp: { sender: SMART }, entryPoint: EP });
  assert.deepEqual(bodyOf({ rpc: { method: "personal_sign", params: [] } }), { rpc: { method: "personal_sign", params: [] } });
  assert.deepEqual(bodyOf({ chainId: RH, from: FROM, authorizationList: [{ address: DELEGATE }] }), { chainId: RH, from: FROM, authorizationList: [{ address: DELEGATE }] });
});

test("enforce: a message with nothing else is checked (not 'nothing to check')", async () => {
  const t = opts([json(ALLOW)]);
  const r = await enforce("message", () => ({ message: { kind: "personal_sign", data: "0x01" } }), t.o);
  assert.equal(r.basis, "ALLOW");
});
