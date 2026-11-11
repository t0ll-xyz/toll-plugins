import { test } from "node:test";
import assert from "node:assert/strict";
import { Toll, TollError, type CheckTxRequest } from "../src/index.js";

/**
 * 0.7.1 (audit 2026-11-11, PUB-2): EVERY KIND OF REQUEST THE LIVE check_tx READS CAN BE SENT.
 * The server reads an EIP-7702 authorization list, a message to sign (personal_sign / eth_sign, Sign-In with Ethereum),
 * the wallet request as sent ({method, params}), an ERC-4337 user operation and an intent. The SDK refused a request
 * that carried only one of those ("checkTx needs a transaction, typedData or x402") and its type had no field for
 * them, so an agent checking through the SDK got a narrower check than one calling the MCP tool. The names are the
 * live tool's own.
 */
const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);

async function sent(req: CheckTxRequest) {
  const calls: Array<{ body: { params: { name: string; arguments: Record<string, unknown> } } }> = [];
  const answer = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ action: "ALLOW", warnings: [] }) }] } });
  const f = async (_url: string, init?: RequestInit) => { calls.push({ body: JSON.parse(String(init?.body)) }); return new Response(answer, { status: 200 }); };
  await new Toll({ fetch: f }).checkTx(req);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.params.name, "check_tx");
  return calls[0].body.params.arguments;
}

test("a type-4 transaction keeps its authorizationList", async () => {
  const list = [{ chainId: 4663, address: B, nonce: 0, yParity: 0, r: "0x1", s: "0x2" }];
  assert.deepEqual(await sent({ from: A, to: B, data: "0x", authorizationList: list }), { from: A, to: B, data: "0x", authorizationList: list });
});
test("a signAuthorization alone (no to, no data) is a request", async () => {
  const list = [{ chainId: 4663, address: B, nonce: 7 }];
  assert.deepEqual(await sent({ from: A, authorizationList: list }), { from: A, authorizationList: list });
});
test("a message to sign, with the site asking", async () => {
  const message = { kind: "personal_sign" as const, data: "example.com wants you to sign in with your Ethereum account" };
  assert.deepEqual(await sent({ from: A, message, origin: "https://example.com" }), { from: A, message, origin: "https://example.com" });
});
test("the wallet request as sent", async () => {
  const rpc = { method: "eth_sign", params: [A, "0x" + "ab".repeat(32)] };
  assert.deepEqual(await sent({ rpc }), { rpc });
});
test("a user operation with its EntryPoint", async () => {
  const userOp = { sender: A, nonce: "0x0", callData: "0x", signature: "0x" };
  assert.deepEqual(await sent({ userOp, entryPoint: B }), { userOp, entryPoint: B });
});
test("an intent rides along with a transaction", async () => {
  const intent = { action: "swap", recipient: A };
  assert.deepEqual(await sent({ from: A, to: B, data: "0x12", intent }), { from: A, to: B, data: "0x12", intent });
});
test("nothing to check is still refused before any request", async () => {
  const t = new Toll({ fetch: async () => { throw new Error("no request expected"); } });
  await assert.rejects(async () => t.checkTx({} as never), TollError);
  await assert.rejects(async () => t.checkTx({ from: A } as never), TollError);
  await assert.rejects(async () => t.checkTx({ authorizationList: [] } as never), TollError);
  await assert.rejects(async () => t.checkTx({ origin: "https://x.example" } as never), TollError);
});
