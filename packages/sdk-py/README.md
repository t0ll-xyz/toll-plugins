# toll-sdk

Python client for [Toll](https://t0ll.xyz/agents/plugins)'s checks on Robinhood Chain (chain id 4663), over Toll's remote MCP server: who is behind a coin, the dev's record, whether there is a real product behind it, what a wallet gives away, an ERC-8004 agent's facts, a pre-sign check before signing, and Robinhood Stock Token data (the token, its company's SEC numbers, insider trades, 13F holders, earnings guidance, the event feed) and US macro. All 18 live tools. Toll reads Robinhood Chain only right now: `chain` takes only `"rh"`, and a Solana mint or another chain raises `TollError` "Toll reads Robinhood Chain only right now." before anything is sent. Standard library only, Python >= 3.9, typed.

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

`Toll(base_url="https://t0ll.xyz", opener=None, timeout=30.0, sign=None, pay_timeout=300.0, toll_key=None)` - `toll_key` (from <https://t0ll.xyz/toll#keys>) is sent as `x-toll-pass` on every MCP call and carries your $TOLL tier

- `check_coin(address, chain=None)` - chain is `rh` or left out
- `larp_check(token, chain=None, wait=False)` - `wait=True` asks again after the seconds the server gives while part of the answer is still being read or Toll is busy with many new LARP checks (max 3 tries, max 120 s)
- `dev_record(wallet, chain=None)`, `launch_record(address)`, `wallet_privacy(wallet)`, `fresh_launches(limit=None)`, `chain_pulse()`
- `check_agent(agent_id)` - an ERC-8004 agent on Robinhood Chain by its agent id
- `check_tx(to=, data=, value=, from_=, typed_data=, x402=, agent_id=, registry=, strict=, chain_id=)` - the pre-sign check for a transaction, an EIP-712 signature (`typed_data`) or an x402 payment (`x402`): ALLOW / WARN / BLOCK with the reasons, an ERC-8265 RiskAssessment (`chain_id` only 4663). Pass on every warning; on BLOCK do not sign without the owner's say.
- `presign_risk_report(subject, context=None, kinds=None)` - the Agent Pre-Sign Risk Report (ERC draft, ethereum/ERCs PR #2134, version `erc-presign/1`): typed facts about the unsigned request, EIP-712 signed by Toll, no verdict
- `stock_token(id)`, `stock_tokens(query=None, limit=None)` - Robinhood Stock Tokens by ticker (`NVDA`, `BRK.B`) or contract
- `fundamentals(id, period=None)` (`ttm`, `annual`, `quarterly`), `insider_trades(id, limit=None)` (1 to 100), `institutions(id, limit=None)` (13F holders, 1 to 20), `guidance(id, limit=None)` (earnings releases, SEC 8-K Item 2.02, AI-extracted from cited filings, 1 to 60 per release), `macro()`
- `stock_events(since=None, kind=None, limit=None)` - what changed on the Stock Tokens, oldest first (`since` = the last answer's `next`). Without a key: the last 10 events found an hour ago or more; Pro 15 minutes late, Team live
- `tools()` lists the server's tools, `call(name, args)` calls any of them; `TOOL_NAMES` lists all 18
- `pay(paid_url, sign=None, timeout=None)` - pays a paid URL once and returns its JSON (see below)
- `is_valid_address(x)`, `is_valid_wallet(x)`, `is_valid_stock_id(x)` - the checks run before anything is sent
- Failures (HTTP, JSON-RPC, timeouts, server-side input errors) raise `TollError`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the result carries `paid_url`, the x402 endpoint for that coin (0.05 USDG on Robinhood Chain, charged only for a whole answer). Markets calls have their own free count (50 a day; 1,000 / 5,000 / 20,000 with 1M / 5M / 20M $TOLL via `toll_key`); past it, x402 per call: 0.02 USDG a Stock Token, 0.01 USDG for fundamentals, insider trades, institutions (`https://t0ll.xyz/api/x402/markets/institutions/{id}`), guidance (`https://t0ll.xyz/api/x402/markets/guidance/{id}`) or macro.

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
