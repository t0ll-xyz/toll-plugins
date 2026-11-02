/**
 * @tollxyz/plugin-elizaos - Toll coin checks for elizaOS agents.
 * Information only, not financial advice.
 */
import type { Action, HandlerCallback, IAgentRuntime, Memory, Plugin, Provider, State } from "@elizaos/core";
import { Toll, TollError, type TollResult } from "@tollxyz/sdk";
import { extractAddress, extractStockId, extractWallet, formatResult } from "./format.js";
import {
  MACRO_NOTE,
  MARKETS_NOTE,
  fundamentals,
  insiderTrades,
  macro,
  stockToken,
  stockTokens,
  withTollKey,
  type FetchLike,
  type FundamentalsPeriod,
  type MarketsOptions,
} from "./markets.js";

export { extractAddress, extractStockId, extractWallet, formatResult } from "./format.js";
export {
  FACTS_NOTE,
  MACRO_NOTE,
  MARKETS_NOTE,
  LIMITS_NOTE,
  FUNDAMENTALS_PERIODS,
  paidStockUrl,
  paidMarketsUrl,
  stockToken,
  stockTokens,
  fundamentals,
  insiderTrades,
  macro,
  type FundamentalsPeriod,
  type MarketsOptions,
  type PaidMarketsKind,
} from "./markets.js";
export { Toll, TollError } from "@tollxyz/sdk";
export type { TollResult } from "@tollxyz/sdk";

export interface TollPluginOptions {
  /** A ready Toll client for the coin actions (for example with a custom fetch). Default: a client that sends the Toll key. */
  client?: Toll;
  /**
   * A Toll key (https://t0ll.xyz/toll#keys), sent as x-toll-pass on every t0ll.xyz call: carries the key wallet's daily tier.
   * Default: the agent's TOLL_KEY setting, when set.
   */
  tollKey?: string;
  /** fetch for t0ll.xyz calls. Default: global fetch. */
  fetch?: FetchLike;
}

/** What an action calls Toll with: the coin client and the Markets options, for this runtime's Toll key. */
interface TollContext {
  client: Toll;
  markets: MarketsOptions;
}

