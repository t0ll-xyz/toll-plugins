import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  COIN_WATCH_EVENTS,
  TOLL_ALLOW_SIGNER,
  Toll,
  TollError,
  WALLET_WATCH_EVENTS,
  appendTicketSuffix,
  assessmentOf,
  coinBadgeEmbed,
  coinBadgeUrl,
  readWebhook,
  ticketAskOf,
  verifyWebhook,
  type AllowTicket,
} from "../src/index.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8");
const WALLET = "0x4a2c93066d94f1e69f3ead5438c4efddf80a46ba";
const TOKEN = "0xff9e86e6b21fd688027981bee4b64c8b6b804ed3";
const UUID = "0b7f8a52-2c43-4f0e-9a51-6a3f1d2e9c10";

type Call = { url: string; init: RequestInit };
function mockFetch(responses: Response[]) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift();
    if (!r) throw new Error("no more mock responses");
    return r;
  };
  return { f, calls };
}
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
const hdr = (c: Call) => c.init.headers as Record<string, string>;

/* ---------------------------------------------------------------- approvals */

// a row in the shape the approvals route serves (live answers on 2026-11-08 had state ok with 0 rows, or not read)
const ROW = {
  kind: "erc20", token: TOKEN, symbol: "TOLL", spender: "0x000000000022d473030f116ddee9f6b43ac78ba3", amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  unlimited: true, spenderFacts: { type: "contract", name: "Permit2", named: "known" }, risk: "medium", why: "an unlimited allowance to a contract Toll knows",
  block: 109000000, tx: `0x${"ab".repeat(32)}`,
  revoke: { to: TOKEN, data: "0x095ea7b3", value: "0", does: "approve(spender, 0)", check: { action: "ALLOW", warnings: [] } },
};

test("approvals: GET /api/approvals/{wallet}, typed ok answer (live shape)", async () => {
  const ok = { state: "ok", wallet: WALLET, chainId: 4663, rows: [ROW], total: 1, more: 0, counts: { high: 0, medium: 1, low: 0 }, logs: 3, pairsNotRead: 0, notes: [], readTo: 109459126, readAt: "2026-11-08T19:13:43.966Z" };
  const m = mockFetch([json(ok)]);
  const a = await new Toll({ fetch: m.f, clientId: "c".repeat(22) }).approvals(WALLET.toUpperCase().replace("0X", "0x"));
  assert.equal(m.calls[0].url, `https://t0ll.xyz/api/approvals/${WALLET}`);
  assert.equal(m.calls[0].init.method, "GET");
  assert.equal(hdr(m.calls[0])["x-toll-client"], "c".repeat(22));
  assert.equal(hdr(m.calls[0]).authorization, undefined);
  assert.equal(a.state, "ok");
  if (a.state === "ok") {
    assert.equal(a.rows[0].revoke.check.action, "ALLOW");
    assert.equal(a.counts.medium, 1);
  }
});

test("approvals: 503 not read is an answer with retryAfterS, never 'no approvals'", async () => {
  const nr = { state: "not read", wallet: WALLET, reason: "the approval logs could not be read (history service: history service answered 429)" };
  const m = mockFetch([json(nr, 503, { "retry-after": "30" })]);
  const a = await new Toll({ fetch: m.f }).approvals(WALLET);
  assert.deepEqual(a, { ...nr, retryAfterS: 30 });
});

test("approvals: 429 / 503 without a state / 400 throw TollError with the server's text", async () => {
  const m = mockFetch([
    json({ error: "Too many requests: 6 a minute. Try again in a minute." }, 429, { "retry-after": "60" }),
    json({ error: "The approvals list is unavailable right now. Try again shortly." }, 503, { "retry-after": "60" }),
  ]);
  const t = new Toll({ fetch: m.f });
  await assert.rejects(t.approvals(WALLET), (e: unknown) => e instanceof TollError && e.status === 429 && e.retryAfterS === 60 && /6 a minute/.test(e.message));
  await assert.rejects(t.approvals(WALLET), (e: unknown) => e instanceof TollError && e.status === 503 && /unavailable/.test(e.message));
  await assert.rejects(t.approvals("0x123"), (e: unknown) => e instanceof TollError && /Invalid wallet/.test(e.message));
  assert.equal(m.calls.length, 2);
});

