/**
 * @tollxyz/x402-seller: sell over x402 on Robinhood Chain in one line.
 *
 * `paywall(options, handler)` wraps any Web-standard handler (Request -> Response: Next.js route handlers, Hono's
 * c.req.raw, Bun, Deno, Cloudflare Workers). It speaks x402 the way Toll's own paid checks do:
 *
 *   no payment   -> 402: the v1 PaymentRequired in the body, the v2 one (base64) in the PAYMENT-REQUIRED header
 *   a payment    -> PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1), matched to what was asked, then
 *                   verify -> your handler -> settle (only when your handler answered 2xx/3xx) ->
 *                   your answer with PAYMENT-RESPONSE / X-PAYMENT-RESPONSE (the settlement and Toll's signed receipt)
 *
 * The payment is verified and settled by Toll's facilitator (https://x402.t0ll.xyz): keyless, free, USDG on
 * Robinhood Chain. It checks payTo against your ERC-8004 identity (ERC-8478) when you name your agentId.
 */

export const TOLL_FACILITATOR = "https://x402.t0ll.xyz";

/** USDG on Robinhood Chain, and the EIP-712 domain a payer signs it under (EIP-3009) */
export const USDG = {
  network: "eip155:4663",
  networkV1: "robinhood",
  asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
  name: "Global Dollar",
  version: "1",
} as const;

/** the ERC-8004 identity registry on Robinhood Chain (CAIP-10) */
export const ERC8004_REGISTRY = "eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/**
 * toll-screen: Toll's facilitator reads every payment it verifies or settles with check_tx and puts its word in
 * extensions.screen. "not-read" means it was not read in time, never a refusal. For the seller only: it is not
 * forwarded to the buyer.
 */
export type Screen = { outcome: "allow" | "warn" | "block" | "not-read"; codes: string[] };

const SCREEN_OUTCOMES: readonly string[] = ["allow", "warn", "block", "not-read"];
/** extensions.screen of a facilitator answer, checked; undefined when absent or malformed (another facilitator) */
export function screenOf(answer: unknown): Screen | undefined {
  const ext = answer && typeof answer === "object" ? (answer as Record<string, unknown>).extensions : undefined;
  const s = ext && typeof ext === "object" ? (ext as Record<string, unknown>).screen as Record<string, unknown> | undefined : undefined;
  if (!s || typeof s !== "object" || typeof s.outcome !== "string" || !SCREEN_OUTCOMES.includes(s.outcome)) return undefined;
  return { outcome: s.outcome as Screen["outcome"], codes: Array.isArray(s.codes) ? s.codes.filter((c): c is string => typeof c === "string") : [] };
}

export type Settlement = {
  success: true;
  transaction: string;
  network: string;
  payer?: string;
  /** the facilitator's extensions: erc8478 (the payee check), receipt (Toll's signed EIP-712 receipt), screen */
  extensions?: Record<string, unknown>;
  /** the settle answer's extensions.screen (toll-screen), when the facilitator sent one */
  screen?: Screen;
  /** the offer-receipt spec's receipt you signed with signReceipt (also sent to the buyer), when one was signed */
  offerReceipt?: SignedReceipt;
};

/* ---------------------------------------------------------------- offer-receipt (x402 extension-offer-and-receipt.md) */

/** the spec's receipt payload (v1): what Toll's facilitator hands the seller in extensions["toll-offer-receipt"] */
export type ReceiptPayload = { version: number; network: string; resourceUrl: string; payer: string; issuedAt: number; transaction: string };
/** the spec's signed receipt, as the buyer gets it in extensions["offer-receipt"].info.receipt */
export type SignedReceipt = { format: "eip712"; payload: ReceiptPayload; signature: string };
/** the spec's EIP-712 receipt domain: chainId 1 by the spec, whatever the payment network */
export const RECEIPT_DOMAIN = { name: "x402 receipt", version: "1", chainId: 1 } as const;
/** the spec's canonical receipt types (v1) */
export const RECEIPT_TYPES = {
  Receipt: [
    { name: "version", type: "uint256" },
    { name: "network", type: "string" },
    { name: "resourceUrl", type: "string" },
    { name: "payer", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "transaction", type: "string" },
  ],
} as const;
/** what signReceipt gets: EIP-712 typed data ready for viem's account.signTypedData (uints as bigint) */
export type ReceiptTypedData = {
  domain: { name: string; version: string; chainId: number };
  types: typeof RECEIPT_TYPES;
  primaryType: "Receipt";
  message: { version: bigint; network: string; resourceUrl: string; payer: string; issuedAt: bigint; transaction: string };
};

