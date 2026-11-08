import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendTicketSuffix,
  checkTx,
  enforce,
  ticketAskOf,
  TICKET_SUFFIX_MAGIC,
  TOLL_ALLOW_SIGNER,
  type AllowTicket,
  type GuardReport,
  type Hex,
  type RiskAssessment,
} from "../src/index.js";

/** toll-allow's viem vectors (test/vectors/allowticket-vectors.viem.json): the suffix as TollAllow.encodeSuffix builds it */
type V = { name: string; data: Hex; ticket: AllowTicket; signature: Hex; suffixedData: Hex };
const VEC = JSON.parse(readFileSync(new URL("./fixtures/allowticket-vectors.viem.json", import.meta.url), "utf8")) as { suffixMagic: string; vectors: V[] };
const allow = JSON.parse(readFileSync(new URL("./fixtures/allow.json", import.meta.url), "utf8")) as RiskAssessment;

const FROM = "0x2222222222222222222222222222222222222222";
const TO = "0x000000000000000000000000000000000000dEaD";
const CONSUMER = "0x3333333333333333333333333333333333333333";
const TX = { chainId: 4663, from: FROM, to: TO, data: "0x", value: 0n };

function mock(answer: RiskAssessment) {
  const bodies: Record<string, unknown>[] = [];
  const f = async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { f, bodies };
}

test("appendTicketSuffix equals toll-allow's suffixedData byte for byte", () => {
  assert.equal(TICKET_SUFFIX_MAGIC, VEC.suffixMagic);
  assert.ok(VEC.vectors.length >= 2);
  for (const v of VEC.vectors) {
    assert.equal(appendTicketSuffix(v.data, v.ticket, v.signature), v.suffixedData.toLowerCase(), v.name);
    // uint64 times as numbers or bigints encode the same
    const t = { ...v.ticket, validAfter: BigInt(v.ticket.validAfter), validUntil: Number(v.ticket.validUntil) };
    assert.equal(appendTicketSuffix(v.data, t, v.signature), v.suffixedData.toLowerCase(), `${v.name} (bigint/number)`);
  }
});

test("the suffix splits back as TollAllow.splitSuffix reads it: body, len, magic", () => {
  const v = VEC.vectors[0];
  const out = appendTicketSuffix(v.data, v.ticket, v.signature).slice(2);
  assert.ok(out.endsWith(TICKET_SUFFIX_MAGIC.slice(2)));
  const len = parseInt(out.slice(-16, -8), 16);
  assert.equal(len, 448); // 9 tuple words + offset + length + 65-byte signature padded to 96
  const start = out.length / 2 - 8 - len;
  assert.equal(`0x${out.slice(0, start * 2)}`, v.data.toLowerCase());
  assert.equal(out.slice(start * 2 + 10 * 64 - 64, start * 2 + 10 * 64), (320).toString(16).padStart(64, "0")); // offset to the bytes
});

test("appendTicketSuffix refuses malformed input", () => {
  const v = VEC.vectors[0];
  assert.throws(() => appendTicketSuffix("0x123" as Hex, v.ticket, v.signature), /data/);
  assert.throws(() => appendTicketSuffix(v.data, { ...v.ticket, account: "0x12" }, v.signature), /account/);
  assert.throws(() => appendTicketSuffix(v.data, { ...v.ticket, scope: 256 }, v.signature), /scope/);
  assert.throws(() => appendTicketSuffix(v.data, { ...v.ticket, validUntil: 2n ** 64n }, v.signature), /validUntil/);
});

test("ticket option: sent only when asked, as true -> {} or {consumer, scope}", async () => {
  assert.equal(ticketAskOf(undefined), null);
  assert.equal(ticketAskOf(false), null);
  assert.deepEqual(ticketAskOf(true), {});
  const m = mock(allow);
  await checkTx(TX, { fetch: m.f });
  assert.equal("ticket" in m.bodies[0], false);
  await checkTx(TX, { fetch: m.f, ticket: true });
  assert.deepEqual(m.bodies[1].ticket, {});
  await checkTx(TX, { fetch: m.f, ticket: { consumer: CONSUMER, scope: "call" } });
  assert.deepEqual(m.bodies[2].ticket, { consumer: CONSUMER, scope: "call" });
});

test("the GuardReport carries the signed ticket, or why none", async () => {
  const v = VEC.vectors[0];
  const signed = { ...allow, "x-toll": { ...allow["x-toll"], ticket: { ticket: v.ticket, signature: v.signature, signer: TOLL_ALLOW_SIGNER.toLowerCase() } } };
  const reports: GuardReport[] = [];
  const r = await enforce("transaction", () => TX, { fetch: mock(signed).f, ticket: true, logger: false, onReport: (x) => void reports.push(x) });
  assert.ok(r.ticket && "ticket" in r.ticket);
  assert.equal(r.ticket.signature, v.signature);
  assert.equal(appendTicketSuffix(v.data, r.ticket.ticket, r.ticket.signature), v.suffixedData.toLowerCase());
  assert.deepEqual(reports[0].ticket, r.ticket);

  const none = { ...allow, "x-toll": { ...allow["x-toll"], ticket: { why: "No ticket without from: the ticket binds the account that sends the transaction." } } };
  const r2 = await enforce("transaction", () => TX, { fetch: mock(none).f, ticket: true, logger: false });
  assert.deepEqual(r2.ticket, { why: "No ticket without from: the ticket binds the account that sends the transaction." });

  const r3 = await enforce("transaction", () => TX, { fetch: mock(allow).f, logger: false });
  assert.equal("ticket" in r3, false);
});

test("the spend path keeps the ticket on its report", async () => {
  const v = VEC.vectors[0];
  const signed = { ...allow, "x-toll": { ...allow["x-toll"], ticket: { ticket: v.ticket, signature: v.signature, signer: TOLL_ALLOW_SIGNER.toLowerCase() } } };
  const r = await enforce("transaction", () => TX, { fetch: mock(signed).f, ticket: true, logger: false, spend: {} });
  assert.ok(r.ticket && "signature" in r.ticket);
});