function settingOf(rt: IAgentRuntime | undefined, key: string): string | undefined {
  try {
    const v = (rt as { getSetting?: (k: string) => unknown } | undefined)?.getSetting?.(key);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

function contextResolver(client: Toll | undefined, opts: Omit<TollPluginOptions, "client">): (rt?: IAgentRuntime) => TollContext {
  const fetchFn: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const clients = new Map<string, Toll>();
  return (rt) => {
    const key = opts.tollKey ?? settingOf(rt, "TOLL_KEY");
    let c = client ?? clients.get(key ?? "");
    if (!c) {
      c = new Toll({ fetch: withTollKey(fetchFn, key) });
      clients.set(key ?? "", c);
    }
    return { client: c, markets: { fetch: fetchFn, tollKey: key } };
  };
}

/** Words that ask for a company's fundamentals. */
const FUNDAMENTALS_WORDS = /\b(fundamentals?|financials?|revenue|sales|earnings|eps|profits?|margins?|income statement|balance sheet|valuation|p\/?e|price[ -]to[ -]earnings)(?![A-Za-z])/i;
/** Words that ask for insider trades. */
const INSIDER_WORDS = /\b(insiders?|form\s*4)\b/i;
/** Words that ask for US macro. */
const MACRO_WORDS =
  /\b(macro|interest rates?|rates|inflation|cpi|yield curve|yields|treasur(?:y|ies)|fed funds|federal funds|effr|jobs|payrolls|nonfarm|unemployment)\b/i;

/** The period a fundamentals question names, if any. */
export function periodOf(text: string): FundamentalsPeriod | undefined {
  if (/\b(quarter(?:ly|s)?|10-?q)\b/i.test(text)) return "quarterly";
  if (/\b(annual(?:ly)?|yearly|fiscal years?|10-?k)\b/i.test(text)) return "annual";
  if (/\b(ttm|trailing)\b/i.test(text)) return "ttm";
  return undefined;
}

const textOf = (m: Memory): string => (typeof m?.content?.text === "string" ? m.content.text : "");

function makeAction(
  resolve: (rt?: IAgentRuntime) => TollContext,
  spec: {
    name: string;
    similes: string[];
    description: string;
    canRun: (text: string) => boolean;
    run: (ctx: TollContext, text: string) => Promise<TollResult | string>;
    example: [string, string];
    /** What to say when the message lacks what the action needs. */
    missing?: string;
  },
): Action {
  return {
    name: spec.name,
    similes: spec.similes,
    description: spec.description,
    validate: async (_rt: IAgentRuntime, message: Memory) => spec.canRun(textOf(message)),
    handler: async (rt: IAgentRuntime, message: Memory, _state?: State, _options?: unknown, callback?: HandlerCallback) => {
      try {
        // The runtime can pick an action without validate (for example "check 0x1234"): say what is missing.
        if (!spec.canRun(textOf(message))) {
          throw new TollError(
            spec.missing ?? `No valid address in the message for ${spec.name}: send the full 0x address (40 hex characters) or Solana mint.`,
          );
        }
        const out = await spec.run(resolve(rt), textOf(message));
        const text = typeof out === "string" ? out : formatResult(out);
        await callback?.({ text, actions: [spec.name], source: message.content?.source });
        return { success: true, text, data: { actionName: spec.name } };
      } catch (e) {
        const msg = e instanceof TollError ? e.message : "Toll could not be reached. Try again later.";
        await callback?.({ text: msg, actions: [spec.name], source: message.content?.source });
        return { success: false, text: msg, error: msg };
      }
    },
    examples: [
      [
        { name: "{{user1}}", content: { text: spec.example[0] } },
        { name: "{{agent}}", content: { text: spec.example[1], actions: [spec.name] } },
      ],
    ],
  };
}

/** The actions. Pass a client to use it for the coin actions; the Toll key comes from opts.tollKey or the TOLL_KEY setting. */
export function createTollActions(client?: Toll, opts: Omit<TollPluginOptions, "client"> = {}): Action[] {
  const resolve = contextResolver(client, opts);
  const CA = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3"; // the $TOLL token
  const DEV = "0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc"; // the wallet that launched $TOLL (a deployer, not a token)
  return [
    makeAction(resolve, {
      name: "TOLL_CHECK_COIN",
      similes: ["CHECK_COIN", "CHECK_TOKEN", "WHO_IS_BEHIND_COIN", "TOLL_CHECK"],
      description:
        "Before buying a token on Robinhood Chain, Solana or BSC, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Needs the token contract address in the message. Information only, not advice.",
      canRun: (t) => extractAddress(t) !== null,
      run: ({ client: c }, t) => {
        const a = extractAddress(t)!;
        return c.checkCoin(a.address, a.chain ? { chain: a.chain } : {});
      },
      example: [`check this coin before I buy ${CA}`, "Here is what Toll read from the chain for that token."],
    }),
    makeAction(resolve, {
      name: "TOLL_LARP_CHECK",
      similes: ["LARP_CHECK", "IS_THERE_A_PRODUCT", "PRODUCT_CHECK"],
      description:
        "Is there a real product behind this coin? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: found, partly found, not found or not read. Robinhood Chain and Solana. Information only, not advice.",
      canRun: (t) => extractAddress(t) !== null,
      run: async ({ client: c }, t) => {
        const a = extractAddress(t)!;
        if (a.chain === "bsc") {
          // Nothing is sent: the LARP check does not read BSC.
          return { text: "The LARP check covers Robinhood Chain and Solana, not BSC. TOLL_CHECK_COIN reads BSC coins.", paidUrl: null, pending: null };
        }
        const chain = a.chain === "sol" ? "sol" : a.chain === "rh" ? "rh" : undefined;
        return c.larpCheck(a.address, { wait: true, ...(chain ? { chain } : {}) });
      },
      example: [`is there a real product behind ${CA}?`, "Here is Toll's LARP check for that coin."],
    }),
    makeAction(resolve, {
      name: "TOLL_DEV_RECORD",
      similes: ["DEV_RECORD", "DEV_HISTORY", "WALLET_LAUNCH_HISTORY"],
      description:
        "A launcher wallet's record: how many coins it launched, how many graduated, and whether it sold. Needs a 0x wallet address in the message. Robinhood Chain (default) or BSC. Information only, not advice.",
      canRun: (t) => extractWallet(t) !== null,
      run: ({ client: c }, t) => {
        const w = extractWallet(t)!;
        return c.devRecord(w.wallet, w.chain ? { chain: w.chain } : {});
      },
      example: [`what has the dev ${DEV} launched before?`, "Here is that wallet's launch record from Toll."],
    }),
    makeAction(resolve, {
      name: "TOLL_STOCK_TOKEN",
      similes: ["STOCK_TOKEN", "STOCK_TOKEN_SNAPSHOT", "ROBINHOOD_STOCK_TOKEN"],
      description: `One Robinhood Stock Token on Robinhood Chain: Chainlink's reference price with the US session, the deepest pool's price and liquidity, supply, the multiplier, corporate actions and the company's SEC facts, each with its source and time. Needs the word stock and a ticker (NVDA, $NVDA) or the token's 0x contract in the message. Answers with Toll's JSON. ${MARKETS_NOTE}`,
      canRun: (t) => /\bstock/i.test(t) && extractStockId(t) !== null,
      run: ({ markets }, t) => stockToken(extractStockId(t)!, markets),
      example: ["what does the NVDA stock token read on Robinhood Chain?", "Here is Toll's snapshot of the NVDA Stock Token, every number with its source."],
      missing: "No Stock Token in the message for TOLL_STOCK_TOKEN: name the ticker (NVDA or $NVDA) or the token's 0x contract.",
    }),
    makeAction(resolve, {
      name: "TOLL_STOCK_TOKENS",
      similes: ["STOCK_TOKENS", "LIST_STOCK_TOKENS", "ROBINHOOD_STOCK_TOKENS"],
      description: `The Robinhood Stock Tokens on Robinhood Chain: ticker, name, contract, multiplier and Chainlink reference price. Runs when the message asks for stock tokens; a quoted word ("nvid") filters the list, "top 10" sets how many (default 20, up to 250). Answers with Toll's JSON. ${MARKETS_NOTE}`,
      canRun: (t) => /\bstock[ -]?tokens\b|\bstocks\b/i.test(t),
      run: ({ markets }, t) => {
        const q = /["\u201c]([^"\u201c\u201d]{1,60})["\u201d]/.exec(t)?.[1];
        const n = /\b(?:top|first|limit)\s+(\d{1,3})\b/i.exec(t)?.[1];
        const limit = n ? Math.min(250, Math.max(1, Number(n))) : 20;
        return stockTokens({ ...(q ? { query: q } : {}), limit }, markets);
      },
      example: ["list the Robinhood stock tokens", "Here are the Stock Tokens Toll reads on Robinhood Chain, with their sources."],
      missing: "TOLL_STOCK_TOKENS runs when the message asks for stock tokens.",
    }),
    makeAction(resolve, {
      name: "TOLL_FUNDAMENTALS",
      similes: ["FUNDAMENTALS", "COMPANY_FINANCIALS", "SEC_FINANCIALS", "EARNINGS"],
      description: `A company's fundamentals from its SEC filings, by the ticker or contract of its Robinhood Stock Token: revenue, margins, earnings, balance sheet, growth, shares outstanding and valuation, every figure with its filing and link. Needs a word like fundamentals, financials, revenue, earnings or P/E and a ticker (NVDA, $NVDA) or 0x contract in the message; "quarterly", "annual" or "ttm" picks the period. Answers with Toll's JSON. ${MARKETS_NOTE}`,
      canRun: (t) => FUNDAMENTALS_WORDS.test(t) && extractStockId(t) !== null,
      run: ({ markets }, t) => {
        const period = periodOf(t);
        return fundamentals({ id: extractStockId(t)!, ...(period ? { period } : {}) }, markets);
      },
      example: ["what are NVDA's fundamentals?", "Here are NVIDIA's figures from its SEC filings, each with its filing."],
      missing: "No company in the message for TOLL_FUNDAMENTALS: name the ticker (NVDA or $NVDA) or the Stock Token's 0x contract, with a word like fundamentals or revenue.",
    }),
    makeAction(resolve, {
      name: "TOLL_INSIDER_TRADES",
      similes: ["INSIDER_TRADES", "INSIDER_TRADING", "FORM_4", "INSIDERS"],
      description: `Insider trades from SEC Form 4 filings for the company behind a Robinhood Stock Token: who traded, their role, the transaction code, shares, price and shares owned after, each with its filing link, plus 90-day totals and 13D/13G holders. Needs the word insider or Form 4 and a ticker (NVDA, $NVDA) or 0x contract in the message; "last 10" sets how many rows (1 to 100). Answers with Toll's JSON. ${MARKETS_NOTE}`,
      canRun: (t) => INSIDER_WORDS.test(t) && extractStockId(t) !== null,
      run: ({ markets }, t) => {
        const n = /\b(?:top|first|last|latest|limit)\s+(\d{1,3})\b/i.exec(t)?.[1];
        const limit = n ? Math.min(100, Math.max(1, Number(n))) : undefined;
        return insiderTrades({ id: extractStockId(t)!, ...(limit ? { limit } : {}) }, markets);
      },
      example: ["any insider trades at $NVDA lately?", "Here are the Form 4 filings Toll read for NVIDIA, each with its link."],
      missing: "No company in the message for TOLL_INSIDER_TRADES: name the ticker (NVDA or $NVDA) or the Stock Token's 0x contract, with the word insider or Form 4.",
    }),
    makeAction(resolve, {
      name: "TOLL_MACRO",
      similes: ["MACRO", "US_MACRO", "INTEREST_RATES", "YIELD_CURVE", "INFLATION"],
      description: `US macro facts: the Treasury daily par yield curve (latest day and 30 days), the New York Fed's effective federal funds rate with its target range, and from BLS the CPI-U year on year, the unemployment rate and the monthly change in nonfarm payrolls, each with its date and source. Runs when the message asks about macro, rates, inflation, the yield curve or jobs. Answers with Toll's JSON. ${MACRO_NOTE}`,
      canRun: (t) => MACRO_WORDS.test(t),
      run: ({ markets }) => macro(markets),
      example: ["where are US rates and inflation right now?", "Here are the latest Treasury yields, the EFFR and BLS figures, each with its date and source."],
      missing: "TOLL_MACRO runs when the message asks about macro, rates, inflation, the yield curve or jobs.",
    }),
  ];
}

/** Adds Toll's note to the context only when the message holds a token address; otherwise nothing. */
export function createTollProvider(): Provider {
  return {
    name: "TOLL_COIN_HINT",
    description: "When a message contains a token address, tells the agent Toll can check who is behind it.",
    get: async (_rt: IAgentRuntime, message: Memory) => {
      const a = extractAddress(textOf(message));
      if (!a) return { text: "", values: {}, data: {} };
      return {
        text: `A token address (${a.address}) is in the message. Toll can check who is behind it (actions TOLL_CHECK_COIN, TOLL_LARP_CHECK). Information only, not advice.`,
        values: { tollAddress: a.address },
        data: { address: a.address, ...(a.chain ? { chain: a.chain } : {}) },
      };
    },
  };
}

export function createTollPlugin(opts: TollPluginOptions = {}): Plugin {
  const { client, ...rest } = opts;
  return {
    name: "toll",
    description:
      "Toll coin checks for Robinhood Chain, Solana and BSC: who is behind a coin, the dev's record, whether there is a real product; and Robinhood Stock Token facts, the companies' SEC fundamentals and insider trades, and US macro, with their sources. Information only, not advice.",
    actions: createTollActions(client, rest),
    providers: [createTollProvider()],
  };
}

export const tollPlugin: Plugin = createTollPlugin();
export default tollPlugin;
