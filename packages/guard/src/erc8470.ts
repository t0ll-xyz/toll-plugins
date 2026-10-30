/**
 * ERC-8470 Launch Observations: Toll's latest on-chain observation of a token on Robinhood Chain, read with plain
 * JSON-RPC eth_call and hand-written ABI decoding (no viem / ethers). Registry and detector are the reference
 * deployment (PR https://github.com/ethereum/ERCs/pull/2121).
 *
 * NOT READ IS NOT ZERO: type(uint256).max means the detector did not read that finding; it surfaces as `null`
 * (notRead: true), never as 0.
 */
import type { FetchLike } from "./check.js";

export const OBS_REGISTRY = "0x730e3c356299c9203cb042f6c0a9274aeabf9af3";
/** Toll's detector wallet (the engine that records observations) */
export const OBS_DETECTOR = "0x02593AbFf31f4E8eC1D5c2F297a347C51ef06E5c";
export const OBS_CHAIN_ID = 4663;
export const RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
/** type(uint256).max */
export const NOT_READ = (1n << 256n) - 1n;

/** selectors, from the compiled LaunchObservations.json methodIdentifiers */
const SEL = {
  getObservation: "f5fec8b1",
  latestByToken: "8c9b1620",
  latestFinding: "cf5fd50d",
} as const;

export type Unit = "bps" | "count" | "label" | "mask" | "seconds";

/** every kind the ERC defines plus Toll's own, by name: keccak256 of the namespaced string, and its unit */
export const FINDING_KINDS: Readonly<Record<string, { id: string; unit: Unit }>> = {
  "first-block-share": { id: "0xf1503018582646f41619eefcdeaae1c1b9ad5e71e1a74f59a7c177cd5d8a1b0c", unit: "bps" },
  "early-buyer-share": { id: "0xde1880e1c55491741e8806f8091354331ccfae6d260de5624fa7b5131f8ab19a", unit: "bps" },
  "creator-prior-launches": { id: "0xb559eb50996235dcc907f3c528e2b0bd21669b438572d50973405b9394544c38", unit: "count" },
  "funding-linked-share": { id: "0xd0f99f8b1f2648a01d4d94c4ac89e81b3f3036b775a02e9d840391fece5b51d0", unit: "bps" },
  "product-label": { id: "0x2af827bba451d4ec3e3a25936a27478e62bf16a8046dfec8f9369f5b9f139345", unit: "label" },
  "text-flags": { id: "0x69c611869dc6d3ce968978b3e0a2a3b7d975d9ab462081222ae451a444230bc5", unit: "mask" },
  "xyz.t0ll.dev-sold-share": { id: "0x0b9baa9f583b056e93eb0a650daaafff3b7aa27fbe9f4243b91f5f4337fbc10a", unit: "bps" },
  "signal.deployerSupplyShare": { id: "0x36da7198a2ed7b9d71cd98db4049dce4bc9fe964562e0d5f3085f915405fa318", unit: "bps" },
  "signal.insiderAllocationShare": { id: "0x03c04aaf168c10242870103dfdc5e913904f5c02b2be34091db637984b72eb72", unit: "bps" },
  "signal.sniperConcentration": { id: "0x3f22e0f440671a38c44563d087b0027456ed5018d1cb21c5e36837aaa21eaf2c", unit: "bps" },
  "signal.lpLockedShare": { id: "0x3c8cfdf5cbd8671de60b2c3e64bd5d69438136cd74cdc340287ba5fd7a836755", unit: "bps" },
  "signal.lpLockRemaining": { id: "0x17c1b81f88b7beaaf5cd4b6fed97887360c13fe178a9f826064c0522c3d69ab2", unit: "seconds" },
  "signal.liquidityRemoved": { id: "0xd0d754e325d16e378c48160ce2a439bc8587980fb9b2f69aa6a4037973ad2f71", unit: "bps" },
  "signal.deployerSellRatio": { id: "0x5dbad0bcd30c444d847c6ae8571340fddcb77cad4ef280497f4196032ba201a4", unit: "bps" },
  "signal.proceedsWithdrawnShare": { id: "0xcf325865161b29692c7e7d30708d3a6b2a7f788ff1859f76720127464e2a9dad", unit: "bps" },
  "signal.privilegedPowers": { id: "0xb6b77a84953f300885ac1de83ad6cb7a3683d87ffbad4dd9963eb7bfc207a6f5", unit: "mask" },
  "signal.priorUpheldClaims": { id: "0x1b8f9350bd49cd3504abfddf158e8726187ddd9b8060a017918c300020e9254d", unit: "count" },
  "signal.supplyInflation": { id: "0xf695c94870a4cb86b0539718a4b7e89ed00257f15b2b7b33829785224bb25cd8", unit: "bps" },
  "signal.washTradeRatio": { id: "0x79cbc6923e1ea8a086a7713aada26f70a0665a99e796b1fa083c2e3046d9abc0", unit: "bps" },
};
const BY_ID = new Map(Object.entries(FINDING_KINDS).map(([name, k]) => [k.id, { name, unit: k.unit }]));

