# @tollxyz/guard

> **New in 0.4.1: ALLOW tickets** (`ticket` option, `appendTicketSuffix`): a single-use, signed ticket for one exact
> call, for contracts that require one. See [ALLOW tickets](#allow-tickets).

> **New in 0.4.0: spend caps, allowlists, human approval and preview** (`spend` option). Unset, nothing changes.
> See [0.4.0: spend caps, allowlists, approval, preview](#040-spend-caps-allowlists-approval-preview).

> **0.3.1:** `signTypedData` (viem and ethers) now sends the signing account as `from`, so Toll can say what a Permit2 signature lets someone take.
>
> **What changed in 0.3.0: every signing method is checked.**
> - Messages: viem and ethers `signMessage`, and `request()` for `personal_sign` and `eth_sign`.
> - Typed data: `request()` for `eth_signTypedData_v4` too, any EIP-712 (orders, permits, sign-ins).
> - Batches: viem `sendCalls` (EIP-5792) and `request()` for `wallet_sendCalls`, each call checked.
> - Smart accounts: `guardSmartAccount` wraps a viem bundler client's `sendUserOperation` and `prepareUserOperation`;
>   `guard()` picks it for a bundler client.
> - EIP-7702: `onAuthorization` now defaults to `"check"`: Toll reads the authorization and decides (a known, verified
>   delegate is WARN medium and goes ahead under `block-high`; an unknown one is BLOCK). `"block"` and `"allow"` stay.
>   An authorization Toll cannot read is blocked.
> - A signature for another chain is blocked (before 0.3.0 it went through as unsupported); `onUnsupported: "allow"`
>   lets it through.
> - `eth_sign` always fails closed: it can sign any 32 bytes, a transaction included, so when Toll cannot answer it is
>   blocked whatever `onUnavailable` says.

> **Default changed in 0.5.1: the guard fails closed.** When Toll cannot or will not answer (unreachable, timeout,
> 429, 5xx, HTTP 400 or 413, an answer that is not a RiskAssessment) nothing is signed: `TollUnavailableError`, with
> "Not signed" in the message. Before, such a request went ahead unchecked, so whoever built the request could
> switch the check off (a request padded past Toll's 64 KB limit answers 413). To keep the old behaviour pass
> `failOpen: true` (or `onUnavailable: "allow"`), and know that it lets anyone who can shape the request skip the check.

> **Defaults changed in 0.2.0.** A WARN with any `high` or `critical` warning is now blocked (`onWarn: "block-high"`,
> the new default); a WARN with only `medium`/`low` warnings still goes ahead, logged. To keep the 0.1.x behaviour,
> pass `onWarn: "allow"`. New `strict: true` preset: WARN, unavailable and unsupported all block. Any option you pass
> explicitly still wins over the preset (`{ strict: true, onUnavailable: "allow" }` stays fail-open).

Toll's live pre-sign check in front of an AI agent's wallet. Before the agent signs a transaction, a message, an
EIP-712 signature, a batch, a user operation, an EIP-7702 authorization or an x402 payment on Robinhood Chain, the guard asks [Toll](https://t0ll.xyz/agents/x402#presign) and
gets ALLOW / WARN / BLOCK with the reasons. Zero runtime dependencies, ESM only, Node >= 20.19, with types.

```sh
npm install @tollxyz/guard
```

```ts
const wallet = guard(walletClient);   // viem WalletClient, viem bundler client or ethers v6 Signer; same methods, checked first
```

```ts
import { guard, TollBlockedError } from "@tollxyz/guard";

const wallet = guard(walletClient, { onWarn: "block-high", onUnavailable: "allow" });
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

## Gate a buy in one call

Before your agent even builds the swap, ask for one word with `@tollxyz/sdk`:

```ts
import { Toll } from "@tollxyz/sdk";
const toll = new Toll();
const r = await toll.preBuyCheck(token);          // Decision: BLOCK / WARN / ALLOW / WAIT, up to 3 reasons
if (r.decision === "BLOCK") throw new Error(r.text);           // the owner decides, never the agent
if (r.decision === "WAIT") await sleep(r.pending!.retryAfterS * 1000); // part of the coin is still being read
```

It runs the same calibrated rules as the guard's swap check (BLOCK = a finding whose coins rugged at 40% or more
within 24 h, or sells that fail), so the gate and the guard never disagree. Then let `guardViem` / `guardEthers`
check the transaction itself when it is signed.

## What is checked

Every check runs on Toll's server (`POST https://t0ll.xyz/api/tx/check`), so new checks reach you without a package
update. The full list is at <https://t0ll.xyz/agents/safety>: what the calldata or signature does (approvals,
Permit / Permit2, transfers, swaps), unlimited approvals and approvals to a wallet instead of a contract, spenders and
recipients Toll has flagged, a swap that pays someone else, the coin a swap buys (Toll's coin check: who is behind
it), the transaction simulated at the current block, what a signature lets someone take (the pull simulated on the
wallet's real balances, in USD where Toll has a price), instructions aimed at AI agents in token text and in the text
fields of EIP-712 typed data, a single-pool Uniswap v4 swap quoted on the coin's main pool (`swap-route-worse` when
that pays more than 3% more), Uniswap v4 position manager calls (`lp-take-to-other`, `lp-mint-to-other`), and for x402
the payee against the seller's registered ERC-8004 agentWallet (including `extra.erc8004`), an `upto` payment's
signed maximum and an `auth-capture` payment's escrow, token collector and hold.

The answer is an [ERC-8265](https://github.com/ethereum/ERCs/pull/1753) RiskAssessment:
`{ action, warnings: [{ code, severity, message, "x-toll-evidence" }], scanners, "x-toll": { decoded, link, checked_at, note } }`.
Critical = BLOCK, high or medium = WARN, low or none = ALLOW.

Robinhood Chain (4663) only for now. A transaction on another chain, or a contract deployment, is not sent to Toll
and goes through (`onUnsupported: "block"` to stop it instead). A signature for another chain is blocked
(`onUnsupported: "allow"` lets it through).

## API

### `guard(wallet, opts?)`, `guardViem(client, opts?)`, `guardSmartAccount(bundler, opts?)`, `guardEthers(signer, opts?)`

Returns the same wallet behind a Proxy. Checked first:

- viem WalletClient: `sendTransaction`, `writeContract` (calldata encoded with your viem's `encodeFunctionData`),
  `signTransaction`, `signTypedData`, `signMessage`, `sendCalls`, `signAuthorization`, and `request()` for
  `eth_sendTransaction`, `eth_signTransaction`, `personal_sign`, `eth_sign`, `eth_signTypedData_v4` and
  `wallet_sendCalls` (every other method passes through)
- viem bundler client (account abstraction): `sendUserOperation`, `prepareUserOperation`. `calls` are checked one by
  one as transactions from the smart account's address; a ready `callData` is sent as a user operation with the
  account's EntryPoint
- ethers v6 Signer: `sendTransaction`, `signTransaction`, `signTypedData`, `signMessage`, `authorize`

A batch is checked call by call, in order; the first call blocked stops the whole batch.

An EIP-7702 authorization sets the wallet's code to another contract, which can then move everything it holds: a
transaction with an `authorizationList` on any method above, viem's `signAuthorization`, ethers' `authorize`, a user
operation's `authorization`. By default (`onAuthorization: "check"`) Toll reads it and decides; if Toll cannot read it
(unreachable, another chain) it is blocked (TollBlockedError, code `eip7702-authorization`). `"block"` refuses every
authorization without asking; `"allow"` lets it through unchecked. The account's own sign methods
(`client.account.sign*`) are not wrapped.

```ts
const wallet = guard(walletClient, { origin: "https://app.example" }); // origin: the site asking, for sign-ins
await wallet.signMessage({ message: "Sign in to app.example" });     // checked as personal_sign
await wallet.request({ method: "personal_sign", params: [hexMessage, address] });
await wallet.request({ method: "eth_sign", params: [address, hash] }); // blocked when Toll blocks it, or cannot answer

const smart = guard(bundlerClient);                                    // detected by sendUserOperation
await smart.sendUserOperation({ calls: [{ to: token, abi: erc20Abi, functionName: "transfer", args: [to, amount] }] });
```

Everything else passes through unchanged. Wrap last: `client.extend(...)` or `signer.connect(...)` on the wrapped
wallet returns an unguarded one. viem and ethers are optional peer dependencies, never imported at load time.

### `guardX402Fetch(fetch, opts?)`

Wraps the fetch your x402 client uses. When a 402 arrives, its payment requirement goes to Toll before the client
pays; on BLOCK the 402 never reaches the payer (TollBlockedError is thrown). The paid retry (a request with a
`PAYMENT-SIGNATURE` or `X-PAYMENT` header) and every non-402 answer pass through.

A 402 can carry its requirement in the `PAYMENT-REQUIRED` header and in the JSON body, and a client pays from the one
it reads (`x402-fetch` v1 reads the body). The guard reads both: when they ask for different payments (payee, amount,
asset or scheme), it blocks without asking Toll (code `x402-forms-differ`).

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const pay = wrapFetchWithPayment(guardX402Fetch(fetch, { agentId: 123 }), account);
```

`agentId` (the seller's ERC-8004 id, or a function of the URL) is optional.

### `checkTx(input, opts?)`

The raw call. `input`: `{ chainId, from, to, data, value, authorizationList? }` for a transaction,
`{ chainId, from, authorizationList }` for an authorization alone, `{ typedData }` for an EIP-712 request,
`{ message: { kind: "personal_sign" | "eth_sign", data, from? } }` for a message, `{ rpc: { method, params } }` for a
wallet request (`personal_sign`, `eth_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`), `{ userOp, entryPoint? }`
for an ERC-4337 user operation, `{ x402, agentId?, payment? }` for an x402 payment, or several together; `origin` is
the site asking. Returns the RiskAssessment. When a
coin is still being read, Toll answers WARN `coin-not-read` with `Retry-After`: `checkTx` asks once more if the wait
is at most `maxRetryWaitMs` (default 10 s); a coin still not read stays WARN, never ALLOW. Throws
`TollUnavailableError` when Toll cannot answer.

### Options

| Option | Default | |
| --- | --- | --- |
| `strict` | `false` | preset: the defaults of `onWarn`, `onUnavailable` and `onUnsupported` become `"block"`; each one passed explicitly still wins |
| `onWarn` | `"block-high"` | `"block-high"` (blocked when any warning is `high` or `critical`, else allowed and logged), `"allow"` (every WARN goes ahead, logged; the 0.1.x default), `"block"`, or `(assessment) => boolean` (true lets it through) |
| `onBlock` | `"throw"` | `"throw"` (TollBlockedError), or `(assessment) => boolean`, e.g. ask a human; true lets it through |
| `onUnavailable` | `"block"` (since 0.5.1) | Toll unreachable, timed out, 5xx, 429, any other non-2xx (400, 413) or an answer that is not a RiskAssessment: `"block"` (fail-closed, TollUnavailableError) or `"allow"` (fail-open, logged). Passed explicitly it wins over `failOpen` and `strict` |
| `failOpen` | `false` | 0.5.1: `true` = the old default: when Toll cannot or will not answer, the request goes ahead unchecked (logged). `strict` and an explicit `onUnavailable` win over it |
| `onUnsupported` | `"allow"` (`strict`: `"block"`) | a transaction on another chain, a deployment: `"allow"` or `"block"`. A signature for another chain is blocked unless this is `"allow"` explicitly |
| `onAuthorization` | `"check"` | an EIP-7702 authorization: `"check"` (Toll decides; blocked when Toll cannot read it), `"block"` (TollBlockedError, Toll not asked) or `"allow"` (unchecked, logged) |
| `origin` | none | the site asking for a signature, sent with messages and typed data |
| `onReport` | none | `(report) => void`: every decision, with `assessment`, `decision`, `basis`, `paidUrl` |
| `logger` | `console.warn` | where WARN and unavailable lines go; `false` = silent |
| `timeoutMs` | `15000` | one request to Toll |
| `retry`, `maxRetryWaitMs` | `true`, `10000` | the one retry after Retry-After |
| `baseUrl`, `fetch` | `https://t0ll.xyz`, global fetch | |
| `spend` | none | 0.4.0: caps, allowlists, approval ([below](#040-spend-caps-allowlists-approval-preview)); unset = 0.3.x behaviour |
| `store` | in-process `MemorySpendStore` | where spend counters and paid x402 ids live |
| `failClosed` | `false` | with `spend`: a request whose spend cannot be read is blocked |
| `ticket` | none | 0.4.1: `true` or `{consumer?, scope?}`: ask Toll for a single-use ALLOW ticket for this exact call; it comes back as `report.ticket` ([below](#allow-tickets)) |

Errors: `TollBlockedError` (`.assessment`, `.codes`, message lists each code and message) and
`TollUnavailableError` (`.reason`, `.status`, `.paidUrl`).

## 0.4.0: spend caps, allowlists, approval, preview

Toll's verdict says whether a request looks safe. `spend` adds your own limits on top: how much the agent may spend
per call and per UTC day, who it may pay, and when a human has to say yes. Without `spend` nothing changes: 0.4.0
behaves exactly like 0.3.x.

The order for every request:

1. **Allowlists** (`allow.to`, `allow.spender`, `allow.payTo`): read from the request itself, before Toll is asked.
   Off the list = blocked, and Toll is not called.
2. **Toll's verdict**: ALLOW / WARN / BLOCK with your `onWarn`, `onBlock`, `onUnavailable` as before. A WARN that
   `block-high` blocks is still blocked, however small the amount.
3. **Caps** (`assets`, `perEndpoint`): per call, then per day. The day amount is reserved.
4. **Approval** (`approveAbove` + `approve`): above the threshold your `approve` function decides.
5. **After the send**: the reservation is committed. If the send throws (rejected, nonce too low, RPC down), it is
   released, so failures never use up the day cap.

Caps never relax Toll's verdict, and Toll's ALLOW never lifts a cap: a request must pass both.

```ts
import { guard, NATIVE, USDG, TollPolicyError } from "@tollxyz/guard";

const wallet = guard(walletClient, {
  spend: {
    // base units: ETH in wei, USDG with 6 decimals
    assets: {
      [NATIVE]: { perCall: 10n ** 16n, perDay: 5n * 10n ** 16n }, // 0.01 ETH a call, 0.05 ETH a day
      [USDG]: { perCall: 20_000_000n, perDay: 100_000_000n },    // 20 USDG a call, 100 USDG a day
    },
    allow: { spender: ["0xYourRouter..."] },                     // approvals only to your router
    approveAbove: { [USDG]: 10_000_000n },                       // above 10 USDG a human decides
    approve: async (req) => {
      const ok = await askOnTelegram(`Spend ${req.over[0].amount} of ${req.over[0].asset}?`);
      return { approved: ok, approvalRef: ok ? "tg-msg-1234" : undefined };
    },
  },
  failClosed: true, // a contract call whose spend cannot be read is blocked
});

try {
  await wallet.sendTransaction(tx);
} catch (e) {
  if (e instanceof TollPolicyError) console.log(e.code, e.amount, e.limit); // "cap-per-day", ...
  else throw e;
}
```

**What counts as spend.** Only what leaves the wallet in a spend asset. The defaults are native ETH, WETH and USDG on
Robinhood Chain, plus every asset you name in `assets` or `approveAbove`. A sell of any other coin is never capped.

- Read locally, with no Toll answer needed: the transaction's value, ERC-20 `transfer` / `transferFrom` / `approve` /
  `increaseAllowance` on a spend asset, EIP-2612 permits, Permit2 permits, EIP-3009 transfer authorizations, and an
  x402 402's amount. So caps hold even when Toll is unreachable.
- Any other contract call (a swap, a router): the amount comes from Toll's simulation (`x-toll.simulation.deltas`).
  When the simulation shows more leaving than the call declares, the larger amount counts.
- An approval counts against the per-call cap at its full size (an unlimited approval is over any cap) and must fit
  in what is left of the day cap; it is not added to the day total (the later swap is).
- Unknown spend: a contract call with no simulation (Toll unreachable), a raw user operation, a bare EIP-7702
  authorization. `onUnknownSpend` decides: `"allow"` by default, `"block"` under `failClosed: true`.

| `spend` field | |
| --- | --- |
| `assets` | `{ [asset]: { perCall?, perDay? } }`, asset = `"native"` or a token address, amounts in base units |
| `perEndpoint` | x402 caps per URL prefix (origin + path), e.g. `{ "https://api.example.com/v1/": { perDay: 1_000_000n } }` |
| `allow` | `{ to?, spender?, payTo? }`: every recipient (or called contract), approval spender, x402 payee must be listed |
| `approveAbove` | `{ [asset]: amount }`: above it, `approve` must say yes |
| `approve` | `(req) => Promise<{ approved, approvalRef? }>`; no function = denied. `approvalRef` lands in `report.spend.approvalRef` |
| `onUnknownSpend` | `"allow"` (default) or `"block"` (default under `failClosed`) |

New options next to `spend`: `store` (where counters live, below) and `failClosed`.

`TollPolicyError` extends `TollBlockedError` (existing `catch` blocks still see a block). `.code` is one of
`not-allowlisted`, `cap-per-call`, `cap-per-day`, `cap-endpoint`, `approval-denied`, `duplicate-payment`,
`unknown-spend`; `.asset`, `.amount`, `.limit` when they apply. The report has `basis: "policy"` and `policy: code`.

### Preview, then confirm

```ts
import { preview } from "@tollxyz/guard";

const p = await preview({ chainId: 4663, from, to, data, value }, opts); // same opts as the guard
// p.decision "allowed" | "blocked", p.basis, p.policy, p.spend, p.needsApproval, p.reason
if (p.decision === "allowed") await wallet.sendTransaction({ to, data, value, tollConfirm: p.confirmId });
```

`preview` asks Toll and checks every rule, but reserves nothing, calls no `approve` and no `onReport`. Passing its
`confirmId` as `tollConfirm` within 30 seconds reuses that Toll answer (one Toll call instead of two). It is used
once, and only for the identical request; anything else is checked again. The guard strips `tollConfirm` before the
wallet sees the request (viem `sendTransaction` / `signTransaction` / `writeContract`, ethers `sendTransaction` /
`signTransaction`).

### x402: payment ids and per-endpoint caps

With `spend` set, `guardX402Fetch` also:

- counts a 402's amount against `assets` and `perEndpoint` caps when it is checked. The reservation waits for the
  paid retry: committed when the seller answers, released on another 402 or an error, released after `holdMs`
  (default 2 minutes) when no paid retry comes.
- never pays the same x402 `payment-identifier` twice. An id is marked paid only when the seller accepts the paid
  request (any answer but 402); sending that id again throws `TollPolicyError` `duplicate-payment` (ids are kept
  `paymentIdTtlS`, default 1 day). A second send of an id that is still in flight is refused too. After a network
  error or timeout the same id may be retried (the seller dedupes it): the retry reuses the reservation of its 402,
  so nothing is counted twice. A different id is a new payment.

### Where the counters live

The default store is a `MemorySpendStore` in this process, one per `spend` object. **It resets when the process
restarts and is not shared between processes**: two workers each get the full day cap. For a cap that survives
restarts or spans workers, pass your own `store` implementing `SpendStore`:

```ts
interface SpendStore {
  reserve(k: string, amt: bigint, limit: bigint, windowStart: number): Promise<{ ok: boolean; id: string; used: bigint }>;
  commit(id: string): Promise<void>;
  release(id: string): Promise<void>;
  paymentSeen(id: string): Promise<boolean>;
  markPaid(id: string, ttlS: number): Promise<void>;
}
```

A Redis store (example only, not shipped; `reserve` must be atomic, hence the Lua script):

```ts
import Redis from "ioredis";
import type { SpendStore } from "@tollxyz/guard";

const redis = new Redis(process.env.REDIS_URL!);
const RESERVE = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local amt, limit = tonumber(ARGV[1]), tonumber(ARGV[2])
if used + amt > limit then return {0, tostring(used)} end
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], 172800)
redis.call('SET', KEYS[2], KEYS[1] .. '|' .. ARGV[1], 'EX', 3600)
return {1, tostring(used + amt)}`;
const RELEASE = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
local sep = string.find(v, '|', 1, true)
redis.call('DECRBY', string.sub(v, 1, sep - 1), string.sub(v, sep + 1))
redis.call('DEL', KEYS[1])
return 1`;

export const redisStore: SpendStore = {
  async reserve(k, amt, limit, windowStart) {
    const id = `toll:res:${crypto.randomUUID()}`;
    // amounts as numbers in Lua: fine below 2^53 base units; use string math for larger caps
    const [ok, used] = (await redis.eval(RESERVE, 2, `toll:cap:${k}:${windowStart}`, id, amt.toString(), limit.toString())) as [number, string];
    return { ok: ok === 1, id: ok === 1 ? id : "", used: BigInt(used) };
  },
  async commit(id) { await redis.del(id); },          // the amount stays in the day counter
  async release(id) { await redis.eval(RELEASE, 1, id); },
  async paymentSeen(id) { return (await redis.exists(`toll:paid:${id}`)) === 1; },
  async markPaid(id, ttlS) { await redis.set(`toll:paid:${id}`, "1", "EX", ttlS); },
};

const wallet = guard(walletClient, { spend: { /* ... */ }, store: redisStore });
```

## 0.5.0: mirror the caps into the facilitator budget (coming)

guard's caps live in the agent's process. Toll's x402 facilitator (https://x402.t0ll.xyz) is adding per-payer budgets: the
payer wallet signs its limits once and the facilitator refuses any payment past them where it settles, so a second
process, a key used elsewhere or a bug in the agent cannot spend past them through it. Budgets are **coming**: the
facilitator answers `404 budgets_off` until they are switched on. `guardBudget` builds that budget from your `spend`
policy; guard itself behaves exactly as before.

```ts
import { guardBudget, USDG } from "@tollxyz/guard";
import { Toll } from "@tollxyz/sdk"; // 0.7.0 or later

const spend = {
  assets: { [USDG]: { perCall: 100_000n, perDay: 1_000_000n } },           // 0.10 / 1.00 USDG
  perEndpoint: { "https://api.example/quotes": { perDay: 250_000n } },
  allow: { payTo: ["0xSellerA...", "0xSellerB..."] },
};
const { budget, typedData, notMirrored } = guardBudget(spend, {
  payer: account.address,
  nonce: BigInt(Date.now()),                                               // newer wins
  endpointPayTo: { "https://api.example/quotes": "0xSellerA..." },        // the facilitator sees a payTo, not a URL
});
console.log(notMirrored); // guard rules the facilitator cannot hold (they stay enforced by guard)
await new Toll().setBudget({ budget, signature: await account.signTypedData(typedData) });
```

| guard | facilitator budget |
| --- | --- |
| `assets[USDG].perCall` | `perPayment` (required: pass `perPayment` if the policy has none; 0 refuses everything) |
| `assets[USDG].perDay` | `perDay` (required, same rule) |
| `perEndpoint[prefix].perDay` | `payToCaps` entry for that endpoint's payTo (`endpointPayTo`, or a key that is an address); two endpoints on one payTo take the stricter cap |
| `allow.payTo` | `allowedPayTos` |
| `perEndpoint[prefix].perCall`, other assets, `allow.to`, `allow.spender`, `approveAbove` | not mirrored, listed in `notMirrored` |

`perPayTo` (one day cap for every payTo) and `validUntil` (unix seconds) are options. Days are UTC on both sides. The
typed data is the facilitator's EIP-712 `Budget` (domain `Toll Facilitator Budget` / `1` / chain 4663, no
verifyingContract); `BUDGET_DOMAIN` and `BUDGET_TYPES` are exported. guard has no runtime dependencies: posting it is
`@tollxyz/sdk`'s `setBudget` (or `POST https://x402.t0ll.xyz/budget` with `{ budget, signature }`, amounts as decimal
strings).

## ALLOW tickets

A contract can require a Toll ALLOW ticket before a sensitive call (a router, a module, a Uniswap v4 hook, a
delegation caveat). The Solidity side is [toll-allow](https://github.com/t0ll-xyz/toll-allow); the full guide is
https://t0ll.xyz/agents/allow.

- A ticket is an EIP-712 verdict signed by Toll for **one exact call** (target, value, data), one account (`from`),
  an optional consumer contract and a 60 second window. It is single use.
- A BLOCK is never signed. A WARN is signed only when no warning is high or critical (as verdict 1). No ticket
  without `from`, or for a transaction with an EIP-7702 authorization list. When none is issued, `report.ticket` is
  `{ why }`.
- Toll's production signer on Robinhood Chain (4663) is `0x4A2C93066d94F1E69f3EAd5438c4efDdf80a46ba`
  (`TOLL_ALLOW_SIGNER`). Pin it in your contract, or a `TollSignerSet` you control that includes it.

```ts
import { enforce, appendTicketSuffix } from "@tollxyz/guard";

// 1. check the inner call (what the router will call), bound to your router as the consumer
const r = await enforce("transaction", () => ({ chainId: 4663, from: me, to: target, data, value }), {
  ticket: { consumer: ROUTER },
});
if (!r.ticket || !("signature" in r.ticket)) throw new Error(r.ticket?.why ?? "no ticket");

// 2. put the ticket on the calldata: data ‖ abi.encode(ticket, signature) ‖ uint32 len ‖ 0x900bc3e1
const withTicket = appendTicketSuffix(data, r.ticket.ticket, r.ticket.signature);
// 3. call the router within 60 s: router.exec(target, withTicket) with the same value, from the same account
```

`appendTicketSuffix` is byte for byte `TollAllow.encodeSuffix` (tested against toll-allow's vectors). For a v4 hook,
ask with `scope: "v4swap"` and pass `abi.encode(ticket, signature)` as `hookData`. The same option works on
`checkTx(input, { ticket })`, where the ticket is in `assessment["x-toll"].ticket`.

A ticket is necessary, never sufficient: the contract keeps its own checks (slippage, limits, access control), and
should keep an owner bypass behind a timelock in case Toll is unreachable.

## Fail-open or fail-closed

The default is fail-closed since 0.5.1: if Toll cannot or will not answer, nothing is signed. The guard throws
`TollUnavailableError` (its `reason` says why: `network`, `timeout`, `rate-limited`, `server-error`, `bad-request`,
`bad-answer`) and calls `onReport` with `decision: "blocked"`, `basis: "unavailable"`. The reason for the default: a
refusal can be caused on purpose. A request padded past Toll's size limit answers HTTP 413, and a guard that let
"not checked" through would sign it.

The free route is rate limited per IP (a busy agent will see 429s): catch `TollUnavailableError`, wait and ask again,
or use the paid route the error names in `paidUrl`. If a stalled agent is worse for you than an unchecked signature,
pass `failOpen: true`: the request then goes ahead with a `[toll-guard] ... NOT checked` line and an `onReport` call
with `decision: "allowed"`, `basis: "unavailable"`. `strict: true` also blocks every WARN and unsupported request.

Two requests fail closed whatever `onUnavailable` and `failOpen` say: `eth_sign` (it signs any 32 bytes, a transaction hash
included, so an unchecked one could be anything) and an EIP-7702 authorization under `onAuthorization: "check"`.

## Free limit and the paid route

The check is free, rate limited per IP. The coin a swap buys is read through the same free coins as Toll's coin
check (10 new coins a day per caller, coins already read stay free); past that the coin is not read and the answer
is WARN `coin-over-quota` naming the paid route, `https://t0ll.xyz/api/x402/tx` (0.005 USDG over x402, no daily
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
