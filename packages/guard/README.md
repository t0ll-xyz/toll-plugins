# @tollxyz/guard

Toll's live pre-sign check in front of an AI agent's wallet. Before the agent signs a transaction, an EIP-712
signature or an x402 payment on Robinhood Chain, the guard asks [Toll](https://t0ll.xyz/agents/x402#presign) and
gets ALLOW / WARN / BLOCK with the reasons. Zero runtime dependencies, ESM only, Node >= 20.19, with types.

```sh
npm install @tollxyz/guard
```

```ts
const wallet = guard(walletClient);   // viem WalletClient or ethers v6 Signer; same methods, checked first
```

```ts
import { guard, TollBlockedError } from "@tollxyz/guard";

const wallet = guard(walletClient, { onWarn: "allow", onUnavailable: "allow" });
try {
  await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] });
} catch (e) {
  if (e instanceof TollBlockedError) console.log(e.codes, e.assessment); // not signed
  else throw e;
}
```

Run it as an ES module (an `.mjs`/`.mts` file, or `"type": "module"` in package.json).

Toll states facts, never says safe: ALLOW means none of the checks Toll runs found a reason to stop, nothing more.
Information only, not financial advice.

## What is checked

Every check runs on Toll's server (`POST https://t0ll.xyz/api/tx/check`), so new checks reach you without a package
update. The full list is at <https://t0ll.xyz/agents/x402#presign>: what the calldata or signature does (approvals,
Permit / Permit2, transfers, swaps), unlimited approvals and approvals to a wallet instead of a contract, spenders and
recipients Toll has flagged, a swap that pays someone else, the coin a swap buys (Toll's coin check: who is behind
it), and for x402 the payee against the seller's registered ERC-8004 agentWallet (including `extra.erc8004`).

The answer is an [ERC-8265](https://github.com/ethereum/ERCs/pull/1753) RiskAssessment:
`{ action, warnings: [{ code, severity, message, "x-toll-evidence" }], scanners, "x-toll": { decoded, link, checked_at, note } }`.
Critical = BLOCK, high or medium = WARN, low or none = ALLOW.

Robinhood Chain (4663) only for now. A request on another chain, or a contract deployment, is not sent to Toll and
goes through (`onUnsupported: "block"` to stop it instead).

## API

### `guard(wallet, opts?)`, `guardViem(client, opts?)`, `guardEthers(signer, opts?)`

Returns the same wallet behind a Proxy. Checked first:

- viem WalletClient: `sendTransaction`, `writeContract` (calldata encoded with your viem's `encodeFunctionData`),
  `signTransaction`, `signTypedData`
- ethers v6 Signer: `sendTransaction`, `signTransaction`, `signTypedData`

Everything else passes through unchanged. Wrap last: `client.extend(...)` or `signer.connect(...)` on the wrapped
wallet returns an unguarded one. viem and ethers are optional peer dependencies, never imported at load time.

### `guardX402Fetch(fetch, opts?)`

Wraps the fetch your x402 client uses. When a 402 arrives, its payment requirement goes to Toll before the client
pays; on BLOCK the 402 never reaches the payer (TollBlockedError is thrown). The paid retry (a request with a
`PAYMENT-SIGNATURE` or `X-PAYMENT` header) and every non-402 answer pass through.

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const pay = wrapFetchWithPayment(guardX402Fetch(fetch, { agentId: 123 }), account);
```

`agentId` (the seller's ERC-8004 id, or a function of the URL) is optional.

### `checkTx(input, opts?)`

The raw call. `input`: `{ chainId, from, to, data, value }` for a transaction, `{ typedData }` for an EIP-712
request, `{ x402, agentId?, payment? }` for an x402 payment, or several together. Returns the RiskAssessment. When a
coin is still being read, Toll answers WARN `coin-not-read` with `Retry-After`: `checkTx` asks once more if the wait
is at most `maxRetryWaitMs` (default 10 s); a coin still not read stays WARN, never ALLOW. Throws
`TollUnavailableError` when Toll cannot answer.

### Options

| Option | Default | |
| --- | --- | --- |
| `onWarn` | `"allow"` | `"allow"` (logged and reported), `"block"`, or `(assessment) => boolean` (true lets it through) |
| `onBlock` | `"throw"` | `"throw"` (TollBlockedError), or `(assessment) => boolean`, e.g. ask a human; true lets it through |
| `onUnavailable` | `"allow"` | Toll unreachable, timed out, 5xx, 429, or a request it could not read: `"allow"` (fail-open, logged) or `"block"` (fail-closed, TollUnavailableError) |
| `onUnsupported` | `"allow"` | another chain, a deployment: `"allow"` or `"block"` |
| `onReport` | none | `(report) => void`: every decision, with `assessment`, `decision`, `basis`, `paidUrl` |
| `logger` | `console.warn` | where WARN and unavailable lines go; `false` = silent |
| `timeoutMs` | `15000` | one request to Toll |
| `retry`, `maxRetryWaitMs` | `true`, `10000` | the one retry after Retry-After |
| `baseUrl`, `fetch` | `https://t0ll.xyz`, global fetch | |

Errors: `TollBlockedError` (`.assessment`, `.codes`, message lists each code and message) and
`TollUnavailableError` (`.reason`, `.status`, `.paidUrl`).

## Fail-open or fail-closed

The default is fail-open: if Toll cannot answer, the signature goes ahead, with a `[toll-guard] ... NOT checked`
line and an `onReport` call with `basis: "unavailable"`. The agent must never get stuck because of Toll, and the
free route is rate limited per IP (a busy agent will see 429s). If an unchecked signature is worse for you than a
stalled agent, set `onUnavailable: "block"`.

## Free limit and the paid route

The check is free, rate limited per IP. The coin a swap buys is read through the same free coins as Toll's coin
check (10 new coins a day per caller, coins already read stay free); past that the coin is not read and the answer
is WARN `coin-over-quota` naming the paid route, `https://t0ll.xyz/api/x402/tx` (0.01 USDG over x402, no daily
limit). The guard never pays: it puts that URL in the log line, in `report.paidUrl` and in `paidUrlOf(assessment)`.

## Privacy

What is sent to Toll: the transaction, EIP-712 request or x402 payment requirement you are about to sign (to, data,
value, chain id, your address as `from`), nothing else. No key, no account, no signature.

## ERC-8470 observations

`read8470(token, opts?)` reads Toll's latest on-chain [ERC-8470](https://github.com/ethereum/ERCs/pull/2121) Launch
Observation of a token on Robinhood Chain (registry `0x730e3c356299c9203cb042f6c0a9274aeabf9af3`, Toll's detector
`0x02593AbFf31f4E8eC1D5c2F297a347C51ef06E5c`) with a plain `eth_call` to `https://rpc.mainnet.chain.robinhood.com`
(`rpcUrl` to change). Returns the observation and its findings, or null when Toll has none for that token. A finding
not read (`type(uint256).max` on chain) is `value: null, notRead: true`, never 0.
`latestFinding8470(token, kind, param?)` reads one finding (kind by name, e.g. `"first-block-share"`, or bytes32).

## Specs

- Pre-sign check: <https://t0ll.xyz/agents/x402#presign>
- ERC-8470 Launch Observations: <https://github.com/ethereum/ERCs/pull/2121>
- x402 Payee Verification: <https://github.com/ethereum/ERCs/pull/2132>
- ERC-8265 RiskAssessment: <https://github.com/ethereum/ERCs/pull/1753>

## Develop

```sh
npm run build && npm test     # unit tests, no network
node scripts/smoke.mjs        # one live call with a harmless request (a 0-value transfer)
```

MIT.