test("approvalsText: ?format=text, the not-read text passes through", async () => {
  const text = `Approvals of ${WALLET} on Robinhood Chain: not read. x.\nNothing here means the wallet has no approvals; ask again in a minute.\nRead more: https://t0ll.xyz/api/approvals/${WALLET}`;
  const m = mockFetch([new Response(text, { status: 503, headers: { "content-type": "text/plain" } })]);
  assert.equal(await new Toll({ fetch: m.f }).approvalsText(WALLET), text);
  assert.equal(m.calls[0].url, `https://t0ll.xyz/api/approvals/${WALLET}?format=text`);
});

test("walletApprovals: the wallet_approvals MCP tool with { wallet }", async () => {
  const m = mockFetch([json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Approvals of x" }] } })]);
  const r = await new Toll({ fetch: m.f }).walletApprovals(WALLET);
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)).params, { name: "wallet_approvals", arguments: { wallet: WALLET } });
  assert.equal(r.text, "Approvals of x");
});

/* ---------------------------------------------------------------- blocklist */

test("blocklist: the live JSON shape, ETag kept, query built from since / kind", async () => {
  const m = mockFetch([new Response(fx("blocklist"), { status: 200, headers: { etag: 'W/"a88694eb99dd1534"', "content-type": "application/json" } })]);
  const r = await new Toll({ fetch: m.f }).blocklist({ since: new Date("2026-11-08T12:00:00Z"), kind: "token" });
  assert.equal(m.calls[0].url, "https://t0ll.xyz/api/blocklist?since=2026-11-08T12%3A00%3A00.000Z&kind=token");
  assert.equal(r.notModified, false);
  if (!r.notModified) {
    assert.equal(r.etag, 'W/"a88694eb99dd1534"');
    assert.equal(r.list.chain_id, 4663);
    assert.equal(r.list.entries[0].kind, "token");
    assert.ok(r.list.entries[0].reasons.every((c) => typeof r.list.reasons[c] === "string"));
    assert.match(r.list.note, /not cleared/);
  }
});

test("blocklist: If-None-Match with the last ETag, 304 is notModified", async () => {
  const m = mockFetch([new Response(null, { status: 304, headers: { etag: 'W/"e1"' } })]);
  const r = await new Toll({ fetch: m.f }).blocklist({ etag: 'W/"e1"' });
  assert.equal(hdr(m.calls[0])["if-none-match"], 'W/"e1"');
  assert.deepEqual(r, { notModified: true, etag: 'W/"e1"' });
});

test("blocklistFile: csv / txt as text; bad input is refused before a request", async () => {
  const csv = "address,kind,reasons,first_seen,last_confirmed,evidence,tx,chain_id\n0xde6e3ce3597997d06d3bcc306cc6796a0f8e63aa,token,rugged_24h,2026-11-08T19:03:53.000Z,2026-11-08T19:03:53.000Z,https://t0ll.xyz/check/0xde6e3ce3597997d06d3bcc306cc6796a0f8e63aa,,4663\n";
  const m = mockFetch([new Response(csv, { status: 200, headers: { etag: 'W/"c"' } })]);
  const t = new Toll({ fetch: m.f });
  const r = await t.blocklistFile("csv", { kind: "token" });
  assert.equal(m.calls[0].url, "https://t0ll.xyz/api/blocklist?format=csv&kind=token");
  assert.deepEqual(r, { notModified: false, etag: 'W/"c"', text: csv });
  await assert.rejects(t.blocklist({ since: "yesterday" }), /Invalid since/);
  await assert.rejects(t.blocklist({ kind: "coin" as any }), /Invalid kind/);
  await assert.rejects(t.blocklistFile("xml" as any), /Invalid format/);
  assert.equal(m.calls.length, 1);
});

/* ---------------------------------------------------------------- record */

test("txRecord: GET /api/record/tx, the live shape", async () => {
  const m = mockFetch([new Response(fx("record_tx"), { status: 200 })]);
  const r = await new Toll({ fetch: m.f }).txRecord();
  assert.equal(m.calls[0].url, "https://t0ll.xyz/api/record/tx");
  assert.deepEqual(r.actions.map((a) => a.action), ["BLOCK", "WARN", "ALLOW"]);
  assert.equal(r.windowH, 24);
  assert.equal(r.calibration.blockAtPct, 40);
  assert.ok(r.calibration.rules.length > 0);
  assert.equal(r.page, "https://t0ll.xyz/agents/record");
});

