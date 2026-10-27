# toll-sdk

Python client for [Toll](https://t0ll.xyz/agents)'s coin checks, read from the chain (Robinhood Chain, Solana, BSC), over Toll's remote MCP server. Who is behind a coin, the dev's record, and whether there is a real product behind it. Standard library only, Python >= 3.9, typed.

Information only, not financial advice.

## Install

```sh
pip install toll-sdk
```

## Example

```python
from toll import Toll

toll = Toll()
check = toll.check_coin("0xff9e86e6b21fd688027981bee4b64c8b6b804ed3", chain="rh")
print(check.text)                      # markdown facts from the chain
larp = toll.larp_check("0xff9e86e6b21fd688027981bee4b64c8b6b804ed3", wait=True)
print(larp.text)                       # product found / partly found / not found / not read
```

Every method returns `TollResult(text, paid_url, pending)`.

## API

`Toll(base_url="https://t0ll.xyz", opener=None, timeout=30.0, sign=None, pay_timeout=300.0)`

- `check_coin(address, chain=None)` - chain is `rh`, `sol` or `bsc`
- `larp_check(token, chain=None, wait=False)` - `rh` or `sol`; `wait=True` asks again after the seconds the server gives (max 3 tries, max 120 s)
- `dev_record(wallet, chain=None)`, `launch_record(address)`, `wallet_privacy(wallet)`, `fresh_launches(limit=None)`, `chain_pulse()`
- `tools()` lists the server's tools, `call(name, args)` calls any of them
- `pay(paid_url, sign=None, timeout=None)` - pays a paid URL once and returns its JSON (see below)
- `is_valid_address(x)`, `is_valid_wallet(x)` - the checks run before anything is sent
- Failures (HTTP, JSON-RPC, timeouts, server-side input errors) raise `TollError`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the result carries `paid_url`, the x402 endpoint for that coin (0.05 USDG on Robinhood Chain, charged only for a whole answer).

`pay(paid_url)` runs the x402 flow itself and asks your `sign` function for one payment:

1. GET the URL without payment. Toll answers 402 with what to pay: x402 v2 in the `PAYMENT-REQUIRED` header, v1 in the body.
2. Call `sign(requirements, url)` **once**. It returns the payment header value.
3. GET again with it (`PAYMENT-SIGNATURE` for v2, `X-PAYMENT` for v1, following what the 402 offered). While Toll is still reading the coin it answers 402 `{"pending": true}` (nothing charged): `pay` resends **exactly the same header** after `Retry-After` (at least 1 s), up to 5 tries and 300 s. A 200 is the answer. Any other 402 after paying raises `TollError` "payment not accepted"; `pay` never signs a second payment for one call.

The whole call has its own timeout (`pay_timeout`, default 300 s). If it times out or the connection drops after the payment was sent, the error says the payment may have settled: do not retry that call with a new signature; resend the same header.

### The `sign` contract

```python
from toll import PaymentRequirements, Toll

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

Your key never touches this SDK. Without a `sign`, `pay` raises before any request. The JavaScript SDK's README has a worked `sign` built on `@priors/x402`. Docs: <https://t0ll.xyz/agents>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

MIT.