/** the receipt payload as typed data, exactly as given (the spec forbids rebuilding it) */
export function receiptTypedData(p: ReceiptPayload): ReceiptTypedData {
  return {
    domain: { ...RECEIPT_DOMAIN },
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: { version: BigInt(p.version), network: p.network, resourceUrl: p.resourceUrl, payer: p.payer, issuedAt: BigInt(p.issuedAt), transaction: p.transaction },
  };
}

/**
 * extensions["toll-offer-receipt"].receiptPayload of a settle answer, only when it is this settlement's: version 1, this
 * network, this resource, the settled payer and transaction. Anything else is null: a seller never signs a receipt for a
 * payment it did not get.
 */
export function receiptPayloadOf(answer: unknown, want: { resource: string; payer?: string; transaction: string }): ReceiptPayload | null {
  const ext = isObj(answer) ? answer.extensions : null;
  const x = isObj(ext) ? ext["toll-offer-receipt"] : null;
  const p = isObj(x) ? x.receiptPayload : null;
  if (!isObj(p) || p.version !== 1 || p.network !== USDG.network || p.resourceUrl !== want.resource) return null;
  if (typeof p.payer !== "string" || !want.payer || p.payer.toLowerCase() !== want.payer.toLowerCase()) return null;
  if (typeof p.transaction !== "string" || (p.transaction !== "" && p.transaction.toLowerCase() !== want.transaction.toLowerCase())) return null;
  if (typeof p.issuedAt !== "number" || !Number.isSafeInteger(p.issuedAt) || p.issuedAt < 0) return null;
  return { version: 1, network: p.network, resourceUrl: p.resourceUrl, payer: p.payer, issuedAt: p.issuedAt, transaction: p.transaction };
}

/* ---------------------------------------------------------------- paid before (sign-in-with-x) */

/** GET /paid's answer: whether the payer already paid payTo through Toll's facilitator (facts public on chain) */
export type PaidAnswer = {
  paid: boolean;
  count: number;
  last: { tx: string | null; ts: number; amount: string; receiptId: string; via: "settlement" | "escrow" | "batch" } | null;
  network: string;
  sources: { settlements: number; escrow: number | "not-read" | "not-applicable"; batch: number | "not-read" | "not-applicable" };
};

/**
 * Whether `payer` already paid `payTo` through Toll's facilitator (GET /paid: settlements, escrow captures, batch
 * charges), optionally for one resource and after `since` (unix seconds or a Date). For sign-in-with-x: call it only
 * with a wallet the request PROVED it controls (a verified SIGN-IN-WITH-X header), never with an address it merely
 * names. Throws when the facilitator cannot answer: charge as usual then.
 */
