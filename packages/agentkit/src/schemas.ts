/**
 * Input schemas for Toll's 28 tools, matching https://t0ll.xyz/mcp (tools/list, read 2026-11-10). Robinhood Chain only.
 * The same file ships in every @tollxyz plugin package (only the zod import differs).
 */
import { z } from "zod";
import { STOCK_EVENT_KINDS } from "./live.js";

const address = z.string().describe("The token contract address on Robinhood Chain: 0x followed by 40 hex characters.");
const wallet = z.string().describe("The wallet address on Robinhood Chain: 0x followed by 40 hex characters.");
const chain = z.enum(["rh"]).optional().describe("rh = Robinhood Chain (4663), the only chain Toll reads. Leave it out.");
const stockId = z
  .string()
  .min(1)
  .max(60)
  .describe("A stock ticker as Robinhood lists it (NVDA, AAPL, BRK.B) or the Stock Token's contract on Robinhood Chain (0x + 40 hex).");
const intOrString = z.union([z.number().int().min(0), z.string().max(80)]);
const object = z.record(z.string(), z.unknown());

export const CheckCoinSchema = z.object({ address, chain });
export const PreBuyCheckSchema = z.object({ address: z.string().describe("The token contract address you are about to buy on Robinhood Chain: 0x followed by 40 hex characters.") });
export const CheckCoinsSchema = z.object({
  addresses: z.array(z.string()).min(1).max(20).describe("Token contract addresses on Robinhood Chain, 1 to 20 (0x followed by 40 hex characters each)."),
});
export const LarpCheckSchema = z.object({ token: address, chain });
export const DevRecordSchema = z.object({
  wallet: z.string().describe("The deployer (dev) wallet address: 0x followed by 40 hex characters."),
  chain,
});
export const WalletPrivacySchema = z.object({ wallet });
export const WalletApprovalsSchema = z.object({ wallet });
export const FreshLaunchesSchema = z.object({ limit: z.number().int().min(1).max(20).optional().describe("How many coins, 1 to 20 (default 10).") });
export const ChainPulseSchema = z.object({});
export const LaunchRecordSchema = z.object({ address });
export const CheckAgentSchema = z.object({
  id: z
    .union([z.number().int().min(0).max(1_000_000_000), z.string().regex(/^[0-9]{1,10}$/)])
    .describe("The agent id: its ERC-8004 token id in the Robinhood Chain identity registry (for example 20030)."),
});
export const FindPaidApiSchema = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe('What you want to buy, in a few words (for example "weather" or "stock quotes"); leave it out to list every operator\'s best endpoint.'),
  limit: z.number().int().min(1).max(20).optional().describe("How many rows, 1 to 20 (default 10)."),
});
export const CheckHookSchema = z.object({
  address: z.string().describe("The hook contract's address on Robinhood Chain: 0x followed by 40 hex characters."),
});
export const CheckTxSchema = z.object({
  chainId: intOrString.optional().describe("The chain id: 4663 (Robinhood Chain), the only one read; leave it out for 4663."),
  from: z.string().max(42).optional().describe("The signer's address (0x + 40 hex): a swap paying out to anyone else is flagged."),
  to: z.string().max(42).optional().describe("The transaction's to: the contract or wallet it is sent to (0x + 40 hex)."),
  data: z.string().max(40000).optional().describe("The calldata, hex (0x for a plain send)."),
  value: intOrString.optional().describe("Wei sent with it, decimal or 0x hex (default 0)."),
  typedData: object.optional().describe("An EIP-712 signature request: {domain, types, primaryType, message}."),
  // audit 2026-11-11 (PUB-2): the rest of what the live check_tx reads; without these keys the framework dropped them
  authorizationList: z
    .array(z.unknown())
    .max(64)
    .optional()
    .describe("A type-4 (EIP-7702) transaction's authorizationList, or a signAuthorization alone (no to, no data): [{chainId, address, nonce, yParity, r, s}]. A delegate Toll has verified by code hash is WARN; any other is BLOCK."),
  message: object
    .optional()
    .describe('A message to sign: {kind: "personal_sign" | "eth_sign", data (0x hex or text), origin?, from?}. Sign-In with Ethereum is read (domain against origin, expiry); eth_sign of a hash is BLOCK.'),
  origin: z.string().max(2048).optional().describe("The site or app asking for the signature (https://...), checked against a Sign-In with Ethereum domain."),
  rpc: object
    .optional()
    .describe("The wallet request as the agent would send it: {method, params}. personal_sign [data, address], eth_sign [address, data], eth_signTypedData_v4 [address, typed data JSON], eth_sendTransaction [tx]."),
  userOp: object.optional().describe("An ERC-4337 user operation (v0.6, v0.7 packed or unpacked, v0.8): sender, nonce, callData, gas fields, paymaster, signature. Its calls are opened and each checked."),
  entryPoint: z.string().max(42).optional().describe("The userOp's EntryPoint address (0x + 40 hex)."),
  intent: object.optional().describe("What the agent means to do ({action, recipient, ...}); an effect that does not match it is flagged."),
  x402: object
    .optional()
    .describe("An x402 payment: the PaymentRequired the 402 sent (with accepts), or one accepts entry; optional payment (the signed payload) and resource (the URL)."),
  agentId: intOrString.optional().describe("The x402 seller's ERC-8004 agent id, when known."),
  registry: z
    .string()
    .max(80)
    .optional()
    .describe("The identity registry agentId is in, CAIP-10 (default eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, Robinhood Chain)."),
  ticket: z
    .union([
      z.boolean(),
      z.object({
        consumer: z.string().max(42).optional().describe("The contract that will check the ticket (0x + 40 hex); leave it out for any contract."),
        scope: z.enum(["call", "v4swap"]).optional().describe('"call" (default): bound to this exact call; "v4swap": bound to the swap a HookrRouter call makes.'),
      }),
    ])
    .optional()
    .describe(
      "Optional: ask for a single-use ALLOW ticket a contract can require: true, or {consumer?, scope?}. It comes back in the answer's RiskAssessment (x-toll.ticket): signed, or why none was issued. A BLOCK is never signed; no ticket without from.",
    ),
  strict: z
    .boolean()
    .optional()
    .describe("Strict payee policy: an x402 payment whose payTo is not verified as the seller's (ERC-8478) is BLOCK instead of a warning; not read is BLOCK too."),
});
export const PresignRiskReportSchema = z.object({
  version: z.literal("erc-presign/1").describe('Always "erc-presign/1".'),
  subject: object.describe(
    '{type: "calls", chainId: "eip155:4663", from: "eip155:4663:0x<signer>", calls: [{to, value (wei, decimal string), data}], typedData?}',
  ),
  context: object
    .optional()
    .describe("Optional: {payment: {requirements (the x402 accepts entry chosen), resource?, payee?: {registry, agentId}}, texts: [{field, ref?, text}], tokens: [CAIP-10]}"),
  kinds: z.array(z.string().max(80)).max(40).optional().describe("Optional: only these finding kinds."),
});
export const StockTokenSchema = z.object({ id: stockId });
export const StockTokensSchema = z.object({
  query: z.string().max(60).optional().describe("Only tokens whose ticker or company contains this (NVDA, nvidia)."),
  limit: z.number().int().min(1).max(250).optional().describe("How many tokens, 1 to 250 (default 25)."),
});
export const FundamentalsSchema = z.object({
  id: stockId,
  period: z
    .enum(["ttm", "annual", "quarterly"])
    .optional()
    .describe("ttm (default): the last four quarters; annual: the last 4 fiscal years; quarterly: the last 8 quarters."),
});
export const InsiderTradesSchema = z.object({
  id: stockId,
  limit: z.number().int().min(1).max(100).optional().describe("How many trade rows to list, 1 to 100 (default 15)."),
});
export const InstitutionsSchema = z.object({
  id: stockId,
  limit: z.number().int().min(1).max(20).optional().describe("How many holders to list, 1 to 20 (default 10)."),
});
export const GuidanceSchema = z.object({
  id: stockId,
  limit: z.number().int().min(1).max(60).optional().describe("How many values to list per release, 1 to 60 (default 25)."),
});
export const MacroSchema = z.object({});
export const StockEventsSchema = z.object({
  since: z.number().int().min(0).optional().describe("The next of the last answer (an event id): only newer events. Leave out for the newest."),
  kind: z.enum(STOCK_EVENT_KINDS).optional().describe(`Only this kind: ${STOCK_EVENT_KINDS.join(", ")}.`),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("How many events, 1 to 100 (default 25; the keyless preview is always the last 10)."),
});
const webhook = z.string().max(300).describe("Your webhook: a public https URL on the default port.");
export const WatchCoinSchema = z.object({
  address: z.string().describe("The token contract address to watch on Robinhood Chain: 0x followed by 40 hex characters."),
  url: webhook,
});
export const MyWatchesSchema = z.object({});
export const UnwatchCoinSchema = z.object({ id: z.string().max(40).describe("The watch id (a uuid) from my_watches.") });
export const WatchWalletSchema = z.object({
  address: z.string().describe("The wallet address to watch on Robinhood Chain: 0x followed by 40 hex characters."),
  url: webhook,
});
export const UnwatchWalletSchema = z.object({ id: z.string().max(40).describe("The wallet watch id (a uuid) from my_watches.") });

