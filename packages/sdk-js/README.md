# @tollxyz/sdk

Client for [Toll](https://t0ll.xyz/agents/plugins)'s checks on Robinhood Chain (chain id 4663), over Toll's remote MCP server: who is behind a coin, the dev's record, whether there is a real product behind it, what a wallet gives away, an ERC-8004 agent's facts, a pre-sign check before signing, and Robinhood Stock Token data (the token, its company's SEC numbers, insider trades, 13F holders, earnings guidance, the event feed) and US macro. All 18 live tools. Toll reads Robinhood Chain only right now: `chain` takes only `"rh"`, and a Solana mint or another chain is refused with `TollError` "Toll reads Robinhood Chain only right now." before anything is sent. Zero runtime dependencies (global `fetch`), ESM only (no CommonJS build), Node >= 20.19, with types.

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

Run it as an ES module (an `.mjs`/`.mts` file, or `"type": "module"` in package.json; `npm init -y` writes `"type": "commonjs"`, where top-level `await` fails).

Every method returns `{ text, paidUrl, pending }`. `pending` (`{ retryAfterS }` or null) means part of the answer is still being read: ask again after that many seconds. `paidUrl` is set when the free coins are used up (see below).

## API

`new Toll({ baseUrl?, tollKey?, fetch?, sign?, timeoutMs?, payTimeoutMs? })` - `tollKey` (from <https://t0ll.xyz/toll#keys>) is sent as `x-toll-pass` on every MCP call and carries your $TOLL tier

- `checkCoin(address, { chain?: "rh" })`
- `larpCheck(token, { chain?: "rh", wait?: boolean })` - with `wait: true` it asks again after the seconds the server gives while part of the answer is still being read or Toll is busy with many new LARP checks (max 3 tries, max 120 s)
- `devRecord(wallet, { chain? })`, `launchRecord(address)`, `walletPrivacy(wallet)`, `freshLaunches(limit?)`, `chainPulse()`
- `checkAgent(id)` - an ERC-8004 agent on Robinhood Chain by its agent id
- `checkTx({ chainId?, from?, to?, data?, value?, typedData?, x402?, agentId?, registry?, strict? })` - the pre-sign check for a transaction (`to`, `data`, `value`, `from`), an EIP-712 signature (`typedData`) or an x402 payment (`x402`): ALLOW / WARN / BLOCK with the reasons, an ERC-8265 RiskAssessment (`chainId` only 4663). Pass on every warning; on BLOCK do not sign without the owner's say.
- `presignRiskReport({ version: "erc-presign/1", subject, context?, kinds? })` - the Agent Pre-Sign Risk Report (ERC draft, ethereum/ERCs PR #2134): typed facts about the unsigned request, EIP-712 signed by Toll, no verdict
- `stockToken(id)`, `stockTokens({ query?, limit? })` - Robinhood Stock Tokens by ticker (`NVDA`, `BRK.B`) or contract
- `fundamentals(id, { period? })` (`ttm`, `annual`, `quarterly`), `insiderTrades(id, { limit? })` (1 to 100), `institutions(id, { limit? })` (13F holders, 1 to 20), `guidance(id, { limit? })` (earnings releases, SEC 8-K Item 2.02, AI-extracted from cited filings, 1 to 60 per release), `macro()`
- `stockEvents({ since?, kind?, limit? })` - what changed on the Stock Tokens, oldest first (`since` = the last answer's `next`). Without a key: the last 10 events found an hour ago or more; Pro 15 minutes late, Team live
- `tools()` lists the server's tools, `call(name, args)` calls any of them; `TOOL_NAMES` lists all 18
- `pay(paidUrl, { sign?, timeoutMs? })` pays a paid URL once and returns its JSON (see below)
- `isValidAddress(x)`, `isValidWallet(x)`, `isValidStockId(x)` - the same checks the SDK runs before anything is sent
- Errors (HTTP, JSON-RPC, timeouts, server-side input errors) are thrown as `TollError`.

## Free limit and the paid path

10 new coins a day per caller are free (coins already read stay free). Past that, the answer carries `paidUrl`, the x402 endpoint for that coin (0.05 USDG on Robinhood Chain, charged only for a whole answer). Markets calls have their own free count (50 a day; 1,000 / 5,000 / 20,000 with 1M / 5M / 20M $TOLL via `tollKey`); past it, x402 per call: 0.02 USDG a Stock Token, 0.01 USDG for fundamentals, insider trades, institutions (`https://t0ll.xyz/api/x402/markets/institutions/{id}`), guidance (`https://t0ll.xyz/api/x402/markets/guidance/{id}`) or macro.

`pay(paidUrl)` runs the x402 flow itself and asks your `sign` function for one payment:

1. GET the URL without payment. Toll answers 402 with what to pay: x402 v2 in the `PAYMENT-REQUIRED` header, v1 in the body.
2. Call `sign(requirements, url)` **once**. It returns the payment header value.
3. GET again with it (`PAYMENT-SIGNATURE` for v2, `X-PAYMENT` for v1, following what the 402 offered). While Toll is still reading the coin it answers 402 `{"pending": true}` (nothing charged): `pay()` resends **exactly the same header** after `Retry-After` (at least 1 s), up to 5 tries and 300 s. A 200 is the answer. Any other 402 after paying throws `TollError` "payment not accepted"; `pay()` never signs a second payment for one call.

The whole call has its own timeout (`payTimeoutMs`, default 300000). If it times out or the connection drops after the payment was sent, the error says the payment may have settled: do not retry that call with a new signature; resend the same header.

### The `sign` contract

```ts
type SignPayment = (requirements: PaymentRequirements, url: string) => Promise<string> | string;

interface PaymentRequirements {
  x402Version: 1 | 2;           // 2 when the 402 had a PAYMENT-REQUIRED header
  paymentRequired: { x402Version: number; accepts: Array<Record<string, unknown>>; ... }; // the decoded 402
  accepts: Array<Record<string, unknown>>; // scheme, network "eip155:4663", asset (USDG), amount, payTo, ...
}
```

Return the header value for `x402Version` (the base64 payment payload). Check the amount and `payTo` in `accepts` before you sign. Your key never touches this SDK.

### Example: `sign` with @priors/x402

Built and run against `@priors/x402` 0.8.2 and `@x402/core` 2.28 (USDG on Robinhood Chain, with a price cap):

```ts
import { ethers } from "ethers";
import { createUsdgClient, robinhood } from "@priors/x402";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { Toll, type SignPayment } from "@tollxyz/sdk";

const signer = new ethers.Wallet(process.env.AGENT_KEY!, new ethers.JsonRpcProvider(robinhood.rpcUrl)); // holds USDG
const x402 = createUsdgClient({ signer, maxPrice: "$0.05" });
const sign: SignPayment = async (req) => {
  if (req.x402Version !== 2) throw new Error("this signer speaks x402 v2");
  return encodePaymentSignatureHeader(await x402.createPaymentPayload(req.paymentRequired as any));
};

const toll = new Toll({ sign });
const r = await toll.checkCoin(address);
if (r.paidUrl) console.log(await toll.pay(r.paidUrl));
```

Without a `sign`, `pay()` throws before any request. Docs: <https://t0ll.xyz/agents/plugins>, <https://t0ll.xyz/llms.txt>, <https://t0ll.xyz/agents/x402>.

MIT.
