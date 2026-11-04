// Toll reads Robinhood Chain (4663) only. Strips leftover other-chain options from a tools/list answer:
// a chain enum keeps only "rh", a token address pattern keeps only 0x + 40 hex.
const EVM_PATTERN = "^0x[0-9a-fA-F]{40}$";

export function rhOnlyTools(tools) {
  return tools.map((t) => {
    const props = t.inputSchema?.properties;
    if (!props) return t;
    const next = {};
    for (const [k, v] of Object.entries(props)) {
      const p = { ...v };
      if (Array.isArray(p.enum) && p.enum.includes("rh")) {
        p.enum = ["rh"];
        if (typeof p.description === "string") {
          p.description = p.description.replace(/Leave it out and Toll finds which chain the token is on\./, "Leave it out for Robinhood Chain.");
        }
      }
      if (typeof p.pattern === "string" && p.pattern.startsWith("^(0x[0-9a-fA-F]{40}|")) p.pattern = EVM_PATTERN;
      next[k] = p;
    }
    return { ...t, inputSchema: { ...t.inputSchema, properties: next } };
  });
}