export async function paidBefore(q: {
  payer: string;
  payTo: string;
  resource?: string;
  since?: number | Date;
  facilitator?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<PaidAnswer> {
  if (!ADDRESS.test(q.payer)) throw new Error(`payer must be a 0x address, got "${q.payer}"`);
  if (!ADDRESS.test(q.payTo)) throw new Error(`payTo must be a 0x address, got "${q.payTo}"`);
  const p = new URLSearchParams({ payer: q.payer.toLowerCase(), payTo: q.payTo.toLowerCase() });
  if (q.resource !== undefined) {
    if (q.resource.length > 2048 || !/^https?:\/\/[^\s"\\]+$/.test(q.resource)) throw new Error("resource must be an http(s) URL of at most 2048 characters");
    p.set("resource", q.resource);
  }
  if (q.since !== undefined) {
    const s = q.since instanceof Date ? Math.floor(q.since.getTime() / 1000) : q.since;
    if (!Number.isSafeInteger(s) || s < 0 || s > 9_999_999_999) throw new Error("since must be unix seconds or a Date");
    p.set("since", String(s));
  }
  const base = (q.facilitator ?? TOLL_FACILITATOR).replace(/\/+$/, "");
  const r = await (q.fetch ?? fetch)(`${base}/paid?${p.toString()}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(q.timeoutMs ?? 15_000) });
  let j: unknown = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !isObj(j) || typeof j.paid !== "boolean" || typeof j.count !== "number") throw new Error(`facilitator paid answered ${r.status}`);
  return j as PaidAnswer;
}

/** HTTP methods the x402 bazaar extension describes */
export type BazaarMethod = "GET" | "HEAD" | "DELETE" | "POST" | "PUT" | "PATCH";

/**
 * The x402 bazaar extension (specs/extensions/bazaar.md): describe the endpoint so facilitators list it in discovery
 * (Toll's: x402.t0ll.xyz/discovery/resources, the find_paid_api tool, t0ll.xyz/x402/discover). Toll's facilitator
 * records it from a payment that settles, after `info` validates against the `schema` built here.
 */
export type BazaarOptions = {
  /** what the endpoint sells, in the 402's resource.description (default: the description option) */
  description?: string;
  /** the method buyers call; default: the request's method (GET when it is not one of these) */
  method?: BazaarMethod;
  /** POST / PUT / PATCH: the body's type; default "json" */
  bodyType?: "json" | "form-data" | "text";
  /** an example input: the query parameters (GET, HEAD, DELETE) or the body (POST, PUT, PATCH) */
  input?: Record<string, unknown>;
  /** JSON Schema (2020-12, only "#..." $refs) of the query parameters or the body; the example must match it */
  inputSchema?: Record<string, unknown>;
  /** what the endpoint answers: its type (default "json"), an example, and a JSON Schema of the example */
  output?: { type?: string; example?: unknown; schema?: Record<string, unknown> };
  /** catalog metadata on resource (soft-dropped when invalid, as the spec says): a name of at most 32 printable ASCII */
  serviceName?: string;
  /** up to 5 tags, each at most 32 printable ASCII */
  tags?: string[];
  /** an absolute http(s) icon URL (no IP or localhost host) */
  iconUrl?: string;
};

export type SellerOptions = {
  /** the wallet paid; to pass the payee check it is the agentWallet your ERC-8004 identity registered */
  payTo: string;
  /** the price in USDG, as a decimal ("0.05") */
  price: string | number;
  /** your ERC-8004 agent id on Robinhood Chain: lets payers (and the facilitator) check who gets paid */
  agentId?: string | number;
  description?: string;
  mimeType?: string;
  /** seconds a signed payment stays valid; default 300 */
  maxTimeoutSeconds?: number;
  /** another facilitator URL; default Toll's */
  facilitator?: string;
  /** called once a payment has settled (log it, count it) */
  onSettled?: (s: Settlement, req: Request) => void | Promise<void>;
  /** test hook / custom transport */
  fetch?: typeof fetch;
  /** facilitator timeout per call, ms; default 15000 */
  timeoutMs?: number;
  /**
   * 0.3.1: how long /settle may take, ms; default 60000 (the facilitator waits for the transaction to be mined). The
   * handler has already answered when /settle runs, so giving up early is how a buyer pays and gets nothing.
   */
  settleTimeoutMs?: number;
  /** 0.3.1: the wait before /settle is asked a second time, ms; default 2000 */
  settleRetryMs?: number;
  /** test hook: the sleep between the two settle tries */
  sleep?: (ms: number) => Promise<void>;
  /**
   * your ERC-8021 app code (^[a-z0-9_]{1,32}$), sent as extensions["builder-code"].info.a: Toll's facilitator writes it
   * into the settlement's calldata suffix, so each sale is attributed to your app on chain
   */
  appCode?: string;
  /** describe the endpoint (x402 bazaar) so it is listed in discovery once a payment settles */
  bazaar?: BazaarOptions;
  /**
   * sign the x402 offer-receipt spec's receipt with your own key (viem: `(td) => account.signTypedData(td)`). The payment
   * sent to Toll's facilitator then carries extensions["offer-receipt"]; when the settle answer hands back this
   * settlement's receipt payload (extensions["toll-offer-receipt"].receiptPayload), it is signed and returned to the
   * buyer as extensions["offer-receipt"].info.receipt = { format: "eip712", payload, signature }. A signer that throws
   * only means no receipt: the buyer still gets the answer.
   */
  signReceipt?: (typedData: ReceiptTypedData) => Promise<string> | string;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BUILDER_CODE = /^[a-z0-9_]{1,32}$/;
const METHODS: readonly BazaarMethod[] = ["GET", "HEAD", "DELETE", "POST", "PUT", "PATCH"];
const BODY_METHODS: readonly string[] = ["POST", "PUT", "PATCH"];
const DRAFT_2020 = "https://json-schema.org/draft/2020-12/schema";
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_HEADER = 16_384;
const EXPOSE = { "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE" } as const;
const NO_STORE = { "cache-control": "no-store" } as const;

/** a decimal USDG price as atomic units (6 decimals): "0.05" -> "50000" */
export function usdg(price: string | number): string {
  const s = String(price).trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error(`price must be a positive decimal with at most 6 decimals, got "${s}"`);
  const atomic = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
  if (atomic <= 0n) throw new Error(`price must be above zero, got "${s}"`);
  return atomic.toString();
}

function extra(o: SellerOptions) {
  return {
    name: USDG.name,
    version: USDG.version,
    ...(o.agentId != null && String(o.agentId) !== "" ? { erc8004: { registry: ERC8004_REGISTRY, agentId: String(o.agentId) } } : {}),
  } as { name: string; version: string; erc8004?: { registry: string; agentId: string } };
}

/** x402 v2 PaymentRequirements for one price */
export function requirement(o: SellerOptions) {
  if (!ADDRESS.test(o.payTo)) throw new Error(`payTo must be a 0x address, got "${o.payTo}"`);
  return {
    scheme: "exact" as const,
    network: USDG.network,
    asset: USDG.asset,
    amount: usdg(o.price),
    payTo: o.payTo,
    maxTimeoutSeconds: o.maxTimeoutSeconds ?? 300,
    extra: extra(o),
  };
}

/** x402 v1 PaymentRequirements (the 402 body), for older clients and discovery lists */
export function requirementV1(o: SellerOptions, resource: string) {
  const r = requirement(o);
  return {
    scheme: r.scheme,
    network: USDG.networkV1,
    maxAmountRequired: r.amount,
    resource,
    description: o.description ?? "",
    mimeType: o.mimeType ?? "application/json",
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    asset: r.asset,
    extra: r.extra,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** a $ref / $id / $dynamicRef that is not a same-document "#..." fragment, anywhere in a schema */
function externalRef(schema: unknown): boolean {
  const stack: unknown[] = [schema];
  while (stack.length) {
    const n = stack.pop();
    if (Array.isArray(n)) { stack.push(...n); continue; }
    if (!isObj(n)) continue;
    for (const [k, v] of Object.entries(n)) {
      if ((k === "$ref" || k === "$id" || k === "$dynamicRef") && (typeof v !== "string" || !v.startsWith("#"))) return true;
      stack.push(v);
    }
  }
  return false;
}

/** the app code, checked; throws on a bad one (at startup, from paywall) */
export function validAppCode(code: unknown): string {
  if (typeof code !== "string" || !BUILDER_CODE.test(code)) throw new Error(`appCode must match ^[a-z0-9_]{1,32}$, got "${String(code)}"`);
  return code;
}

/** the bazaar options, checked; throws on a bad method, body type, schema or example (at startup, from paywall) */
export function checkBazaar(b: BazaarOptions): void {
  if (!isObj(b)) throw new Error("bazaar must be an object");
  if (b.method !== undefined && !METHODS.includes(b.method)) throw new Error(`bazaar.method must be one of ${METHODS.join(", ")}`);
  if (b.bodyType !== undefined && !["json", "form-data", "text"].includes(b.bodyType)) throw new Error('bazaar.bodyType must be "json", "form-data" or "text"');
  if (b.bodyType !== undefined && b.method !== undefined && !BODY_METHODS.includes(b.method)) throw new Error("bazaar.bodyType goes with POST, PUT or PATCH only");
  if (b.description !== undefined && typeof b.description !== "string") throw new Error("bazaar.description must be text");
  if (b.input !== undefined && !isObj(b.input)) throw new Error("bazaar.input must be an object (the example query parameters or body)");
  for (const [k, s] of [["inputSchema", b.inputSchema], ["output.schema", b.output?.schema]] as const) {
    if (s === undefined) continue;
    if (!isObj(s)) throw new Error(`bazaar.${k} must be a JSON Schema object`);
    if (externalRef(s)) throw new Error(`bazaar.${k} may only use "#..." $refs (facilitators never fetch a schema)`);
  }
  if (b.output !== undefined && (!isObj(b.output) || (b.output.type !== undefined && typeof b.output.type !== "string"))) throw new Error("bazaar.output must be { type?, example?, schema? }");
  const size = new TextEncoder().encode(JSON.stringify(bazaarExtension(b, b.method ?? "GET"))).length;
  if (size > MAX_SCHEMA_BYTES) throw new Error("bazaar is over 64 KB");
}

const PRINTABLE = /^[\x20-\x7e]+$/;
const serviceNameOf = (v: unknown) => (typeof v === "string" && v.length <= 32 && PRINTABLE.test(v) ? v : undefined);
function tagsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [], seen = new Set<string>();
  for (const t of v) {
    if (typeof t !== "string" || !t || t.length > 32 || !PRINTABLE.test(t) || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === 5) break;
  }
  return out;
}
/** bazaar.md's iconUrl rule: absolute http(s), at most 2048, no userinfo, no IP literal, localhost, all-digit or hex host */
export function validIconUrl(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > 2048 || /[\u0000-\u001f\u007f]/.test(v)) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return false;
  let host: string;
  try { host = decodeURIComponent(u.hostname).toLowerCase().replace(/\.$/, ""); } catch { return false; }
  if (!host || host.startsWith("[") || /^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return false;
  return !["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"].includes(host);
}

/** the resource's catalog metadata (serviceName, tags, iconUrl), invalid fields dropped */
function serviceMetadata(b: BazaarOptions | undefined) {
  if (!b) return {};
  const name = serviceNameOf(b.serviceName), tags = tagsOf(b.tags);
  return { ...(name ? { serviceName: name } : {}), ...(tags.length ? { tags } : {}), ...(validIconUrl(b.iconUrl) ? { iconUrl: b.iconUrl } : {}) };
}

/**
 * The bazaar extension ({ info, schema }) for one method: info describes the call, schema (JSON Schema 2020-12) is
 * the spec's template with your input / output schemas inside, so info always validates against it when your
 * examples match your schemas.
 */
export function bazaarExtension(b: BazaarOptions, requestMethod = "GET") {
  const method = (b.method ?? (METHODS.includes(requestMethod.toUpperCase() as BazaarMethod) ? requestMethod.toUpperCase() : "GET")) as BazaarMethod;
  const body = BODY_METHODS.includes(method);
  const headers = { type: "object", additionalProperties: { type: "string" } };
  const input = body
    ? { type: "http", method, bodyType: b.bodyType ?? "json", body: b.input ?? {} }
    : { type: "http", method, ...(b.input ? { queryParams: b.input } : {}) };
  const inputSchema = body
    ? {
      type: "object",
      properties: {
        type: { type: "string", const: "http" },
        method: { type: "string", enum: ["POST", "PUT", "PATCH"] },
        bodyType: { type: "string", enum: ["json", "form-data", "text"] },
        body: b.inputSchema ?? {},
        queryParams: { type: "object", additionalProperties: { type: "string" } },
        headers,
      },
      required: ["type", "method", "bodyType", "body"],
      additionalProperties: false,
    }
    : {
      type: "object",
      properties: {
        type: { type: "string", const: "http" },
        method: { type: "string", enum: ["GET", "HEAD", "DELETE"] },
        queryParams: b.inputSchema ?? { type: "object" },
        headers,
      },
      required: ["type", "method"],
      additionalProperties: false,
    };
  const out = b.output;
  return {
    info: {
      input,
      ...(out ? { output: { type: out.type ?? "json", ...(out.example !== undefined ? { example: out.example } : {}) } } : {}),
    },
    schema: {
      $schema: DRAFT_2020,
      type: "object",
      properties: {
        input: inputSchema,
        output: { type: "object", properties: { type: { type: "string" }, example: out?.schema ?? {} }, required: ["type"] },
      },
      required: ["input"],
    },
  };
}

/** the extensions a 402 declares: builder-code (appCode) and bazaar; empty when neither option is set */
export function declaredExtensions(o: SellerOptions, method = "GET"): Record<string, unknown> {
  return {
    ...(o.appCode !== undefined ? { "builder-code": { info: { a: validAppCode(o.appCode) } } } : {}),
    ...(o.bazaar ? { bazaar: bazaarExtension(o.bazaar, method) } : {}),
  };
}

/** x402 v2 PaymentRequired (what rides base64 in the PAYMENT-REQUIRED header) */
export function paymentRequired(o: SellerOptions, resource: string, error?: string, method = "GET") {
  const ext = declaredExtensions(o, method);
  return {
    x402Version: 2 as const,
    ...(error ? { error } : {}),
    resource: {
      url: resource,
      description: o.bazaar?.description ?? o.description ?? "",
      mimeType: o.mimeType ?? "application/json",
      ...serviceMetadata(o.bazaar),
    },
    accepts: [requirement(o)],
    ...(Object.keys(ext).length ? { extensions: ext } : {}),
  };
}

const b64 = (o: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const unb64 = (s: string): unknown => {
  const bin = atob(s.trim());
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
};

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...NO_STORE, ...headers } });

/** the 402 a request without (or with a refused) payment gets */
export function need402(o: SellerOptions, resource: string, error = "payment_required", method = "GET"): Response {
  return json({ x402Version: 1, error, accepts: [requirementV1(o, resource)] }, 402,
    { ...EXPOSE, "PAYMENT-REQUIRED": b64(paymentRequired(o, resource, error, method)) });
}

export type Payment = {
  version: 1 | 2;
  payload: Record<string, unknown>;
  requirements: Record<string, unknown>;
  /** the verify answer's extensions.screen (toll-screen), set before your handler runs; refuse on "block" if you like */
  screen?: Screen;
};

/**
 * The v2 payload sent to the facilitator, with what this seller declared: the bazaar extension and the resource (so
 * the endpoint is cataloged even when the buyer's client does not echo extensions), the builder-code app code
 * (the buyer's own service codes `s` kept) and, with signReceipt, extensions["offer-receipt"] (so the facilitator hands
 * back the receipt payload) and the resource. The payer's signature covers only the authorization, never these.
 * v1 payloads and sellers without appCode / bazaar / signReceipt go unchanged.
 */
export function withDeclared(pay: Payment, o: SellerOptions, resource: string, method = "GET"): Payment {
  if (pay.version !== 2 || (o.appCode === undefined && !o.bazaar && !o.signReceipt)) return pay;
  const p = pay.payload;
  const ext: Record<string, unknown> = isObj(p.extensions) ? { ...p.extensions } : {};
  if (o.appCode !== undefined) {
    const theirs = isObj(ext["builder-code"]) ? ext["builder-code"] as Record<string, unknown> : {};
    const s = (isObj(theirs.info) ? theirs.info : theirs).s;
    ext["builder-code"] = { a: validAppCode(o.appCode), ...(typeof s === "string" || Array.isArray(s) ? { s } : {}) };
  }
  let res = p.resource;
  if (o.bazaar) ext.bazaar = bazaarExtension(o.bazaar, method);
  if (o.signReceipt && !isObj(ext["offer-receipt"])) ext["offer-receipt"] = { info: {} };
  // the resource as this seller names it: the bazaar listing and the receipt's resourceUrl both come from it
  if (o.bazaar || o.signReceipt) res = paymentRequired(o, resource, undefined, method).resource;
  return { ...pay, payload: { ...p, ...(res !== undefined ? { resource: res } : {}), extensions: ext } };
}

/** the payment header, decoded and matched to what was asked; null = none sent; a string = refused (the reason) */
export function readPayment(req: Request, o: SellerOptions, resource: string): Payment | null | string {
  const raw = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (raw == null) return null;
  if (raw.length > MAX_HEADER) return "invalid_payment";
  let p: Record<string, unknown>;
  try {
    p = unb64(raw) as Record<string, unknown>;
  } catch {
    return "invalid_payment";
  }
  if (!p || typeof p !== "object" || !p.payload || typeof p.payload !== "object") return "invalid_payment";
  if (p.x402Version === 2) {
    const a = p.accepted as Record<string, unknown> | undefined;
    const want = requirement(o);
    const ex = (a?.extra ?? {}) as Record<string, unknown>;
    const same = !!a && a.scheme === want.scheme && a.network === want.network
      && String(a.asset ?? "").toLowerCase() === want.asset.toLowerCase()
      && String(a.payTo ?? "").toLowerCase() === want.payTo.toLowerCase()
      && String(a.amount) === want.amount
      && Number(a.maxTimeoutSeconds) === want.maxTimeoutSeconds
      && ex.name === want.extra.name && ex.version === want.extra.version;
    if (!same) return "payment_does_not_match_requirements";
    // the client's own extra goes on: what is paid is checked equal above, and a facilitator may compare the two whole
    return { version: 2, payload: p, requirements: { ...want, extra: { ...ex } } };
  }
  if (p.x402Version === 1) {
    if (p.scheme !== "exact" || (p.network !== USDG.networkV1 && p.network !== USDG.network)) return "payment_does_not_match_requirements";
    return { version: 1, payload: p, requirements: { ...requirementV1(o, resource), network: p.network as string } };
  }
  return "unsupported_x402_version";
}

const reason = (o: Record<string, unknown>, k: string, fallback: string) =>
  (typeof o[k] === "string" && /^[a-z0-9_]{1,64}$/i.test(o[k] as string) ? (o[k] as string) : fallback);

async function call(o: SellerOptions, op: "verify" | "settle", pay: Payment): Promise<Record<string, unknown>> {
  const base = (o.facilitator ?? TOLL_FACILITATOR).replace(/\/+$/, "");
  const r = await (o.fetch ?? fetch)(`${base}/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: pay.version, paymentPayload: pay.payload, paymentRequirements: pay.requirements }),
    signal: AbortSignal.timeout(op === "settle" ? o.settleTimeoutMs ?? 60_000 : o.timeoutMs ?? 15_000),
  });
  let j: unknown = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  // a 4xx with a readable verdict is a verdict; anything else is the facilitator failing
  if (j && typeof j === "object" && (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429))) return j as Record<string, unknown>;
  throw new Error(`facilitator ${op} answered ${r.status}`);
}

