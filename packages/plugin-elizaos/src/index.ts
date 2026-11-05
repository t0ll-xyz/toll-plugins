/**
 * @tollxyz/plugin-elizaos - Toll's checks on Robinhood Chain for elizaOS agents.
 * Information only, not financial advice.
 */
import type { Action, HandlerCallback, IAgentRuntime, Memory, Plugin, Provider, State } from "@elizaos/core";
import { RH_ONLY, STOCK_EVENT_KINDS, Toll, TollError, type StockEventKind, type TollResult } from "@tollxyz/sdk";
import { extractAddress, extractAgentId, extractJson, extractStockId, extractWallet, formatResult } from "./format.js";
import { LIVE_DESCRIPTIONS } from "./live.js";
import {
  MACRO_NOTE,
  MARKETS_NOTE,
  fundamentals,
  guidance,
  insiderTrades,
  institutions,
  macro,
  stockToken,
  stockTokens,
  withTollKey,
  type FetchLike,
  type FundamentalsPeriod,
  type MarketsOptions,
} from "./markets.js";

export { extractAddress, extractAgentId, extractJson, extractStockId, extractWallet, formatResult } from "./format.js";
export { LIVE_DESCRIPTIONS } from "./live.js";
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
  institutions,
  guidance,
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
/** Words that ask for 13F institutional holders. */
const INSTITUTION_WORDS = /\b(13f|institutions?|institutional|fund holders|who owns)\b/i;
/** Words that ask for earnings-release guidance and KPIs. */
const GUIDANCE_WORDS = /\b(guidance|outlook|forecast|kpis?|non-?gaap|earnings release)\b/i;
/** Words that ask for the Stock Token event feed. */
const EVENT_WORDS = /\b(stock (?:token )?events?|events? feed|listings?|delist(?:ed|ings?)?|multiplier|corporate actions?|feed (?:stale|paused|resumed)|new filings?)\b/i;
/** Words that ask what a wallet gives away. */
const PRIVACY_WORDS = /\b(privacy|private|exposed?|exposure|dox(?:x)?(?:ed)?|what can (?:anyone|people|someone) (?:see|learn))\b/i;
/** Words that ask for the call Toll froze at launch. */
const LAUNCH_RECORD_WORDS = /\b(launch record|call at launch|at launch|frozen call|launch call)\b/i;
/** Words that ask for the newest coins. */
const FRESH_WORDS = /\b(new(?:est)? (?:coins|launches|tokens)|fresh launches|latest (?:coins|launches)|just launched)\b/i;
/** Words that ask how busy the chain is. */
const PULSE_WORDS = /\b(chain pulse|pulse|how busy|activity on (?:the )?chain|launches (?:today|right now))\b/i;
/** Words that name a Uniswap v4 hook (check_hook, 11-05). */
const HOOK_WORDS = /\bhooks?\b/i;

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
            spec.missing ?? `No Robinhood Chain address in the message for ${spec.name}: send the full 0x address (40 hex characters). ${RH_ONLY}`,
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
        "Before buying a token on Robinhood Chain, check who is behind it: snipers, bundles, the dev's record, whether liquidity can be pulled. Needs the token's 0x contract address in the message. Robinhood Chain (4663) only. Information only, not advice.",
      canRun: (t) => extractAddress(t) !== null,
      run: ({ client: c }, t) => c.checkCoin(extractAddress(t)!.address),
      example: [`check this coin before I buy ${CA}`, "Here is what Toll read from the chain for that token."],
    }),
    makeAction(resolve, {
      name: "TOLL_LARP_CHECK",
      similes: ["LARP_CHECK", "IS_THERE_A_PRODUCT", "PRODUCT_CHECK"],
      description:
        "Is there a real product behind this coin on Robinhood Chain? Reads its site, posts and code, checks each claim against the chain and its working parts (app, API, MCP server, code). Label: found, partly found, not found or not read. Needs the token's 0x contract address. Information only, not advice.",
      canRun: (t) => extractAddress(t) !== null,
      run: ({ client: c }, t) => c.larpCheck(extractAddress(t)!.address, { wait: true }),
      example: [`is there a real product behind ${CA}?`, "Here is Toll's LARP check for that coin."],
    }),
    makeAction(resolve, {
      name: "TOLL_DEV_RECORD",
      similes: ["DEV_RECORD", "DEV_HISTORY", "WALLET_LAUNCH_HISTORY"],
      description:
        "A launcher wallet's record on Robinhood Chain: how many coins it launched, how many graduated, and whether it sold. Needs a 0x wallet address in the message. Information only, not advice.",
      canRun: (t) => extractWallet(t) !== null,
      run: ({ client: c }, t) => c.devRecord(extractWallet(t)!.wallet),
      example: [`what has the dev ${DEV} launched before?`, "Here is that wallet's launch record from Toll."],
    }),
    makeAction(resolve, {
      name: "TOLL_WALLET_PRIVACY",
      similes: ["WALLET_PRIVACY", "PRIVACY_CHECK", "WHAT_CAN_ANYONE_SEE"],
      description: `${LIVE_DESCRIPTIONS.wallet_privacy} Needs a word like privacy or exposed and a 0x wallet in the message.`,
      canRun: (t) => PRIVACY_WORDS.test(t) && extractWallet(t) !== null,
      run: ({ client: c }, t) => c.walletPrivacy(extractWallet(t)!.wallet),
      example: [`how exposed is my wallet ${DEV}? what can anyone learn?`, "Here is Toll's privacy read of that wallet."],
      missing: "No wallet in the message for TOLL_WALLET_PRIVACY: send the 0x wallet (40 hex characters) with a word like privacy.",
    }),
    makeAction(resolve, {
      name: "TOLL_LAUNCH_RECORD",
      similes: ["LAUNCH_RECORD", "CALL_AT_LAUNCH"],
      description:
        "The call Toll froze a few minutes after a Robinhood Chain coin launched, and how it ended 24 hours later. It is not the coin now (TOLL_CHECK_COIN reads that). Needs the words launch record or at launch and the token's 0x address.",
      canRun: (t) => LAUNCH_RECORD_WORDS.test(t) && extractAddress(t) !== null,
      run: ({ client: c }, t) => c.launchRecord(extractAddress(t)!.address),
      example: [`what was Toll's call at launch for ${CA}?`, "Here is the call Toll froze at launch, and how it ended."],
      missing: "No token in the message for TOLL_LAUNCH_RECORD: send the token's 0x address with the words launch record.",
    }),
    makeAction(resolve, {
      name: "TOLL_FRESH_LAUNCHES",
      similes: ["FRESH_LAUNCHES", "NEW_COINS", "NEWEST_COINS"],
      description:
        "The newest coins launched on Robinhood Chain, with the first facts Toll reads about each. Runs when the message asks for new coins or fresh launches; \"top 5\" sets how many (1 to 20).",
      canRun: (t) => FRESH_WORDS.test(t),
      run: ({ client: c }, t) => {
        const n = /\b(?:top|first|last|latest|limit)\s+(\d{1,2})\b/i.exec(t)?.[1];
        return c.freshLaunches(n ? Math.min(20, Math.max(1, Number(n))) : undefined);
      },
      example: ["what are the newest coins on Robinhood Chain?", "Here are the newest launches Toll read."],
      missing: "TOLL_FRESH_LAUNCHES runs when the message asks for new coins or fresh launches.",
    }),
    makeAction(resolve, {
      name: "TOLL_CHAIN_PULSE",
      similes: ["CHAIN_PULSE", "HOW_BUSY_IS_THE_CHAIN"],
      description: "How busy Robinhood Chain is right now: launches, graduations and trades. Runs when the message asks how busy the chain is.",
      canRun: (t) => PULSE_WORDS.test(t),
      run: ({ client: c }) => c.chainPulse(),
      example: ["how busy is Robinhood Chain right now?", "Here is Toll's live count of launches, graduations and trades."],
      missing: "TOLL_CHAIN_PULSE runs when the message asks how busy the chain is.",
    }),
    makeAction(resolve, {
      name: "TOLL_CHECK_AGENT",
      similes: ["CHECK_AGENT", "ERC8004_AGENT", "AGENT_CHECK"],
      description: `${LIVE_DESCRIPTIONS.check_agent} Needs the agent id in the message (agent 20030 or agent #20030).`,
      canRun: (t) => extractAgentId(t) !== null,
      run: ({ client: c }, t) => c.checkAgent(extractAgentId(t)!),
      example: ["check agent #20030 before I pay it", "Here is what Toll's agent census read for agent #20030."],
      missing: "No agent id in the message for TOLL_CHECK_AGENT: write agent 20030 or agent #20030.",
    }),
    makeAction(resolve, {
      name: "TOLL_CHECK_HOOK",
      similes: ["CHECK_HOOK", "UNISWAP_HOOK", "HOOK_CHECK"],
      description: `${LIVE_DESCRIPTIONS.check_hook} Needs the word hook and the hook's 0x address in the message.`,
      canRun: (t) => HOOK_WORDS.test(t) && extractAddress(t) !== null,
      run: ({ client: c }, t) => c.checkHook(extractAddress(t)!.address),
      example: ["what does the hook 0x4eb1976978756bd56802d8162f2271844924e0cc do?", "Here is what Toll read of that Uniswap v4 hook."],
      missing: "TOLL_CHECK_HOOK runs when the message says hook and gives the hook's 0x address.",
    }),
    makeAction(resolve, {
      name: "TOLL_CHECK_TX",
      similes: ["CHECK_TX", "PRESIGN_CHECK", "CHECK_BEFORE_SIGNING"],
      description: `${LIVE_DESCRIPTIONS.check_tx} Needs the request as JSON in the message: {to, data, value, from}, {typedData: {...}} or {x402: {...}}.`,
      canRun: (t) => {
        const j = extractJson(t);
        return j !== null && j.version !== "erc-presign/1" && ("to" in j || "typedData" in j || "x402" in j || "accepts" in j);
      },
      run: ({ client: c }, t) => {
        const j = extractJson(t)!;
        // A pasted 402 body (with accepts) is the x402 payment itself.
        return c.checkTx(("accepts" in j && !("x402" in j) ? { x402: j } : j) as Parameters<Toll["checkTx"]>[0]);
      },
      example: [
        'check this before I sign: {"to":"0xff9e86e6b21fd688027981bee4b64c8b6b804ed3","data":"0x","value":"0","from":"0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc"}',
        "Toll's pre-sign check answered with its reasons.",
      ],
      missing: "No request in the message for TOLL_CHECK_TX: paste it as JSON ({to, data, value, from}, {typedData} or {x402}).",
    }),
    makeAction(resolve, {
      name: "TOLL_PRESIGN_RISK_REPORT",
      similes: ["PRESIGN_RISK_REPORT", "PRESIGN_REPORT"],
      description: `${LIVE_DESCRIPTIONS.presign_risk_report} Needs the PresignRequest as JSON in the message.`,
      canRun: (t) => extractJson(t)?.version === "erc-presign/1",
      run: ({ client: c }, t) => c.presignRiskReport(extractJson(t)! as unknown as Parameters<Toll["presignRiskReport"]>[0]),
      example: [
        'presign report for {"version":"erc-presign/1","subject":{"type":"calls","chainId":"eip155:4663","from":"eip155:4663:0x5388872A6bBb5Fd94533A4DaB2A7a1cAb02fa5Bc","calls":[{"to":"0xff9e86e6b21fd688027981bee4b64c8b6b804ed3","value":"0","data":"0x"}]}}',
        "Here is Toll's signed pre-sign report: facts, no verdict.",
      ],
      missing: 'No PresignRequest in the message for TOLL_PRESIGN_RISK_REPORT: paste it as JSON with "version": "erc-presign/1".',
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
      name: "TOLL_INSTITUTIONS",
      similes: ["INSTITUTIONS", "INSTITUTIONAL_HOLDERS", "13F"],
      description: `${LIVE_DESCRIPTIONS.institutions} Needs a word like 13F or institutions and a ticker (NVDA, $NVDA) or 0x contract in the message; "top 5" sets how many (1 to 20). Answers with Toll's JSON. ${MARKETS_NOTE}`,
      canRun: (t) => INSTITUTION_WORDS.test(t) && extractStockId(t) !== null,
      run: ({ markets }, t) => {
        const n = /\b(?:top|first|limit)\s+(\d{1,2})\b/i.exec(t)?.[1];
        const limit = n ? Math.min(20, Math.max(1, Number(n))) : undefined;
        return institutions({ id: extractStockId(t)!, ...(limit ? { limit } : {}) }, markets);
      },
      example: ["who are the top institutional holders of $NVDA?", "Here are NVIDIA's 13F holders for the latest quarter, as SEC published them."],
      missing: "No company in the message for TOLL_INSTITUTIONS: name the ticker (NVDA or $NVDA) or the Stock Token's 0x contract, with a word like 13F or institutions.",
    }),
    makeAction(resolve, {
      name: "TOLL_GUIDANCE",
      similes: ["GUIDANCE", "EARNINGS_GUIDANCE", "KPIS", "OUTLOOK"],
      description: `${LIVE_DESCRIPTIONS.guidance} Needs a word like guidance, outlook or KPIs and a ticker (NVDA, $NVDA) or 0x contract in the message. Answers with Toll's JSON. ${MARKETS_NOTE}`,
      canRun: (t) => GUIDANCE_WORDS.test(t) && extractStockId(t) !== null,
      run: ({ markets }, t) => guidance({ id: extractStockId(t)! }, markets),
      example: ["what guidance did NVDA give in its last earnings release?", "Here is what NVIDIA said in its last earnings releases, each value with its quote and filing."],
      missing: "No company in the message for TOLL_GUIDANCE: name the ticker (NVDA or $NVDA) or the Stock Token's 0x contract, with a word like guidance or KPIs.",
    }),
    makeAction(resolve, {
      name: "TOLL_STOCK_EVENTS",
      similes: ["STOCK_EVENTS", "STOCK_TOKEN_EVENTS", "STOCK_TOKEN_FEED"],
      description: `${LIVE_DESCRIPTIONS.stock_events} Runs when the message asks for Stock Token events, listings, multiplier changes, corporate actions or new filings; a kind named in the message (filing, listed, ...) filters. ${MARKETS_NOTE}`,
      canRun: (t) => EVENT_WORDS.test(t),
      run: ({ client: c }, t) => {
        const kind = STOCK_EVENT_KINDS.find((k) => new RegExp(`\\b${k}\\b`, "i").test(t)) as StockEventKind | undefined;
        return c.stockEvents(kind ? { kind } : {});
      },
      example: ["any new stock token events or listings?", "Here are the latest Stock Token events Toll found, oldest first."],
      missing: "TOLL_STOCK_EVENTS runs when the message asks for Stock Token events, listings or filings.",
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
        text: `A token address (${a.address}) is in the message. Toll can check who is behind it on Robinhood Chain (actions TOLL_CHECK_COIN, TOLL_LARP_CHECK). Information only, not advice.`,
        values: { tollAddress: a.address },
        data: { address: a.address },
      };
    },
  };
}

export function createTollPlugin(opts: TollPluginOptions = {}): Plugin {
  const { client, ...rest } = opts;
  return {
    name: "toll",
    description:
      "Toll's checks on Robinhood Chain (4663): who is behind a coin, the dev's record, whether there is a real product, a wallet's privacy, ERC-8004 agents, a pre-sign check before signing (ALLOW / WARN / BLOCK) and the signed pre-sign report; and Robinhood Stock Token facts, the companies' SEC fundamentals, insider trades, 13F holders and earnings guidance, the Stock Token event feed and US macro, with their sources. Information only, not advice.",
    actions: createTollActions(client, rest),
    providers: [createTollProvider()],
  };
}

export const tollPlugin: Plugin = createTollPlugin();
export default tollPlugin;
