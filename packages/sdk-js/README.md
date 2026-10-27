# @tollxyz/sdk

Client for [Toll](https://t0ll.xyz/agents)'s coin checks, read from the chain (Robinhood Chain, Solana, BSC), over Toll's remote MCP server. Who is behind a coin, the dev's record, and whether there is a real product behind it. Zero runtime dependencies (global `fetch`, Node >= 18), ESM with types.

Information only, not financial advice.

## Install

```sh
npm install @tollxyz/sdk
```

## Example

```ts
import { Toll } from "@tollxyz/sdk";

const toll = new Toll();
const check = await toll.checkCoin("0xff9e86e6b21fd688027981bee4b64c8b6b804ed3", { chain: "rh" });
console.log(check.text);                       // markdown facts from the chain
const larp = await toll.larpCheck("0xff9e86e6b21fd688027981bee4b64c8b6b804ed3", { wait: true });
console.log(larp.text);                        // product found / partly found / not found / not read
```

Every method returns `{ text, paidUrl, pending }`.

## API

`new Toll({ baseUrl?, fetch?, payFetch?, timeoutMs? })`

- `checkCoin(address, { chain?: "rh" | "sol" | "bsc" })`
- `larpCheck(token, { chain?: "rh" | "sol", wait?: boolean })` - with `wait: true` it asks again after the seconds the server gives (max 3 tries, max 120 s)
- `devRecord(wallet, { chain? })`, `launchRecord(address)`, `walletPrivacy(wallet)`, `freshLaunches(limit?)`, `chainPulse()`
- `tools()` lists the server's tools, `call(name, args)` calls any of them
- `pay(paidUrl)` GETs a paid URL with your `payFetch` and returns the JSON
- `isValidAddress(x)`, `isValidWallet(x)` - the same checks the SDK runs before anything is sent
- Errors (HTTP, JSON-RPC, timeouts, server-side input errors) are thrown as `TollError`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer carries `paidUrl`, the x402 endpoint for that coin (0.05 USDG on Robinhood Chain, charged only for a whole answer). Bring an x402-aware fetch to pay it:

```ts
const toll = new Toll({ payFetch });   // e.g. from x402-fetch, wrapping your wallet
const r = await toll.checkCoin(address);
if (r.paidUrl) console.log(await toll.pay(r.paidUrl));
```

Without a `payFetch`, `pay()` throws a clear error. Docs: <https://t0ll.xyz/agents>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

MIT.
