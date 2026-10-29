// Spawns the built bin (dist/cli.js) the way `npx -y @tollxyz/mcp` runs it, over stdio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockToll, OVER, type MockToll } from "./mock-toll.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let mock: MockToll;
before(async () => {
  mock = await startMockToll();
});
after(async () => {
  await mock.close();
});

async function spawnServer(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI],
    env: { ...getDefaultEnvironment(), ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(transport);
  return client;
}

test("stdio smoke: initialize, tools/list, tools/call (Toll mocked)", async () => {
  const client = await spawnServer({ TOLL_BASE_URL: mock.url });
  assert.equal(client.getServerVersion()?.name, "toll");
  const { tools } = await client.listTools();
  assert.equal(tools.length, 8);
  assert.ok(tools.some((t) => t.name === "check_agent"));
  const r: any = await client.callTool({ name: "check_coin", arguments: { address: OVER } });
  assert.match(r.content.at(-1).text, /This server does not pay/);
  assert.ok(mock.calls.some((c) => c.method === "initialize"));
  await client.close();
});

test("--version and --help print and exit", () => {
  assert.equal(execFileSync(process.execPath, [CLI, "--version"], { encoding: "utf8" }).trim(), "0.1.0");
  assert.match(execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }), /npx -y @tollxyz\/mcp/);
});

test("live smoke against t0ll.xyz (TOLL_LIVE=1)", { skip: process.env.TOLL_LIVE !== "1" }, async () => {
  const client = await spawnServer({});
  const { tools } = await client.listTools();
  for (const n of ["check_coin", "larp_check", "dev_record", "check_agent", "fresh_launches", "chain_pulse"]) {
    assert.ok(tools.some((t) => t.name === n), n);
  }
  const pulse: any = await client.callTool({ name: "chain_pulse", arguments: {} });
  assert.match(pulse.content[0].text, /Robinhood Chain/);
  const agent: any = await client.callTool({ name: "check_agent", arguments: { id: 20030 } });
  assert.match(agent.content.map((c: any) => c.text).join("\n"), /20030/);
  await client.close();
});
