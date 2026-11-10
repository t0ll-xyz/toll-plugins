# toll-sdk

Python client for [Toll](https://t0ll.xyz/agents/plugins)'s checks on Robinhood Chain (chain id 4663), over Toll's remote MCP server: who is behind a coin, the dev's record, whether there is a real product behind it, what a wallet gives away, an ERC-8004 agent's facts, a pre-sign check before signing, and Robinhood Stock Token data (the token, its company's SEC numbers, insider trades, 13F holders, earnings guidance, the event feed) and US macro. All 27 live tools. Toll reads Robinhood Chain only right now: `chain` takes only `"rh"`, and a Solana mint or another chain raises `TollError` "Toll reads Robinhood Chain only right now." before anything is sent. Standard library only, Python >= 3.9, typed.

Information only, not financial advice.

## Install

```sh
pip install toll-sdk        # import name: toll_sdk
```

## Example

```python
from toll_sdk import Toll

toll = Toll()
check = toll.check_coin("0xff9e86e6b21fd688027981bee4b64c8b6b804ed3", chain="rh")
print(check.text)                      # markdown facts from the chain
larp = toll.larp_check("0xff9e86e6b21fd688027981bee4b64c8b6b804ed3", wait=True)
print(larp.text)                       # product found / partly found / not found / not read
```

Every method returns `TollResult(text, paid_url, pending)`. `pending` (`{"retry_after_s": n}` or None) means part of the answer is still being read: ask again after that many seconds. `paid_url` is set when the free coins are used up (see below).

## API

`Toll(base_url="https://t0ll.xyz", opener=None, timeout=30.0, sign=None, pay_timeout=300.0, toll_key=None, client_id=None, facilitator_url=None)` - `toll_key` (from <https://t0ll.xyz/toll#keys>) is sent as `x-toll-pass` on every MCP call and carries your $TOLL tier

- `check_coin(address, chain=None)` - chain is `rh` or left out
- `larp_check(token, chain=None, wait=False)` - `wait=True` asks again after the seconds the server gives while part of the answer is still being read or Toll is busy with many new LARP checks (max 3 tries, max 120 s)
- `dev_record(wallet, chain=None)`, `launch_record(address)`, `wallet_privacy(wallet)`, `fresh_launches(limit=None)`, `chain_pulse()`
- `check_agent(agent_id)` - an ERC-8004 agent on Robinhood Chain by its agent id
- `find_paid_api(query=None, limit=None)` - the `find_paid_api` tool: paid APIs (x402) an agent can buy on Robinhood Chain, verified payTo first (text); `find_paid_apis()` for the JSON
- `check_hook(address)` - one Uniswap v4 hook on Robinhood Chain: name, permissions, upgradeable, pools, sells fail (a holder key adds the measured cut and its latest coins)
- `check_tx(to=, data=, value=, from_=, typed_data=, x402=, agent_id=, registry=, strict=, chain_id=)` - the pre-sign check for a transaction, an EIP-712 signature (`typed_data`) or an x402 payment (`x402`): ALLOW / WARN / BLOCK with the reasons, an ERC-8265 RiskAssessment (`chain_id` only 4663). Pass on every warning; on BLOCK do not sign without the owner's say.
- `presign_risk_report(subject, context=None, kinds=None)` - the Agent Pre-Sign Risk Report (ERC draft, ethereum/ERCs PR #2134, version `erc-presign/1`): typed facts about the unsigned request, EIP-712 signed by Toll, no verdict
- `stock_token(id)`, `stock_tokens(query=None, limit=None)` - Robinhood Stock Tokens by ticker (`NVDA`, `BRK.B`) or contract
- `fundamentals(id, period=None)` (`ttm`, `annual`, `quarterly`), `insider_trades(id, limit=None)` (1 to 100), `institutions(id, limit=None)` (13F holders, 1 to 20), `guidance(id, limit=None)` (earnings releases, SEC 8-K Item 2.02, AI-extracted from cited filings, 1 to 60 per release), `macro()`
- `stock_events(since=None, kind=None, limit=None)` - what changed on the Stock Tokens, oldest first (`since` = the last answer's `next`). Without a key: the last 10 events found an hour ago or more; Pro 15 minutes late, Team live
- `tools()` lists the server's tools, `call(name, args)` calls any of them; `TOOL_NAMES` lists all 28
- `pay(paid_url, sign=None, timeout=None)` - pays a paid URL once and returns its JSON (see below)
- `is_valid_address(x)`, `is_valid_wallet(x)`, `is_valid_stock_id(x)` - the checks run before anything is sent
- Failures (HTTP, JSON-RPC, timeouts, server-side input errors) raise `TollError`.

## 0.6.0 (2026-11-10): find paid APIs, the facilitator's safety screen

All 28 tools of https://t0ll.xyz/mcp (new: `find_paid_api`), and the discovery catalog of Toll's x402 facilitator
(https://x402.t0ll.xyz, also at https://t0ll.xyz/api/facilitator).

```python
from toll_sdk import Toll, screen_of

toll = Toll()
found = toll.find_paid_apis(query="stock quotes", limit=5)   # GET /discovery/search?query=...
for api in found["items"]:
    print(api["resource"], api["price"], api["payTo"], api["verified"])
toll.find_paid_apis(pay_to="0x...", operator="agent:8654", type="http", limit=20, offset=20)  # GET /discovery/resources
print(toll.find_paid_api(query="weather").text)               # the MCP tool, as text

screen_of(settle_answer)  # {"outcome": "allow" | "warn" | "block" | "not-read", "codes": [...]} or None
```

- `find_paid_apis(query=None, pay_to=None, operator=None, limit=None, type=None, offset=None)` -> `{"x402Version", "items", "pagination", "partialResults"?}`; each item: `resource`, `type`, `accepts`, `price`, `payTo`, `verified` (the payTo is the agentWallet its ERC-8004 identity registered, ERC-8478; it does not say the seller delivers), `settledViaToll`, `name`, `agentId`, `operator`. `offset` pages the list only. `facilitator_url` overrides where it reads.
- `screen_of(answer)` reads and checks `extensions.screen` of a facilitator `/verify` or `/settle` answer; `not-read` is never a refusal. `TOLL_FACILITATOR`, `SCREEN_OUTCOMES`.

## 0.5.0 (2026-11-08): approvals, blocklist, pre-sign record, badges, watches, ALLOW tickets

All 27 tools of https://t0ll.xyz/mcp (new: `wallet_approvals`, `watch_wallet`, `unwatch_wallet`), plus Toll's REST routes.

```python
from toll_sdk import Toll, coin_badge_embed, verify_webhook, append_ticket_suffix

toll = Toll(toll_key=os.environ.get("TOLL_KEY"))

a = toll.approvals(wallet)                      # GET /api/approvals/{wallet}
if a["state"] == "ok":
    for r in a["rows"]:
        print(r["risk"], r["token"], r["spender"], r["revoke"]["to"], r["revoke"]["data"])
else:
    print("not read, ask again in", a.get("retry_after_s"), "s")   # never read it as "no approvals"

bl = toll.blocklist(kind="token")               # {"not_modified", "etag", "list"}
bl = toll.blocklist(kind="token", etag=bl["etag"])  # {"not_modified": True, ...} when unchanged
csv = toll.blocklist_file("csv", since="2026-11-08T00:00:00Z")["text"]

rec = toll.tx_record()                          # check_tx calls scored 24 h later + the weekly calibration
coin_badge_embed(token)["markdown"]             # [![Toll check](https://t0ll.xyz/badge/0x...)](https://t0ll.xyz/check/0x...)

w = toll.create_wallet_watch(wallet, "https://your-agent.example/toll")  # w["secret"] when w["created"]
ok = verify_webhook(w["secret"], raw_body, headers.get("x-toll-signature"))

r = toll.check_tx(to=to, data=data, value=0, from_=me, ticket=True)
if r.action == "ALLOW" and r.ticket and "ticket" in r.ticket:
    data = append_ticket_suffix(data, r.ticket["ticket"], r.ticket["signature"])
```

- `approvals(wallet)` / `approvals_text(wallet)` / `wallet_approvals(wallet)` (the MCP tool, text)
- `blocklist(since=None, kind=None, etag=None)`, `blocklist_file("csv" | "txt", ...)`. A coin that is not listed is not cleared.
- `tx_record()` - the `/api/record/tx` JSON
- `coin_badge_url(token, size=None)`, `coin_badge_embed(token)` -> `{url, page, html, markdown, react}` (also `toll.badge_url`, `toll.badge_embed`)
- Coin watches: `create_coin_watch(token, url)`, `list_coin_watches()`, `delete_coin_watch(id)`; events `verdict_changed`, `new_against`, `dev_sold`, `cluster_sold`
- Wallet watches: `create_wallet_watch(address, url)`, `list_wallet_watches()`, `delete_wallet_watch(id)` (REST, `Authorization: Bearer <key>`) or `watch_wallet` / `unwatch_wallet` (MCP); events `approval`, `delegation`, `risky_token_in`
- `verify_webhook(secret, raw_body, signature)` / `read_webhook(...)`: `x-toll-signature: sha256=<hex HMAC-SHA256(secret, raw body)>`, constant-time
- `check_tx(..., ticket=True | {"consumer": ..., "scope": "call" | "v4swap"})`: the result carries `.assessment`, `.action` and `.ticket` (`{ticket, signature, signer}` or `{why}`); a BLOCK is never signed. `append_ticket_suffix` matches `@tollxyz/guard` byte for byte.

Watches need a Toll key and the server's watch routes open (404 `open: false` otherwise, raised as `TollError`).

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the result carries `paid_url`, the x402 endpoint for that coin (0.005 USDG on Robinhood Chain, charged only for a whole answer). Markets calls have their own free count (50 a day; 1,000 / 5,000 / 20,000 with 1M / 5M / 20M $TOLL via `toll_key`); past it, x402 per call: 0.02 USDG a Stock Token, 0.01 USDG for fundamentals, insider trades, institutions (`https://t0ll.xyz/api/x402/markets/institutions/{id}`), guidance (`https://t0ll.xyz/api/x402/markets/guidance/{id}`) or macro.

`pay(paid_url)` runs the x402 flow itself and asks your `sign` function for one payment:

1. GET the URL without payment. Toll answers 402 with what to pay: x402 v2 in the `PAYMENT-REQUIRED` header, v1 in the body.
2. Call `sign(requirements, url)` **once**. It returns the payment header value.
3. GET again with it (`PAYMENT-SIGNATURE` for v2, `X-PAYMENT` for v1, following what the 402 offered). While Toll is still reading the coin it answers 402 `{"pending": true}` (nothing charged): `pay` resends **exactly the same header** after `Retry-After` (at least 1 s), up to 5 tries and 300 s. A 200 is the answer. Any other 402 after paying raises `TollError` "payment not accepted"; `pay` never signs a second payment for one call.

The whole call has its own timeout (`pay_timeout`, default 300 s). If it times out or the connection drops after the payment was sent, the error says the payment may have settled: do not retry that call with a new signature; resend the same header.

### The `sign` contract

```python
from toll_sdk import PaymentRequirements, Toll

def sign(req: PaymentRequirements, url: str) -> str:
    # req.x402_version: 2 when the 402 had a PAYMENT-REQUIRED header, else 1
    # req.payment_required: the decoded 402 object; req.accepts: scheme, network "eip155:4663",
    #   asset (USDG), amount (v2) / maxAmountRequired (v1), payTo, maxTimeoutSeconds, extra
    # Check the amount and payTo, sign an EIP-3009 USDG transfer authorization with your x402 client,
    # and return the header value for req.x402_version (the base64 payment payload).
    ...

toll = Toll(sign=sign)
r = toll.check_coin(address)
if r.paid_url:
    print(toll.pay(r.paid_url))
```

Your key never touches this SDK. Without a `sign`, `pay` raises before any request. The JavaScript SDK's README has a worked `sign` built on `@priors/x402`. Docs: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

MIT.
