/**
 * 0.4.1: Toll's single-use ALLOW ticket. Ask for one with the `ticket` option; Toll signs a compact EIP-712 verdict
 * bound to one exact call, one account, an optional consumer contract and a 60 second window. A contract built on
 * toll-allow (https://github.com/t0ll-xyz/toll-allow) accepts the call only with a valid, unused ticket.
 * A BLOCK is never signed. No ticket without `from`, or for a transaction with an EIP-7702 authorization list.
 *
 * appendTicketSuffix MUST match toll-allow's TollAllow.encodeSuffix / splitSuffix byte for byte:
 *   body ‖ abi.encode((uint8,uint8,address,address,bytes32,uint64,uint64,bytes32,bytes32), bytes) ‖ uint32 len ‖ 0x900bc3e1
 * where len is the byte length of the abi.encode part and 0x900bc3e1 = bytes4(keccak256("TollAllow.v1")).
 */
import type { Hex } from "./check.js";

/** what to ask Toll for: `true` = scope "call", any consumer */
export interface TicketAsk {
  /** the contract that will check the ticket (its `consumer` field); unset = any contract */
  consumer?: string;
  /** "call" (default): bound to (target, value, keccak256(data)); "v4swap": bound to the swap a HookrRouter call makes */
  scope?: "call" | "v4swap";
}

/** the ticket as Toll returns it (x-toll.ticket.ticket); uint64 times are unix seconds */
export interface AllowTicket {
  scope: number;
  verdict: number;
  account: string;
  consumer: string;
  subject: string;
  validAfter: number | bigint | string;
  validUntil: number | bigint | string;
  nonce: string;
  reportHash: string;
}

/** x-toll.ticket: a signed ticket, or why none was issued */
export type TicketResult = { ticket: AllowTicket; signature: Hex; signer: string } | { why: string };

/** bytes4(keccak256("TollAllow.v1")) */
export const TICKET_SUFFIX_MAGIC = "0x900bc3e1";
/** Toll's production ALLOW signer on Robinhood Chain (4663): pin it, or a TollSignerSet you control that includes it */
export const TOLL_ALLOW_SIGNER = "0x4A2C93066d94F1E69f3EAd5438c4efDdf80a46ba";
export const ALLOW_DOCS = "https://t0ll.xyz/agents/allow";

/** the ask as the route reads it (`ticket: {consumer?, scope?}`), or null for none */
export function ticketAskOf(t: boolean | TicketAsk | undefined | null): TicketAsk | null {
  if (t === undefined || t === null || t === false) return null;
  if (t === true) return {};
  const o: TicketAsk = {};
  if (t.consumer !== undefined) o.consumer = t.consumer;
  if (t.scope !== undefined) o.scope = t.scope;
  return o;
}

/** the ticket in an answer, when the answer carries one (signed or with its why) */
export function ticketOfAnswer(a: { "x-toll"?: Record<string, unknown> } | null | undefined): TicketResult | undefined {
  const t = a?.["x-toll"]?.ticket as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return undefined;
  if (typeof t.why === "string") return { why: t.why };
  if (t.ticket && typeof t.ticket === "object" && typeof t.signature === "string" && typeof t.signer === "string") {
    return { ticket: t.ticket as AllowTicket, signature: t.signature as Hex, signer: t.signer };
  }
  return undefined;
}

/* ------------------------------------------------------------------ ABI encoding (no dependencies) */

const hexBody = (h: string, what: string): string => {
  if (typeof h !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(h)) throw new TypeError(`${what} must be 0x hex with whole bytes`);
  return h.slice(2).toLowerCase();
};

const word = (n: bigint, bits: number, what: string): string => {
  if (n < 0n || n >= 1n << BigInt(bits)) throw new RangeError(`${what} does not fit in uint${bits}`);
  return n.toString(16).padStart(64, "0");
};

const uint = (v: number | bigint | string, bits: number, what: string): string => {
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    throw new TypeError(`${what} must be a whole number`);
  }
  return word(n, bits, what);
};

const addr = (a: string, what: string): string => {
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new TypeError(`${what} must be an address`);
  return a.slice(2).toLowerCase().padStart(64, "0");
};

const b32 = (h: string, what: string): string => {
  if (typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h)) throw new TypeError(`${what} must be 32 bytes`);
  return h.slice(2).toLowerCase();
};

/** abi.encode(Ticket, bytes) as hex without 0x: the static tuple inline (9 words), then the offset and the bytes */
export function encodeTicketAndSig(t: AllowTicket, signature: string): string {
  const sig = hexBody(signature, "signature");
  const head =
    uint(t.scope, 8, "ticket.scope") +
    uint(t.verdict, 8, "ticket.verdict") +
    addr(t.account, "ticket.account") +
    addr(t.consumer, "ticket.consumer") +
    b32(t.subject, "ticket.subject") +
    uint(t.validAfter, 64, "ticket.validAfter") +
    uint(t.validUntil, 64, "ticket.validUntil") +
    b32(t.nonce, "ticket.nonce") +
    b32(t.reportHash, "ticket.reportHash");
  const offset = word(10n * 32n, 256, "offset"); // 9 tuple words + this offset word
  const len = word(BigInt(sig.length / 2), 256, "signature length");
  const padded = sig + "0".repeat((64 - (sig.length % 64)) % 64);
  return head + offset + len + padded;
}

/**
 * The calldata a ticket-checking router reads: `data ‖ abi.encode(ticket, signature) ‖ uint32 len ‖ 0x900bc3e1`.
 * The ticket's subject is over `data` (the body) only. Identical to TollAllow.encodeSuffix in toll-allow.
 */
export function appendTicketSuffix(data: Hex, ticket: AllowTicket, signature: Hex): Hex {
  const body = hexBody(data, "data");
  const enc = encodeTicketAndSig(ticket, signature);
  const n = enc.length / 2;
  if (n >= 2 ** 32) throw new RangeError("ticket encoding too long");
  return `0x${body}${enc}${n.toString(16).padStart(8, "0")}${TICKET_SUFFIX_MAGIC.slice(2)}` as Hex;
}
