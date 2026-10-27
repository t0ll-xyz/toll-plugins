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

`Toll(base_url="https://t0ll.xyz", opener=None, timeout=30.0)`

- `check_coin(address, chain=None)` - chain is `rh`, `sol` or `bsc`
- `larp_check(token, chain=None, wait=False)` - `rh` or `sol`; `wait=True` asks again after the seconds the server gives (max 3 tries, max 120 s)
- `dev_record(wallet, chain=None)`, `launch_record(address)`, `wallet_privacy(wallet)`, `fresh_launches(limit=None)`, `chain_pulse()`
- `tools()` lists the server's tools, `call(name, args)` calls any of them
- `pay(paid_url, session)` - see below
- `is_valid_address(x)`, `is_valid_wallet(x)` - the checks run before anything is sent
- Failures (HTTP, JSON-RPC, timeouts, server-side input errors) raise `TollError`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the result carries `paid_url`, the x402 endpoint for that coin (0.05 USDG on Robinhood Chain, charged only for a whole answer). `pay` takes any callable that does an x402-aware GET and returns `(status, headers, body)` (or a requests-style response); it waits and resends on `402 {"pending": true}`:

```python
r = toll.check_coin(address)
if r.paid_url:
    print(toll.pay(r.paid_url, my_x402_get))
```

Without a session, `pay` raises a clear error. Docs: <https://t0ll.xyz/agents>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

MIT.
