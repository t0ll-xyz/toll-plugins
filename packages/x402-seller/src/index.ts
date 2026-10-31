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

export type Settlement = {
  success: true;
  transaction: string;
  network: string;
  payer?: string;
  /** the facilitator's extensions: erc8478 (the payee check) and receipt (Toll's signed EIP-712 receipt) */
  extensions?: Record<string, unknown>;
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
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
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

/** x402 v2 PaymentRequired (what rides base64 in the PAYMENT-REQUIRED header) */
export function paymentRequired(o: SellerOptions, resource: string, error?: string) {
  return {
    x402Version: 2 as const,
    ...(error ? { error } : {}),
    resource: { url: resource, description: o.description ?? "", mimeType: o.mimeType ?? "application/json" },
    accepts: [requirement(o)],
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
export function need402(o: SellerOptions, resource: string, error = "payment_required"): Response {
  return json({ x402Version: 1, error, accepts: [requirementV1(o, resource)] }, 402,
    { ...EXPOSE, "PAYMENT-REQUIRED": b64(paymentRequired(o, resource, error)) });
}

export type Payment = { version: 1 | 2; payload: Record<string, unknown>; requirements: Record<string, unknown> };

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
    signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
  });
  let j: unknown = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  // a 4xx with a readable verdict is a verdict; anything else is the facilitator failing
  if (j && typeof j === "object" && (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429))) return j as Record<string, unknown>;
  throw new Error(`facilitator ${op} answered ${r.status}`);
}

const unavailable = () => json({ error: "The payment could not be checked right now. Nothing was charged. Try again shortly." }, 503, { "retry-after": "10" });

/**
 * Put a price on a handler. The handler runs only for a verified payment, and the payment settles only when the
 * handler answered below 400: a failed answer is never charged.
 */
export function paywall(o: SellerOptions, handler: (req: Request, payment: Payment) => Response | Promise<Response>) {
  requirement(o); // a bad payTo or price fails at startup, not on the first buyer
  return async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const resource = `${u.origin}${u.pathname}`;
    const pay = readPayment(req, o, resource);
    if (pay === null) return need402(o, resource);
    if (typeof pay === "string") return need402(o, resource, pay);

    let v: Record<string, unknown>;
    try { v = await call(o, "verify", pay); } catch { return unavailable(); }
    if (v.isValid !== true) return need402(o, resource, reason(v, "invalidReason", "invalid_payment"));

    const res = await handler(req, pay);
    if (res.status >= 400) return res;

    let s: Record<string, unknown>;
    try { s = await call(o, "settle", pay); } catch { return unavailable(); }
    if (s.success !== true) return need402(o, resource, reason(s, "errorReason", "settlement_failed"));

    const ext = (s.extensions && typeof s.extensions === "object" ? s.extensions : {}) as Record<string, unknown>;
    const settled: Settlement = {
      success: true,
      transaction: typeof s.transaction === "string" ? s.transaction : "",
      network: typeof s.network === "string" ? s.network : USDG.network,
      ...(typeof s.payer === "string" ? { payer: s.payer } : {}),
      ...(Object.keys(ext).length ? { extensions: ext } : {}),
    };
    if (o.onSettled) {
      try { await o.onSettled(settled, req); } catch { /* the seller's hook never costs the buyer the answer */ }
    }
    const receipt = b64({ success: true, transaction: settled.transaction, network: settled.network,
      ...(settled.payer ? { payer: settled.payer } : {}), ...(ext.receipt ? { receipt: ext.receipt } : {}) });
    const headers = new Headers(res.headers);
    headers.set("PAYMENT-RESPONSE", receipt);
    headers.set("X-PAYMENT-RESPONSE", receipt);
    headers.set("access-control-expose-headers", EXPOSE["access-control-expose-headers"]);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
