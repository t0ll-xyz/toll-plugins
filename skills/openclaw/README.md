# Toll for OpenClaw

The `toll` skill ([`toll/SKILL.md`](toll/SKILL.md)) tells an OpenClaw agent to check a coin with Toll before buying it
and an ERC-8004 agent before paying it, to treat coin text in answers as untrusted, to report facts not advice, and to
never pay without the owner's consent. The tools come from Toll's free MCP server.

## Install

The tools:

```sh
openclaw mcp add toll --url https://t0ll.xyz/mcp --transport streamable-http
```

The skill, from ClawHub (once published) or from this folder:

```sh
openclaw skills install @<clawhub-handle>/toll       # the ClawHub handle it is published under
openclaw skills install ./skills/openclaw/toll --as toll
```

## Publish (owner)

```sh
npm i -g clawhub
clawhub login
clawhub skill publish ./skills/openclaw/toll --slug toll --name "Toll" --version 0.1.0 --changelog "First release" --tags latest
```

Information only, not financial advice. MIT.