test("txRecord: 503 throws with the server's text", async () => {
  const m = mockFetch([json({ error: "The pre-sign record could not be read just now. Nothing is shown rather than a guess." }, 503)]);
  await assert.rejects(new Toll({ fetch: m.f }).txRecord(), (e: unknown) => e instanceof TollError && e.status === 503 && /rather than a guess/.test(e.message));
});

/* ---------------------------------------------------------------- badge */

test("coin badge URL and embed snippets (the t0ll.xyz/agents/embed snippets)", () => {
  const T = "0xFF9E86E6B21FD688027981BEE4B64C8B6B804ED3";
  assert.equal(coinBadgeUrl(T), `https://t0ll.xyz/badge/${TOKEN}`);
  assert.equal(coinBadgeUrl(T, { size: "lg" }), `https://t0ll.xyz/badge/${TOKEN}?size=lg`);
  const e = coinBadgeEmbed(T);
  assert.equal(e.html, `<a href="https://t0ll.xyz/check/${TOKEN}"><img src="https://t0ll.xyz/badge/${TOKEN}" alt="Toll check" width="200" height="28"></a>`);
  assert.equal(e.markdown, `[![Toll check](https://t0ll.xyz/badge/${TOKEN})](https://t0ll.xyz/check/${TOKEN})`);
  assert.equal(e.react, `<a href="https://t0ll.xyz/check/${TOKEN}"><img src="https://t0ll.xyz/badge/${TOKEN}" alt="Toll check" width={200} height={28} /></a>`);
  assert.match(coinBadgeEmbed(T, { size: "lg" }).html, /width="300" height="42"/);
  assert.equal(new Toll({ baseUrl: "http://localhost:3000/" }).badgeUrl(T), `http://localhost:3000/badge/${TOKEN}`);
  assert.throws(() => coinBadgeUrl("0x12"), TollError);
});

/* ---------------------------------------------------------------- watches over REST */

test("coin watches: Bearer key, {token, url}, created on 201, list, delete ?id=", async () => {
  const added = { id: UUID, token: TOKEN, url: "https://a.example/h", cap: 3, events: [...COIN_WATCH_EVENTS], signature: "x-toll-signature: sha256=<hex HMAC-SHA256(secret, raw body)>", secret: "s".repeat(64), note: "Keep the secret: it is shown once and signs every event." };
  const m = mockFetch([json(added, 201), json({ watches: [{ id: UUID, token: TOKEN, url: "https://a.example/h", paused: false, fails: 0, checked_at: null }], cap: 3, docs: "https://t0ll.xyz/llms.txt" }), json({ deleted: UUID })]);
  const t = new Toll({ fetch: m.f, tollKey: "k1" });
  const a = await t.createCoinWatch(TOKEN, "https://a.example/h");
  assert.equal(m.calls[0].url, "https://t0ll.xyz/api/watch");
  assert.equal(m.calls[0].init.method, "POST");
  assert.equal(hdr(m.calls[0]).authorization, "Bearer k1");
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)), { token: TOKEN, url: "https://a.example/h" });
  assert.equal(a.created, true);
  assert.equal(a.secret, "s".repeat(64));
  assert.equal((await t.listCoinWatches()).watches[0].id, UUID);
  assert.deepEqual(await t.deleteCoinWatch(UUID), { deleted: UUID });
  assert.equal(m.calls[2].url, `https://t0ll.xyz/api/watch?id=${UUID}`);
  assert.equal(m.calls[2].init.method, "DELETE");
});

