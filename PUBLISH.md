# Publishing the Robinhood Chain only release (branch `rh-only-1105`)

Every package now matches the live service: Robinhood Chain (4663) only, all 19 tools of https://t0ll.xyz/mcp.
Nothing below has been run. Run it in Git Bash, in this order. `npm whoami` must say `tollxyz`.

| Package | Old | New |
| --- | --- | --- |
| `@tollxyz/sdk` (packages/sdk-js) | 0.1.2 | 0.2.0 |
| `@tollxyz/agentkit` | 0.1.5 | 0.2.0 |
| `@tollxyz/ai-sdk` | 0.1.5 | 0.2.0 |
| `@tollxyz/goat-plugin` (packages/goat) | 0.1.5 | 0.2.0 |
| `@tollxyz/plugin-elizaos` | 0.1.5 | 0.2.0 |
| `@tollxyz/langchain` | 0.1.1 | 0.2.0 |
| `@tollxyz/mastra` | 0.1.1 | 0.2.0 |
| `@tollxyz/mcp` | 0.1.4 | 0.2.0 |
| `@tollxyz/x402-seller` | 0.1.0 | 0.1.1 (README template note only) |
| `toll-sdk` (PyPI, packages/sdk-py) | 0.1.1 | 0.2.0 |
| `@tollxyz/guard` | 0.1.0 | unchanged, do not publish |

## 0. Check the branch

```sh
cd ~/toll-plugins
git checkout rh-only-1105
git status --short                      # must be empty
export NODE_OPTIONS=--max-old-space-size=3072
npm whoami                              # tollxyz
```

Build and test one package at a time (low RAM):

```sh
for d in sdk-js agentkit ai-sdk goat plugin-elizaos langchain mastra mcp x402-seller; do
  (cd packages/$d && npm run build && npm test) || { echo "STOP: $d"; break; }
done
node scripts/check-skills.mjs
(cd packages/sdk-py && uv run --with pytest pytest -q)
```

## 1. npm: the SDK first

Every plugin depends on `@tollxyz/sdk ^0.2.0`, so it goes first.

```sh
(cd packages/sdk-js && npm publish --access public)
npm view @tollxyz/sdk@0.2.0 version    # wait until it prints 0.2.0 (can take a few minutes)
```

## 2. npm: the plugins and the MCP server

`prepublishOnly` builds each one.

```sh
(cd packages/agentkit       && npm publish --access public)
(cd packages/ai-sdk         && npm publish --access public)
(cd packages/goat           && npm publish --access public)
(cd packages/plugin-elizaos && npm publish --access public)
(cd packages/langchain      && npm publish --access public)
(cd packages/mastra         && npm publish --access public)
(cd packages/mcp            && npm publish --access public)
(cd packages/x402-seller    && npm publish --access public)
```

Check: `for p in sdk agentkit ai-sdk goat-plugin plugin-elizaos langchain mastra mcp; do npm view @tollxyz/$p version; done`
(all 0.2.0) and `npm view @tollxyz/x402-seller version` (0.1.1).

## 3. PyPI: toll-sdk 0.2.0

The token is in `~/.pypirc`.

```sh
cd packages/sdk-py
rm -rf dist
uv build                                # dist/toll_sdk-0.2.0-py3-none-any.whl and dist/toll_sdk-0.2.0.tar.gz
uvx twine check dist/*
uvx twine upload dist/*                 # reads ~/.pypirc; or: uv publish (with UV_PUBLISH_TOKEN set)
cd ../..
```

## 4. GitHub: push the branch and fast-forward main

Commits are by Toll (125651579+soli0x@users.noreply.github.com).

```sh
git push origin rh-only-1105
git checkout main && git merge --ff-only rh-only-1105 && git push origin main
git rev-parse HEAD                      # the sha for the Hermes catalog (step 6)
```

## 5. MCP registry

Two listings point at Toll:

