import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, chmodSync } from "node:fs";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Toll, resolveClientId } from "../src/index.js";

const ID_RE = /^[A-Za-z0-9_-]{22,64}$/;
const OK = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } });

function capture() {
  const heads: Array<Record<string, string>> = [];
  const f = async (_u: string, init?: RequestInit) => {
    heads.push(init?.headers as Record<string, string>);
    return new Response(OK, { status: 200 });
  };
  return { f, heads };
}

test("same id across two clients (file persisted)", async () => {
  const home = mkdtempSync(join(tmpdir(), "toll-cid-"));
  const a = resolveClientId(undefined, { fs: nodeFs, home });
  const b = resolveClientId(undefined, { fs: nodeFs, home });
  assert.match(a, ID_RE);
  assert.equal(a, b);
  assert.equal(readFileSync(join(home, ".toll", "client-id"), "utf8").trim(), a);
});

test("opts.clientId wins and is sent as x-toll-client", async () => {
  const { f, heads } = capture();
  const mine = "my-install-id-0123456789ab";
  await new Toll({ fetch: f, clientId: mine }).checkCoin("0xff9e86e6b21fd688027981bee4b64c8b6b804ed3");
  assert.equal(heads[0]["x-toll-client"], mine);
});

test("invalid opts.clientId is ignored", () => {
  const home = mkdtempSync(join(tmpdir(), "toll-cid-"));
  const id = resolveClientId("bad id!", { fs: nodeFs, home });
  assert.match(id, ID_RE);
  assert.notEqual(id, "bad id!");
});

test("no fs: random id, still sent", async () => {
  const a = resolveClientId(undefined, { fs: null, home: null });
  assert.match(a, ID_RE);
  const { f, heads } = capture();
  await new Toll({ fetch: f }).chainPulse();
  assert.match(heads[0]["x-toll-client"], ID_RE);
});

test("unwritable home never throws", () => {
  const id = resolveClientId(undefined, { fs: nodeFs, home: join(tmpdir(), "no-such-dir-x", "\0bad") });
  assert.match(id, ID_RE);
});

test("existing invalid file content is replaced", () => {
  const home = mkdtempSync(join(tmpdir(), "toll-cid-"));
  nodeFs.mkdirSync(join(home, ".toll"));
  nodeFs.writeFileSync(join(home, ".toll", "client-id"), "short\n");
  const id = resolveClientId(undefined, { fs: nodeFs, home });
  assert.match(id, ID_RE);
  assert.equal(readFileSync(join(home, ".toll", "client-id"), "utf8").trim(), id);
});

test("a valid file written between the failed read and the write wins (exclusive create)", () => {
  const home = mkdtempSync(join(tmpdir(), "toll-cid-"));
  const winner = "winner-written-by-a-racer-0123";
  let reads = 0;
  const racing = {
    readFileSync: (p: string, e: "utf8") => {
      if (reads++ === 0) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return nodeFs.readFileSync(p, e);
    },
    mkdirSync: (p: string, o?: { recursive?: boolean }) => {
      const r = nodeFs.mkdirSync(p, o);
      nodeFs.writeFileSync(join(p, "client-id"), winner + "\n"); // the other process wins here
      return r;
    },
    writeFileSync: nodeFs.writeFileSync as any,
  };
  assert.equal(resolveClientId(undefined, { fs: racing, home }), winner);
  assert.equal(readFileSync(join(home, ".toll", "client-id"), "utf8").trim(), winner);
});
