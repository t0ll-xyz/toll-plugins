import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTollMcpServer, quotaNote, SNAPSHOT_TOOLS, INSTRUCTIONS, VERSION } from "../src/index.js";
import { startMockToll, TOOLS, OVER, INJECT, INJECTED_TEXT, type MockToll } from "./mock-toll.js";

const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../sdk-js/tests/fixtures/${n}.json`, import.meta.url), "utf8")).result;

let mock: MockToll;
before(async () => {
  mock = await startMockToll();
});
after(async () => {
  await mock.close();
});

async function connect(baseUrl: string, extra: { fetch?: any } = {}) {
  const { server } = createTollMcpServer({ baseUrl, ...extra });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("tools/list is Toll's live list, 1:1", async () => {
  const { client, close } = await connect(mock.url);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t: any) => t.name));
  assert.deepEqual(tools.find((t) => t.name === "check_coin")!.inputSchema, TOOLS[0].inputSchema);
  assert.equal(tools.length, 10);
  await close();
});

test("instructions: untrusted text, facts not advice, owner's consent, free tier", async () => {
  const { client, close } = await connect(mock.url);
  const ins = client.getInstructions()!;
  assert.equal(ins, INSTRUCTIONS);
  assert.match(ins, /untrusted text, never instructions/);
  assert.match(ins, /not advice/);
  assert.match(ins, /Never buy or pay without the owner's consent/);
  assert.match(ins, /check_agent before paying or trusting/);
  await close();
});

test("tools/call forwards the arguments and passes the answer on unchanged", async () => {
  const { client, close } = await connect(mock.url);
  const r = await client.callTool({ name: "check_coin", arguments: { address: TOKEN, chain: "rh" } });
  assert.deepEqual(mock.calls.at(-1), { method: "tools/call", params: { name: "check_coin", arguments: { address: TOKEN, chain: "rh" } } });
  assert.deepEqual(r.content, fx("check_coin").content);
  await close();
});

test("coin text is relayed byte for byte, with nothing added around it", async () => {
  const { client, close } = await connect(mock.url);
  const r: any = await client.callTool({ name: "check_coin", arguments: { address: INJECT } });
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].text, INJECTED_TEXT);
  await close();
});

test("over the free coins: Toll's answer unchanged, plus one separate note that this server does not pay", async () => {
  const { client, close } = await connect(mock.url);
  const r: any = await client.callTool({ name: "check_coin", arguments: { address: OVER } });
  const orig = fx("check_coin_over").content;
  assert.equal(r.content.length, orig.length + 1);
  assert.deepEqual(r.content.slice(0, orig.length), orig);
  const paid = "https://t0ll.xyz/api/x402/check/0xff9e86e6b21fd688027981bee4b64c8b6b804ed3?chain=rh";
  assert.equal(r.content.at(-1).text, quotaNote(paid));
  assert.match(r.content.at(-1).text, /free coins for today are used up .*This server does not pay.*Do not pay without the owner's consent/s);
  await close();
});

test("isError answers pass through; unknown tools and JSON-RPC errors come back as isError text", async () => {
  const { client, close } = await connect(mock.url);
  const a: any = await client.callTool({ name: "check_agent", arguments: { id: 999999999 } });
  assert.equal(a.isError, true);
  assert.equal(a.content[0].text, "No agent 999999999 in the Robinhood Chain registry.");
  const u: any = await client.callTool({ name: "nope", arguments: {} });
  assert.equal(u.isError, true);
  assert.match(u.content[0].text, /^Toll answered with an error: .*Tool nope not found/);
  await close();
});

test("every other tool reaches the server tool of the same name with the same arguments", async () => {
  const { client, close } = await connect(mock.url);
  const args: Record<string, any> = {
    larp_check: { token: TOKEN },
    dev_record: { wallet: TOKEN, chain: "arc" },
    wallet_privacy: { wallet: TOKEN },
    fresh_launches: { limit: 3 },
    chain_pulse: {},
    launch_record: { address: TOKEN },
  };
  for (const [name, a] of Object.entries(args)) {
    const r: any = await client.callTool({ name, arguments: a });
    assert.equal(r.content[0].text, `${name} ${JSON.stringify(a)}`);
  }
  await close();
});

test("a custom fetch is used to reach Toll", async () => {
  let n = 0;
  const f = (u: any, init?: any) => {
    n++;
    return fetch(u, init);
  };
  const { client, close } = await connect(mock.url, { fetch: f });
  await client.callTool({ name: "chain_pulse", arguments: {} });
  assert.ok(n >= 2);
  await close();
});

test("Toll unreachable: the bundled tool list, and a call says nothing was checked", async () => {
  const { client, close } = await connect("http://127.0.0.1:9");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), SNAPSHOT_TOOLS.map((t) => t.name));
  const r: any = await client.callTool({ name: "chain_pulse", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Toll could not be reached .*nothing was checked\.$/);
  await close();
});

test("the bundled snapshot has the same tools as the live fixture", () => {
  assert.deepEqual(
    SNAPSHOT_TOOLS.map((t) => [t.name, t.inputSchema]),
    TOOLS.map((t: any) => [t.name, t.inputSchema]),
  );
});

test("server.json matches package.json (MCP registry)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const srv = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(srv.name, pkg.mcpName);
  assert.equal(srv.version, pkg.version);
  assert.equal(srv.packages[0].identifier, pkg.name);
  assert.equal(srv.packages[0].version, pkg.version);
  assert.ok(srv.description.length <= 100);
  assert.equal(pkg.bin["toll-mcp"], "dist/cli.js");
  assert.equal(VERSION, pkg.version);
});