1. `io.github.t0ll-xyz/toll` (this repo's `packages/mcp/server.json`, now 0.2.0; the npm package `@tollxyz/mcp` 0.2.0
   must be on npm first, step 2):

   ```sh
   cd packages/mcp
   mcp-publisher login github           # as a member of the t0ll-xyz org
   mcp-publisher publish                # reads server.json
   cd ../..
   ```

2. `xyz.t0ll/toll` (the remote listing in `~\toll-mcp-repo`, branch `rh-only-1105`, commit bbd798e):
   `server.json` is now 1.0.3 with the title "Toll — coin, agent and pre-sign checks on Robinhood Chain" (it said
   "coin and product checks on Robinhood Chain, Solana, BSC"), and the README lists all 18 tools.

   ```sh
   cd ~/toll-mcp-repo
   git push origin rh-only-1105
   git checkout main && git merge --ff-only rh-only-1105 && git push origin main
   mcp-publisher login dns --domain t0ll.xyz --private-key <the key used for 1.0.2>
   mcp-publisher publish
   ```

Check: `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=t0ll"` shows 1.0.3 as latest.

## 6. Hermes plugin catalog (a later PR)

The Hermes catalog entry (`~/hermes-catalog/toll.yaml`, the `plugin-catalog/toll.yaml` PR to NousResearch/hermes-agent)
still pins sha `e132929520afa8b3c3f94724c309ba84bb079f2e`, version "0.1.0", and its description says "on Robinhood
Chain, Solana, BSC and Arc". After step 4, open a follow-up PR (or update the open one) that:

- sets `sha:` to the new main sha from step 4 (`git rev-parse HEAD`),
- sets `version: "0.2.0"` (matches `integrations/hermes/plugin.json` and its skill),
- replaces "on Robinhood Chain, Solana, BSC and Arc" with "on Robinhood Chain (4663) only", and adds 13F holders,
  earnings guidance and the Stock Token event feed to the market data list.

## 7. Other places that copy this text

- ClawHub (OpenClaw skill, if it is listed):
  `clawhub skill publish ./skills/openclaw/toll --slug toll --name "Toll" --version 0.2.0 --changelog "Robinhood Chain only; check_tx, presign_risk_report, institutions, guidance, stock_events" --tags latest`
- https://t0ll.xyz/skill.md is served from the site repo (`public/skill.md`): copy `docs/site/skill.md` there in the
  next site deploy so the two match.

Information only, not financial advice.

---

## client-id release (11-05)

Branch `client-id-1105`. Nothing below has been run. The SDKs now send a stable install id (`x-toll-client`, read from
`~/.toll/client-id` or random) on every MCP call so t0ll.xyz can count returning agents. `npm whoami` must say `tollxyz`.

| Package | Old | New |
| --- | --- | --- |
| `@tollxyz/sdk` (packages/sdk-js) | 0.2.0 | 0.2.1 |
| `@tollxyz/agentkit`, `ai-sdk`, `goat-plugin`, `plugin-elizaos`, `langchain`, `mastra`, `mcp` | 0.2.0 | 0.2.1 (depend on `@tollxyz/sdk ^0.2.1`) |
| `toll-sdk` (PyPI, packages/sdk-py) | 0.2.0 | 0.2.1 |
| `@tollxyz/x402-seller`, `@tollxyz/guard` | unchanged, do not publish | |

```sh
cd ~/toll-plugins
git checkout client-id-1105
git status --short                      # only packages/sdk-py/uv.lock may show (leave it)
export NODE_OPTIONS=--max-old-space-size=3072
npm whoami                              # tollxyz

# build + test, one at a time
for d in sdk-js agentkit ai-sdk goat plugin-elizaos langchain mastra mcp; do
  (cd packages/$d && npm run build && npm test) || { echo "STOP: $d"; break; }
done
(cd packages/sdk-py && uv run --with pytest pytest -q)

# 1. the SDK first (the plugins need ^0.2.1)
(cd packages/sdk-js && npm publish --access public)
npm view @tollxyz/sdk@0.2.1 version     # wait until it prints 0.2.1

# 2. the plugins and the MCP server
(cd packages/agentkit       && npm publish --access public)
(cd packages/ai-sdk         && npm publish --access public)
(cd packages/goat           && npm publish --access public)
(cd packages/plugin-elizaos && npm publish --access public)
(cd packages/langchain      && npm publish --access public)
(cd packages/mastra         && npm publish --access public)
(cd packages/mcp            && npm publish --access public)

# 3. PyPI
cd packages/sdk-py
rm -rf dist
uv build                                # dist/toll_sdk-0.2.1-py3-none-any.whl and .tar.gz
uvx twine check dist/*
uvx twine upload dist/*
cd ../..

# 4. GitHub
git push origin client-id-1105
git checkout main && git merge --ff-only client-id-1105 && git push origin main

# 5. MCP registry (packages/mcp/server.json is 0.2.1; @tollxyz/mcp 0.2.1 must be on npm first)
cd packages/mcp && mcp-publisher login github && mcp-publisher publish && cd ../..
```

