/**
 * Input schemas for Toll's 19 tools, matching https://t0ll.xyz/mcp (tools/list, read 2026-11-04). Robinhood Chain only.
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
export const LarpCheckSchema = z.object({ token: address, chain });
export const DevRecordSchema = z.object({
  wallet: z.string().describe("The deployer (dev) wallet address: 0x followed by 40 hex characters."),
  chain,
});
export const WalletPrivacySchema = z.object({ wallet });
export const FreshLaunchesSchema = z.object({ limit: z.number().int().min(1).max(20).optional().describe("How many coins, 1 to 20 (default 10).") });
export const ChainPulseSchema = z.object({});
export const LaunchRecordSchema = z.object({ address });
export const CheckAgentSchema = z.object({
  id: z
    .union([z.number().int().min(0).max(1_000_000_000), z.string().regex(/^[0-9]{1,10}$/)])
    .describe("The agent id: its ERC-8004 token id in the Robinhood Chain identity registry (for example 20030)."),
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
  x402: object
    .optional()
    .describe("An x402 payment: the PaymentRequired the 402 sent (with accepts), or one accepts entry; optional payment (the signed payload) and resource (the URL)."),
  agentId: intOrString.optional().describe("The x402 seller's ERC-8004 agent id, when known."),
  registry: z
    .string()
    .max(80)
    .optional()
    .describe("The identity registry agentId is in, CAIP-10 (default eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, Robinhood Chain)."),
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

/** Every schema, keyed by Toll's tool name. */
export const SCHEMAS = {
  check_coin: CheckCoinSchema,
  larp_check: LarpCheckSchema,
  dev_record: DevRecordSchema,
  wallet_privacy: WalletPrivacySchema,
  fresh_launches: FreshLaunchesSchema,
  chain_pulse: ChainPulseSchema,
  launch_record: LaunchRecordSchema,
  check_agent: CheckAgentSchema,
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
};
