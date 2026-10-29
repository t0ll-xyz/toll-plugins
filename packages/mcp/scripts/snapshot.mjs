// Refreshes src/snapshot.ts from Toll's live tools/list. Usage: npm run snapshot -w @tollxyz/mcp
import { writeFileSync } from "node:fs";

const res = await fetch("https://t0ll.xyz/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});
const raw = await res.text();
const body = JSON.parse(raw.trim().startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:")).slice(5));
const tools = body.result.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }));
const day = new Date().toISOString().slice(0, 10);
writeFileSync(
  new URL("../src/snapshot.ts", import.meta.url),
  `// Snapshot of https://t0ll.xyz/mcp tools/list (read ${day}). Used only when Toll cannot be reached for the live list.\n` +
    `// Regenerate: npm run snapshot -w @tollxyz/mcp\nimport type { Tool } from "@modelcontextprotocol/sdk/types.js";\n\n` +
    `export const SNAPSHOT_TOOLS: Tool[] = ${JSON.stringify(tools, null, 2)};\n`,
);
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