Check: `for p in sdk agentkit ai-sdk goat-plugin plugin-elizaos langchain mastra mcp; do npm view @tollxyz/$p version; done`
(all 0.2.1) and `pip index versions toll-sdk` (0.2.1).

## check_hook release (11-05)

What changed: `check_hook(address)` (one Uniswap v4 hook on Robinhood Chain) in `@tollxyz/sdk` (`checkHook`) and
`toll-sdk` (`check_hook`), and as a tool/action in every wrapper (agentkit, ai-sdk, goat, langchain, mastra,
plugin-elizaos `TOLL_CHECK_HOOK`); `@tollxyz/mcp` snapshot + instructions name it (the live list is proxied as is).
Every package goes 0.2.1 -> 0.2.2; the wrappers need `@tollxyz/sdk ^0.2.2`. Branch `check-hook-1105`.
Publish only after the site with `check_hook` is live (`curl -s https://t0ll.xyz/mcp` tools/list has check_hook),
else the wrappers call a tool the server does not have.

```bash
cd ~/toll-plugins
git checkout check-hook-1105
export NODE_OPTIONS=--max-old-space-size=3072
npm whoami                              # tollxyz

# build + test, one at a time (the SDK first: the wrappers import its dist)
for d in sdk-js agentkit ai-sdk goat plugin-elizaos langchain mastra mcp; do
  (cd packages/$d && npm run build && npm test) || { echo "STOP: $d"; break; }
done
(cd packages/sdk-py && uv run --with pytest pytest -q)
node scripts/check-skills.mjs

# 1. the SDK first (the plugins need ^0.2.2)
(cd packages/sdk-js && npm publish --access public)
npm view @tollxyz/sdk@0.2.2 version     # wait until it prints 0.2.2

# 2. the plugins and the MCP server
(cd packages/agentkit       && npm publish --access public)
(cd packages/ai-sdk         && npm publish --access public)
(cd packages/goat           && npm publish --access public)
(cd packages/plugin-elizaos && npm publish --access public)
(cd packages/langchain      && npm publish --access public)
(cd packages/mastra         && npm publish --access public)
(cd packages/mcp            && npm publish --access public)

# 3. PyPI
cd packages/sdk-py
rm -rf dist
uv build                                # dist/toll_sdk-0.2.2-py3-none-any.whl and .tar.gz
uvx twine check dist/*
uvx twine upload dist/*
cd ../..

# 4. GitHub
git push origin check-hook-1105
git checkout main && git merge --ff-only check-hook-1105 && git push origin main

# 5. MCP registry (packages/mcp/server.json is 0.2.2; @tollxyz/mcp 0.2.2 must be on npm first)
cd packages/mcp && mcp-publisher login github && mcp-publisher publish && cd ../..
# and the registry listing in ~/toll-mcp-repo (server.json 1.0.4, branch check-hook-1105):
cd ~/toll-mcp-repo && git push origin check-hook-1105 && mcp-publisher login github && mcp-publisher publish && cd -
```

Check: `for p in sdk agentkit ai-sdk goat-plugin plugin-elizaos langchain mastra mcp; do npm view @tollxyz/$p version; done`
(all 0.2.2) and `pip index versions toll-sdk` (0.2.2).
