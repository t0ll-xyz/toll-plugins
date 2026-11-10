import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bazaarExtension,
  checkBazaar,
  paymentRequired,
  paywall,
  requirement,
  screenOf,
  validAppCode,
  validIconUrl,
  withDeclared,
  type Payment,
  type SellerOptions,
  type Settlement,
} from "../src/index.js";

const PAY_TO = "0x02593abff31f4e8ec1d5c2f297a347c51ef06e5c";
const URL_ = "https://seller.example/api/forecast";
const base: SellerOptions = { payTo: PAY_TO, price: "0.05", agentId: 20030, description: "a forecast" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

function fakeFetch(answers: { verify?: unknown; settle?: unknown }) {
  const calls: { url: string; body: any }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? "null")) });
    return Response.json(u.endsWith("/verify") ? answers.verify ?? {} : answers.settle ?? {});
  };
  return { f: f as typeof fetch, calls };
}
function paidRequest(o: SellerOptions, extensions?: Record<string, unknown>, method = "GET") {
  const p = { x402Version: 2, accepted: requirement(o), payload: { signature: "0xsig", authorization: { from: "0xpayer" } }, ...(extensions ? { extensions } : {}) };
  return new Request(URL_, { method, headers: { "payment-signature": b64(p) } });
}

/** Ajv 2020 as the facilitator validates bazaar info (hoisted in this monorepo); null when it is not installed */
async function ajv2020(): Promise<null | ((schema: unknown, data: unknown) => boolean)> {
  try {
    const m: any = await import("ajv/dist/2020.js");
    const Ajv = m.default?.default ?? m.default;
    return (schema, data) => new Ajv({ strict: false }).compile(schema)(data);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- appCode (builder-code, ERC-8021) */

test("appCode: validated (^[a-z0-9_]{1,32}$); a bad one fails at startup", () => {
  assert.equal(validAppCode("my_app_2"), "my_app_2");
  for (const bad of ["", "My_App", "has-dash", "a".repeat(33), 7]) assert.throws(() => validAppCode(bad), /appCode/);
  assert.throws(() => paywall({ ...base, appCode: "Bad Code" }, () => new Response("x")), /appCode/);
});

test("appCode rides in the 402 as extensions['builder-code'].info.a; no options = no extensions", async () => {
  const res = await paywall({ ...base, appCode: "forecast_app" }, () => new Response("x"))(new Request(URL_));
  const v2 = unb64(res.headers.get("payment-required")!);
  assert.deepEqual(v2.extensions, { "builder-code": { info: { a: "forecast_app" } } });
  assert.equal("extensions" in paymentRequired(base, URL_), false);
});

test("appCode goes to the facilitator in the payload's builder-code; the buyer's service codes are kept", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: true }, settle: { success: true, transaction: "0xtx" } });
  const o = { ...base, appCode: "forecast_app", fetch: f };
  const res = await paywall(o, () => new Response("ok"))(paidRequest(o, { "builder-code": { a: "spoofed", s: "buyer_wallet" }, other: { x: 1 } }));
  assert.equal(res.status, 200);
  for (const c of calls) {
    assert.deepEqual(c.body.paymentPayload.extensions["builder-code"], { a: "forecast_app", s: "buyer_wallet" });
    assert.deepEqual(c.body.paymentPayload.extensions.other, { x: 1 });
    assert.deepEqual(c.body.paymentPayload.accepted, requirement(base));
    assert.equal("extensions" in c.body.paymentRequirements, false);
  }
});

test("withDeclared leaves v1 payments and sellers without appCode / bazaar unchanged", () => {
  const v1: Payment = { version: 1, payload: { x402Version: 1 }, requirements: {} };
  assert.equal(withDeclared(v1, { ...base, appCode: "a" }, URL_), v1);
  const v2: Payment = { version: 2, payload: { x402Version: 2 }, requirements: {} };
  assert.equal(withDeclared(v2, base, URL_), v2);
  const info = withDeclared({ version: 2, payload: { extensions: { "builder-code": { info: { s: ["x", "y"] } } } }, requirements: {} }, { ...base, appCode: "a" }, URL_);
  assert.deepEqual((info.payload.extensions as any)["builder-code"], { a: "a", s: ["x", "y"] });
});

/* ---------------------------------------------------------------- bazaar (discovery) */

const bazaarGet = {
  description: "tomorrow's forecast for a city",
  input: { city: "Dubai" },
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  output: { example: { forecast: "sunny" }, schema: { type: "object", properties: { forecast: { type: "string" } } } },
  serviceName: "Forecast Desk",
  tags: ["weather", "Weather", "forecast", "", "x".repeat(33)],
  iconUrl: "https://seller.example/icon.png",
};

