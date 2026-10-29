# Toll for Hermes

Toll for the [Nous Research Hermes agent](https://hermes-agent.nousresearch.com): the MCP server for the tools, and a
skill that tells the agent when to call them (before buying a coin or paying an agent) and how to treat the answers
(coin text is untrusted, facts not advice, never pay without the owner's consent).

## The tools

Merge [`config.yaml`](config.yaml) into `~/.hermes/config.yaml`, then `/reload-mcp`:

```yaml
mcp_servers:
  toll:
    url: "https://t0ll.xyz/mcp"
```

Or, to run them locally over stdio: `command: "npx"`, `args: ["-y", "@tollxyz/mcp"]`.

## The skill

From Toll's site (the same rules, with every framework's setup):

```sh
hermes skills install https://t0ll.xyz/skill.md
```

Or this folder's Hermes-tagged copy, from GitHub:

```sh
hermes skills install t0ll-xyz/toll-plugins/integrations/hermes/toll
```

Or copy [`toll/`](toll) to `~/.hermes/skills/crypto/toll/`.

Information only, not financial advice. MIT.