export type Lean = "none" | "clear" | "careful" | "against";
const LEANS: Lean[] = ["none", "clear", "careful", "against"];
export type KeyKind = "none" | "erc8376" | "token" | "erc8462-venue";
const KEY_KINDS: KeyKind[] = ["none", "erc8376", "token", "erc8462-venue"];

export interface Finding8470 {
  /** bytes32 kind id */
  kind: string;
  /** the kind's name when known ("first-block-share", "signal.deployerSellRatio", ...), else null */
  name: string | null;
  unit: Unit | null;
  /** null = not read (type(uint256).max on chain), never 0 */
  value: bigint | null;
  notRead: boolean;
  param: bigint;
  lean: Lean;
}

export interface Observation8470 {
  id: bigint;
  launchKey: string;
  chainId: bigint;
  token: string;
  keyKind: KeyKind;
  observedBlock: bigint;
  hashChecked: boolean;
  detector: string;
  /** unix seconds */
  recordedAt: bigint;
  identityRegistry: string;
  tally: { against: number; careful: number; clear: number };
  agentId: bigint;
  supersedes: bigint;
  reportHash: string;
  evidenceRoot: string;
  declarationId: string;
  reportURI: string;
  findings: Finding8470[];
}

export interface Read8470Options {
  rpcUrl?: string;
  registry?: string;
  detector?: string;
  chainId?: number | bigint;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/* ------------------------------------------------------------------ ABI, by hand */

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;
const word = (n: bigint) => {
  if (n < 0n || n > NOT_READ) throw new RangeError("uint256 out of range");
  return n.toString(16).padStart(64, "0");
};
const addrWord = (a: string) => {
  if (!ADDR.test(a)) throw new TypeError(`not an address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, "0");
};

export const encodeLatestByToken = (chainId: bigint, token: string, detector: string) => `0x${SEL.latestByToken}${word(chainId)}${addrWord(token)}${addrWord(detector)}`;
export const encodeGetObservation = (id: bigint) => `0x${SEL.getObservation}${word(id)}`;
export const encodeLatestFinding = (chainId: bigint, token: string, detector: string, kind: string, param: bigint) => {
  if (!B32.test(kind)) throw new TypeError(`kind must be bytes32 hex: ${kind}`);
  if (param < 0n || param >= 1n << 64n) throw new RangeError("param must fit uint64");
  return `0x${SEL.latestFinding}${word(chainId)}${addrWord(token)}${addrWord(detector)}${kind.slice(2).toLowerCase()}${word(param)}`;
};

/** a reader over 32-byte words of ABI-encoded return data */
class Reader {
  private readonly hex: string;
  constructor(data: string) {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new TypeError("return data is not hex");
    this.hex = data.slice(2);
  }
  /** the 32-byte word at a byte offset */
  w(byteOff: number): string {
    const s = this.hex.slice(byteOff * 2, byteOff * 2 + 64);
    if (s.length !== 64) throw new RangeError(`return data too short at byte ${byteOff}`);
    return s;
  }
  uint(byteOff: number): bigint {
    return BigInt("0x" + this.w(byteOff));
  }
  num(byteOff: number, max = 2 ** 32): number {
    const n = this.uint(byteOff);
    if (n > BigInt(max)) throw new RangeError(`value too large at byte ${byteOff}`);
    return Number(n);
  }
  addr(byteOff: number): string {
    return "0x" + this.w(byteOff).slice(24);
  }
  b32(byteOff: number): string {
    return "0x" + this.w(byteOff);
  }
  bool(byteOff: number): boolean {
    return this.uint(byteOff) !== 0n;
  }
  string(byteOff: number): string {
    const len = this.num(byteOff, 1 << 20);
    const s = this.hex.slice((byteOff + 32) * 2, (byteOff + 32 + len) * 2);
    if (s.length !== len * 2) throw new RangeError("string runs past the return data");
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder().decode(bytes);
  }
}

const leanOf = (n: number): Lean => LEANS[n] ?? "none";

function finding(kind: string, value: bigint, param: bigint, lean: number): Finding8470 {
  const k = BY_ID.get(kind.toLowerCase());
  const notRead = value === NOT_READ;
  return { kind, name: k?.name ?? null, unit: k?.unit ?? null, value: notRead ? null : value, notRead, param, lean: leanOf(lean) };
}

/** decodes getObservation(uint256)'s return: (Observation, Finding[]) */
export function decodeGetObservation(data: string, id: bigint): Observation8470 {
  const r = new Reader(data);
  const o = r.num(0, 1 << 24);
  const f = r.num(32, 1 << 24);
  const at = (i: number) => o + i * 32;
  const keyKind = r.num(at(3), 255);
  const obs: Observation8470 = {
    id,
    launchKey: r.b32(at(0)),
    chainId: r.uint(at(1)),
    token: r.addr(at(2)),
    keyKind: KEY_KINDS[keyKind] ?? "none",
    observedBlock: r.uint(at(4)),
    hashChecked: r.bool(at(5)),
    detector: r.addr(at(6)),
    recordedAt: r.uint(at(7)),
    identityRegistry: r.addr(at(8)),
    tally: { against: r.num(at(9), 65535), careful: r.num(at(10), 65535), clear: r.num(at(11), 65535) },
    agentId: r.uint(at(12)),
    supersedes: r.uint(at(13)),
    reportHash: r.b32(at(14)),
    evidenceRoot: r.b32(at(15)),
    declarationId: r.b32(at(16)),
    reportURI: r.string(o + r.num(at(17), 1 << 24)),
    findings: [],
  };
  const n = r.num(f, 64);
  for (let i = 0; i < n; i++) {
    const b = f + 32 + i * 128;
    obs.findings.push(finding(r.b32(b), r.uint(b + 32), r.uint(b + 64), r.num(b + 96, 255)));
  }
  return obs;
}

/* ------------------------------------------------------------------ RPC */

async function ethCall(to: string, data: string, o: Read8470Options): Promise<string> {
  const f = o.fetch ?? (globalThis.fetch as FetchLike);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 10_000);
  try {
    const res = await f(o.rpcUrl ?? RH_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`RPC answered HTTP ${res.status}`);
    const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(`eth_call failed: ${j.error.message ?? "error"}`);
    if (typeof j.result !== "string") throw new Error("eth_call returned no result");
    return j.result;
  } finally {
    clearTimeout(timer);
  }
}

const kindId = (kind: string) => FINDING_KINDS[kind]?.id ?? kind;

/**
 * Toll's latest ERC-8470 observation of a token: latestByToken(chainId, token, detector), then getObservation(id).
 * null when the detector has no observation of the token (id 0). Throws on an RPC failure (a failed read is not
 * "no observation").
 */
export async function read8470(token: string, opts: Read8470Options = {}): Promise<Observation8470 | null> {
  const registry = opts.registry ?? OBS_REGISTRY;
  const id = BigInt(await ethCall(registry, encodeLatestByToken(BigInt(opts.chainId ?? OBS_CHAIN_ID), token, opts.detector ?? OBS_DETECTOR), opts));
  if (id === 0n) return null;
  return decodeGetObservation(await ethCall(registry, encodeGetObservation(id), opts), id);
}

export interface LatestFinding8470 {
  observationId: bigint;
  observedBlock: bigint;
  recordedAt: bigint;
  /** null = not read (no observation, or the observation did not read this kind), never 0 */
  value: bigint | null;
  notRead: boolean;
  lean: Lean;
}

/** decodes latestFinding's fixed-size return (uint256, uint64, uint64, uint256, uint8) */
export function decodeLatestFinding(data: string): LatestFinding8470 {
  const r = new Reader(data);
  const value = r.uint(96);
  return { observationId: r.uint(0), observedBlock: r.uint(32), recordedAt: r.uint(64), value: value === NOT_READ ? null : value, notRead: value === NOT_READ, lean: leanOf(r.num(128, 255)) };
}

/** One finding of Toll's latest observation of a token: latestFinding(chainId, token, detector, kind, param). */
export async function latestFinding8470(token: string, kind: string, param: number | bigint = 0, opts: Read8470Options = {}): Promise<LatestFinding8470> {
  const data = encodeLatestFinding(BigInt(opts.chainId ?? OBS_CHAIN_ID), token, opts.detector ?? OBS_DETECTOR, kindId(kind), BigInt(param));
  return decodeLatestFinding(await ethCall(opts.registry ?? OBS_REGISTRY, data, opts));
}