/** Every schema, keyed by Toll's tool name. */
export const SCHEMAS = {
  check_coin: CheckCoinSchema,
  pre_buy_check: PreBuyCheckSchema,
  check_coins: CheckCoinsSchema,
  larp_check: LarpCheckSchema,
  dev_record: DevRecordSchema,
  wallet_privacy: WalletPrivacySchema,
  wallet_approvals: WalletApprovalsSchema,
  fresh_launches: FreshLaunchesSchema,
  chain_pulse: ChainPulseSchema,
  launch_record: LaunchRecordSchema,
  check_agent: CheckAgentSchema,
  find_paid_api: FindPaidApiSchema,
  check_hook: CheckHookSchema,
  check_tx: CheckTxSchema,
  presign_risk_report: PresignRiskReportSchema,
  stock_token: StockTokenSchema,
  stock_tokens: StockTokensSchema,
  fundamentals: FundamentalsSchema,
  insider_trades: InsiderTradesSchema,
  institutions: InstitutionsSchema,
  guidance: GuidanceSchema,
  macro: MacroSchema,
  stock_events: StockEventsSchema,
  watch_coin: WatchCoinSchema,
  my_watches: MyWatchesSchema,
  unwatch_coin: UnwatchCoinSchema,
  watch_wallet: WatchWalletSchema,
  unwatch_wallet: UnwatchWalletSchema,
};
