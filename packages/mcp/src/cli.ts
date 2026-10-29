#!/usr/bin/env node
/**
 * toll-mcp: Toll's tools over stdio. `npx -y @tollxyz/mcp`
 * Env: TOLL_BASE_URL (default https://t0ll.xyz). Logs go to stderr; stdout carries only MCP messages.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTollMcpServer, VERSION } from "./server.js";

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
if (arg === "--help" || arg === "-h") {
  process.stdout.write(
    "toll-mcp: Toll's coin, LARP, dev and agent checks as a local MCP server over stdio.\n" +
      "Add it to an MCP client as: npx -y @tollxyz/mcp\n" +
      "Env: TOLL_BASE_URL (default https://t0ll.xyz). Free tier only: 10 new coins a day per caller.\n" +
      "Docs: https://t0ll.xyz/agents/plugins\n",
  );
  process.exit(0);
}

const { server, proxy } = createTollMcpServer({ baseUrl: process.env.TOLL_BASE_URL || undefined });
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`toll-mcp ${VERSION} ready on stdio\n`);

const stop = async () => {
  await proxy.close();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.stdin.on("end", stop);
