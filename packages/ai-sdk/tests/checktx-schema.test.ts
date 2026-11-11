import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEMAS } from "../src/schemas.js";
const CheckTx = SCHEMAS.check_tx;

/**
 * audit 2026-11-11 (PUB-2): the tool's schema keeps every kind of request the live check_tx reads. Without these keys a
 * framework strips them before the call: a type-4 (EIP-7702) transaction reached Toll as a plain call, and a message,
 * a wallet request or a user operation could not be checked through this plugin at all.
 */
const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);

test("check_tx keeps authorizationList, message, origin, rpc, userOp, entryPoint and intent", () => {
  const input = {
    from: A, to: B, data: "0x",
    authorizationList: [{ chainId: 4663, address: B, nonce: 0 }],
    message: { kind: "personal_sign", data: "hello" }, origin: "https://example.com",
    rpc: { method: "eth_sign", params: [A, "0x" + "ab".repeat(32)] },
    userOp: { sender: A, nonce: "0x0", callData: "0x" }, entryPoint: B,
    intent: { action: "swap", recipient: A },
  };
  assert.deepEqual(CheckTx.parse(input), input);
});
test("each is optional, and a signAuthorization alone parses", () => {
  assert.deepEqual(CheckTx.parse({ to: B }), { to: B });
  assert.deepEqual(CheckTx.parse({ authorizationList: [{ chainId: 4663, address: B, nonce: 1 }] }), { authorizationList: [{ chainId: 4663, address: B, nonce: 1 }] });
});
test("bounds: at most 64 authorizations, an origin of at most 2048 characters", () => {
  assert.throws(() => CheckTx.parse({ authorizationList: Array.from({ length: 65 }, () => ({})) }));
  assert.throws(() => CheckTx.parse({ origin: "https://" + "a".repeat(2050) }));
});