test("wallet watches: {address, url}, 200 = already watched (no secret), delete on /api/watch/wallet", async () => {
  const again = { id: UUID, address: WALLET, url: "https://a.example/w", cap: 3, events: [...WALLET_WATCH_EVENTS], signature: "x-toll-signature: sha256=<hex HMAC-SHA256(secret, raw body)>", note: "Already watched; resumed if it was paused." };
  const m = mockFetch([json(again, 200), json({ watches: [], cap: 3 }), json({ deleted: UUID })]);
  const t = new Toll({ fetch: m.f, tollKey: "k1" });
  const a = await t.createWalletWatch(WALLET, "https://a.example/w");
  assert.equal(m.calls[0].url, "https://t0ll.xyz/api/watch/wallet");
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)), { address: WALLET, url: "https://a.example/w" });
  assert.equal(a.created, false);
  assert.equal(a.secret, undefined);
  assert.deepEqual(await t.listWalletWatches(), { watches: [], cap: 3 });
  await t.deleteWalletWatch(UUID);
  assert.equal(m.calls[2].url, `https://t0ll.xyz/api/watch/wallet?id=${UUID}`);
});

test("watches: no key / bad id refused before a request; 401, 403, WATCH_API off are TollErrors", async () => {
  const none = mockFetch([]);
  await assert.rejects(new Toll({ fetch: none.f }).listCoinWatches(), /Toll key/);
  await assert.rejects(new Toll({ fetch: none.f, tollKey: "k" }).deleteWalletWatch("w1"), /Invalid watch id/);
  assert.equal(none.calls.length, 0);
  const m = mockFetch([
    json({ error: "Coin watches for agents are not open yet.", open: false }, 404),
    json({ error: "Send your Toll key (Authorization: Bearer <key>, made at https://t0ll.xyz/toll#keys): watches belong to a wallet." }, 401),
    json({ error: "This key's tier watches up to 3 wallets. Holding more $TOLL lifts it: https://t0ll.xyz/toll", cap: 3 }, 403),
  ]);
  const t = new Toll({ fetch: m.f, tollKey: "k" });
  await assert.rejects(t.listCoinWatches(), (e: unknown) => e instanceof TollError && e.status === 404 && /WATCH_API/.test(e.message));
  await assert.rejects(t.listWalletWatches(), (e: unknown) => e instanceof TollError && e.status === 401 && /Bearer/.test(e.message));
  await assert.rejects(t.createWalletWatch(WALLET, "https://a.example/w"), (e: unknown) => e instanceof TollError && e.status === 403 && /up to 3 wallets/.test(e.message));
});

test("watchWallet / unwatchWallet over MCP: need a key, send Toll's argument names", async () => {
  await assert.rejects(new Toll({ fetch: mockFetch([]).f }).watchWallet(WALLET, "https://a.example/w"), /Toll key/);
  const ans = (o: unknown) => json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: `${JSON.stringify(o, null, 2)}\n\nDocs: https://t0ll.xyz/llms.txt` }] } });
  const m = mockFetch([ans({ id: UUID, secret: "s" }), ans({ deleted: UUID })]);
  const t = new Toll({ fetch: m.f, tollKey: "k1" });
  assert.deepEqual((await t.watchWallet(WALLET, "https://a.example/w")).data, { id: UUID, secret: "s" });
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)).params, { name: "watch_wallet", arguments: { address: WALLET, url: "https://a.example/w" } });
  assert.equal(hdr(m.calls[0])["x-toll-pass"], "k1");
  await t.unwatchWallet(UUID);
  assert.deepEqual(JSON.parse(String(m.calls[1].init.body)).params, { name: "unwatch_wallet", arguments: { id: UUID } });
});

/* ---------------------------------------------------------------- webhooks */

test("verifyWebhook: sha256=<hex HMAC-SHA256(secret, raw body)>", async () => {
  const secret = "9f".repeat(32);
  const raw = JSON.stringify({ type: "toll.wallet_watch", event: "approval", events: [{ type: "approval", token: TOKEN, spender: WALLET, amount: "unlimited", kind: "erc20", tx: "0x1", block: 1 }], more: 0, watch_id: UUID, address: WALLET, chain: "rh", blocks: { from: 1, to: 2 }, at: "2026-11-08T19:00:00Z" });
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(await verifyWebhook(secret, raw, sig), true);
  assert.equal(await verifyWebhook(secret, new TextEncoder().encode(raw), sig.toUpperCase().replace("SHA256=", "sha256=")), true);
  assert.equal(await verifyWebhook(secret, raw + " ", sig), false);
  assert.equal(await verifyWebhook("other", raw, sig), false);
  assert.equal(await verifyWebhook(secret, raw, null), false);
  assert.equal(await verifyWebhook(secret, raw, "sha256=zz"), false);
  const ev = await readWebhook(secret, raw, sig);
  assert.equal(ev.type, "toll.wallet_watch");
  await assert.rejects(readWebhook(secret, raw, "sha256=" + "0".repeat(64)), /does not match/);
});