const unavailable = () => json({ error: "The payment could not be checked right now. Nothing was charged. Try again shortly." }, 503, { "retry-after": "10" });
/**
 * AFTER THE HANDLER RAN (0.3.1): /settle gave no answer, or said the transaction is not mined yet. The transfer may
 * still land, so "nothing was charged" would be a lie and a 402 would ask for a second payment. The buyer is told what
 * is true: the payment may settle, and the SAME payment sent again gets the answer (the facilitator answers one
 * settlement however often it is asked).
 */
const settleUnknown = (pending: Record<string, unknown> | null) => json({
  error: pending
    ? "The payment is being settled and is not confirmed yet. Do not pay again: send this request again with the same payment."
    : "The payment could not be confirmed right now. It may still settle. Do not pay again: send this request again with the same payment.",
  code: pending ? "settlement_pending" : "settlement_unknown",
  ...(pending && typeof pending.transaction === "string" && pending.transaction ? { transaction: pending.transaction } : {}),
}, 503, { "retry-after": "15" });

/**
 * Put a price on a handler. The handler runs only for a verified payment, and the payment settles only when the
 * handler answered below 400: a failed answer is never charged.
 */
export function paywall(o: SellerOptions, handler: (req: Request, payment: Payment) => Response | Promise<Response>) {
  requirement(o); // a bad payTo or price fails at startup, not on the first buyer
  if (o.appCode !== undefined) validAppCode(o.appCode);
  if (o.bazaar !== undefined) checkBazaar(o.bazaar);
  if (o.signReceipt !== undefined && typeof o.signReceipt !== "function") throw new Error("signReceipt must be a function (typedData) => signature");
  return async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const resource = `${u.origin}${u.pathname}`;
    const method = req.method;
    const read = readPayment(req, o, resource);
    if (read === null) return need402(o, resource, undefined, method);
    if (typeof read === "string") return need402(o, resource, read, method);
    const pay = withDeclared(read, o, resource, method);

    let v: Record<string, unknown>;
    try { v = await call(o, "verify", pay); } catch { return unavailable(); }
    if (v.isValid !== true) return need402(o, resource, reason(v, "invalidReason", "invalid_payment"), method);

    const vScreen = screenOf(v);
    const res = await handler(req, vScreen ? { ...pay, screen: vScreen } : pay);
    if (res.status >= 400) return res;

    // SETTLE, AND ONCE MORE WHEN IT GAVE NO ANSWER OR SAID "PENDING" (0.3.1): the same payment, never a new one
    const trySettle = async (): Promise<Record<string, unknown> | null> => { try { return await call(o, "settle", pay); } catch { return null; } };
    const isPending = (x: Record<string, unknown> | null) => !!x && x.success !== true && x.errorReason === "settlement_pending";
    let s = await trySettle();
    if (s === null || isPending(s)) {
      await (o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(o.settleRetryMs ?? 2_000);
      const again = await trySettle();
      if (again !== null) s = again;
      if (again === null && s === null) return settleUnknown(null);
    }
    if (s === null) return settleUnknown(null);
    if (isPending(s)) return settleUnknown(s);
    if (s.success !== true) return need402(o, resource, reason(s, "errorReason", "settlement_failed"), method);

    const ext = (s.extensions && typeof s.extensions === "object" ? s.extensions : {}) as Record<string, unknown>;
    const sScreen = screenOf(s);
    const settled: Settlement = {
      success: true,
      transaction: typeof s.transaction === "string" ? s.transaction : "",
      network: typeof s.network === "string" ? s.network : USDG.network,
      ...(typeof s.payer === "string" ? { payer: s.payer } : {}),
      ...(Object.keys(ext).length ? { extensions: ext } : {}),
      ...(sScreen ? { screen: sScreen } : {}),
    };
    if (o.signReceipt && pay.version === 2) {
      const payload = receiptPayloadOf(s, { resource, payer: settled.payer, transaction: settled.transaction });
      if (payload) {
        try {
          const signature = await o.signReceipt(receiptTypedData(payload));
          if (typeof signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(signature)) settled.offerReceipt = { format: "eip712", payload, signature };
        } catch { /* no receipt; the buyer still gets the answer */ }
      }
    }
    if (o.onSettled) {
      try { await o.onSettled(settled, req); } catch { /* the seller's hook never costs the buyer the answer */ }
    }
    const receipt = b64({ success: true, transaction: settled.transaction, network: settled.network,
      ...(settled.payer ? { payer: settled.payer } : {}), ...(ext.receipt ? { receipt: ext.receipt } : {}),
      ...(settled.offerReceipt ? { extensions: { "offer-receipt": { info: { receipt: settled.offerReceipt } } } } : {}) });
    const headers = new Headers(res.headers);
    headers.set("PAYMENT-RESPONSE", receipt);
    headers.set("X-PAYMENT-RESPONSE", receipt);
    headers.set("access-control-expose-headers", EXPOSE["access-control-expose-headers"]);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