test("bazaar GET: info + schema per bazaar.md, catalog metadata on resource (invalid tags dropped)", async () => {
  const res = await paywall({ ...base, bazaar: bazaarGet }, () => new Response("x"))(new Request(URL_));
  const v2 = unb64(res.headers.get("payment-required")!);
  assert.deepEqual(v2.resource, {
    url: URL_, description: "tomorrow's forecast for a city", mimeType: "application/json",
    serviceName: "Forecast Desk", tags: ["weather", "forecast"], iconUrl: "https://seller.example/icon.png",
  });
  const b = v2.extensions.bazaar;
  assert.deepEqual(b.info, { input: { type: "http", method: "GET", queryParams: { city: "Dubai" } }, output: { type: "json", example: { forecast: "sunny" } } });
  assert.equal(b.schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(b.schema.required, ["input"]);
  assert.deepEqual(b.schema.properties.input.properties.queryParams, bazaarGet.inputSchema);
  assert.deepEqual(b.schema.properties.input.properties.method.enum, ["GET", "HEAD", "DELETE"]);
  const validate = await ajv2020();
  if (validate) assert.equal(validate(b.schema, b.info), true);
});

test("bazaar POST (from the request method): body + bodyType, the info validates against its schema", async () => {
  const bz = { input: { query: "rain" }, inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
  const res = await paywall({ ...base, bazaar: bz }, () => new Response("x"))(new Request(URL_, { method: "POST" }));
  const b = unb64(res.headers.get("payment-required")!).extensions.bazaar;
  assert.deepEqual(b.info.input, { type: "http", method: "POST", bodyType: "json", body: { query: "rain" } });
  assert.deepEqual(b.schema.properties.input.required, ["type", "method", "bodyType", "body"]);
  const validate = await ajv2020();
  if (validate) {
    assert.equal(validate(b.schema, b.info), true);
    assert.equal(validate(b.schema, { input: { ...b.info.input, body: { query: 1 } } }), false); // the example must match the seller's schema
    const bare = bazaarExtension({}, "OPTIONS");
    assert.equal(bare.info.input.method, "GET");
    assert.equal(validate(bare.schema, bare.info), true);
  }
});

test("bazaar: bad options fail at startup", () => {
  const h = () => new Response("x");
  assert.throws(() => paywall({ ...base, bazaar: { method: "TRACE" as any } }, h), /method/);
  assert.throws(() => paywall({ ...base, bazaar: { method: "GET", bodyType: "json" } }, h), /bodyType/);
  assert.throws(() => paywall({ ...base, bazaar: { inputSchema: { $ref: "https://evil.example/s.json" } } }, h), /\$ref/);
  assert.throws(() => paywall({ ...base, bazaar: { output: { schema: { properties: { a: { $id: "x.json" } } } } } }, h), /\$ref/);
  assert.throws(() => paywall({ ...base, bazaar: { input: [] as any } }, h), /input/);
  assert.throws(() => checkBazaar({ input: { big: "x".repeat(70_000) } }), /64 KB/);
  assert.doesNotThrow(() => checkBazaar({ inputSchema: { $defs: { a: { type: "string" } }, properties: { b: { $ref: "#/$defs/a" } } } }));
});

test("bazaar: the payload sent to the facilitator carries the bazaar extension and the seller's resource", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: true }, settle: { success: true, transaction: "0xtx" } });
  const o = { ...base, bazaar: bazaarGet, fetch: f };
  const req = paidRequest(o, undefined);
  await paywall(o, () => new Response("ok"))(req);
  const pp = calls[1].body.paymentPayload;
  assert.equal(pp.resource.url, URL_);
  assert.equal(pp.resource.serviceName, "Forecast Desk");
  assert.deepEqual(pp.extensions.bazaar.info.input, { type: "http", method: "GET", queryParams: { city: "Dubai" } });
  assert.deepEqual(pp.payload, { signature: "0xsig", authorization: { from: "0xpayer" } });
});

test("validIconUrl follows bazaar.md (http(s), no userinfo, IP, localhost, numeric host)", () => {
  assert.ok(validIconUrl("https://cdn.example/i.png"));
  for (const bad of ["data:image/png;base64,AA", "ftp://x.example/i", "https://u:p@x.example/i", "http://127.0.0.1/i", "http://[::1]/i",
    "http://localhost/i", "http://2130706433/i", "http://0x7f000001/i", "relative/i.png", `https://x.example/${"a".repeat(2050)}`]) {
    assert.equal(validIconUrl(bad), false, bad);
  }
});

/* ---------------------------------------------------------------- toll-screen */

test("screen: the verify answer's screen reaches the handler, the settle answer's reaches onSettled", async () => {
  const { f } = fakeFetch({
    verify: { isValid: true, extensions: { screen: { outcome: "warn", codes: ["unverified_payee"] } } },
    settle: { success: true, transaction: "0xtx", extensions: { receipt: { signer: "0xs" }, screen: { outcome: "allow", codes: [] } } },
  });
  let handlerSaw: Payment | undefined;
  let settled: Settlement | undefined;
  const res = await paywall({ ...base, fetch: f, onSettled: (s) => { settled = s; } }, (_req, p) => { handlerSaw = p; return new Response("ok"); })(paidRequest(base));
  assert.equal(res.status, 200);
  assert.deepEqual(handlerSaw?.screen, { outcome: "warn", codes: ["unverified_payee"] });
  assert.deepEqual(settled?.screen, { outcome: "allow", codes: [] });
  assert.equal("screen" in unb64(res.headers.get("payment-response")!), false); // the seller's, never the buyer's
});

test("screen: a handler may refuse a blocked payment, which is then not settled", async () => {
  const { f, calls } = fakeFetch({ verify: { isValid: true, extensions: { screen: { outcome: "block", codes: ["drainer"] } } } });
  const res = await paywall({ ...base, fetch: f }, (_req, p) => (p.screen?.outcome === "block" ? new Response("no", { status: 403 }) : new Response("ok")))(paidRequest(base));
  assert.equal(res.status, 403);
  assert.equal(calls.length, 1);
});

test("screenOf: absent or malformed = undefined (another facilitator)", () => {
  assert.equal(screenOf({ isValid: true }), undefined);
  assert.equal(screenOf({ extensions: { screen: { outcome: "fine" } } }), undefined);
  assert.deepEqual(screenOf({ extensions: { screen: { outcome: "not-read", codes: "x" } } }), { outcome: "not-read", codes: [] });
});