/* ---------------------------------------------------------------- check_tx ticket */

// the check_tx answer as the MCP server writes it: plain lines, then "RiskAssessment (ERC-8265):" and one JSON line
const TICKET: AllowTicket = {
  scope: 1, verdict: 0, account: "0x2222222222222222222222222222222222222222", consumer: "0x0000000000000000000000000000000000000000",
  subject: `0x${"9c".repeat(32)}`, validAfter: 1793000000, validUntil: 1793000060, nonce: `0x${"91".repeat(32)}`, reportHash: `0x${"d9".repeat(32)}`,
};
const txAnswer = (xtoll: Record<string, unknown>) => {
  const ra = { version: "erc-8265/1", action: "ALLOW", warnings: [], scanners: [{ provider: "Toll" }], "x-toll": xtoll };
  const text = ["ALLOW: none of the checks Toll runs found a reason to stop (not a promise that it is safe).", "- no warnings", "Read more: https://t0ll.xyz/agents/mcp?utm_source=mcp", "", "RiskAssessment (ERC-8265):", JSON.stringify(ra)].join("\n");
  return json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
};

test("checkTx ticket: true sends ticket {}, the signed ticket comes back parsed", async () => {
  const m = mockFetch([txAnswer({ ticket: { ticket: TICKET, signature: "0x" + "11".repeat(65), signer: TOLL_ALLOW_SIGNER } })]);
  const r = await new Toll({ fetch: m.f }).checkTx({ from: TICKET.account, to: TOKEN, data: "0x", value: 0, ticket: true });
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)).params.arguments, { from: TICKET.account, to: TOKEN, data: "0x", value: 0, ticket: {} });
  assert.equal(r.action, "ALLOW");
  assert.ok(r.ticket && "ticket" in r.ticket);
  if (r.ticket && "ticket" in r.ticket) assert.equal(r.ticket.signer, TOLL_ALLOW_SIGNER);
});

test("checkTx ticket: {consumer, scope} passed through; {why}; false / absent sends no ticket", async () => {
  const C = "0x3333333333333333333333333333333333333333";
  const m = mockFetch([txAnswer({ ticket: { why: "No ticket: the request has no from." } }), txAnswer({})]);
  const t = new Toll({ fetch: m.f });
  const r = await t.checkTx({ to: TOKEN, ticket: { consumer: C, scope: "v4swap" } });
  assert.deepEqual(JSON.parse(String(m.calls[0].init.body)).params.arguments.ticket, { consumer: C, scope: "v4swap" });
  assert.deepEqual(r.ticket, { why: "No ticket: the request has no from." });
  const r2 = await t.checkTx({ to: TOKEN, ticket: false });
  assert.equal("ticket" in JSON.parse(String(m.calls[1].init.body)).params.arguments, false);
  assert.equal(r2.ticket, undefined);
  assert.equal(r2.assessment?.action, "ALLOW");
  await assert.rejects(t.checkTx({ to: TOKEN, ticket: { consumer: "0x12" } }), /ticket.consumer/);
  await assert.rejects(t.checkTx({ to: TOKEN, ticket: { scope: "tx" as any } }), /ticket.scope/);
  assert.deepEqual(ticketAskOf(true), {});
  assert.equal(ticketAskOf(false), null);
  assert.equal(assessmentOf("no json here"), null);
});

test("appendTicketSuffix equals toll-allow's suffixedData byte for byte (guard's vectors)", () => {
  type V = { name: string; data: string; ticket: AllowTicket; signature: string; suffixedData: string };
  const VEC = JSON.parse(readFileSync(new URL("./fixtures/allowticket-vectors.viem.json", import.meta.url), "utf8")) as { vectors: V[] };
  assert.ok(VEC.vectors.length >= 2);
  for (const v of VEC.vectors) assert.equal(appendTicketSuffix(v.data, v.ticket, v.signature), v.suffixedData.toLowerCase(), v.name);
});
