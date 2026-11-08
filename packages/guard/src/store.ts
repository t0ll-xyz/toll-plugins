/**
 * Where the guard keeps its spend counters and the x402 payment ids it has paid. The default MemorySpendStore lives in
 * this process: it resets on restart and is not shared between processes. Pass your own SpendStore (Redis, a database)
 * for counters that survive restarts or span several workers.
 */

export interface SpendStore {
  /**
   * Reserves `amt` under key `k` in the window starting at `windowStart` (ms, UTC). ok when committed + pending + amt
   * stays within `limit`; `used` is committed + pending after the call. Must be atomic per key.
   */
  reserve(k: string, amt: bigint, limit: bigint, windowStart: number): Promise<{ ok: boolean; id: string; used: bigint }>;
  /** the reservation was spent: it stays counted */
  commit(id: string): Promise<void>;
  /** the reservation was not spent (refused, the send threw): it no longer counts */
  release(id: string): Promise<void>;
  /** true when this x402 payment id was paid within its TTL */
  paymentSeen(id: string): Promise<boolean>;
  markPaid(id: string, ttlS: number): Promise<void>;
}

/** the start of the UTC day holding `t` (ms) */
export const dayStart = (t: number): number => t - (((t % 86_400_000) + 86_400_000) % 86_400_000);

interface Bucket {
  committed: bigint;
  pending: Map<string, bigint>;
}

/** an in-process SpendStore: resets on restart, not shared between processes */
export class MemorySpendStore implements SpendStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly where = new Map<string, string>();
  private readonly paid = new Map<string, number>();
  private readonly now: () => number;
  private seq = 0;

  constructor(o: { now?: () => number } = {}) {
    this.now = o.now ?? Date.now;
  }

  private prune(windowStart: number) {
    // windows older than the previous day are dropped
    for (const b of this.buckets.keys()) {
      const ws = Number(b.slice(b.lastIndexOf("@") + 1));
      if (ws < windowStart - 86_400_000) this.buckets.delete(b);
    }
  }

  async reserve(k: string, amt: bigint, limit: bigint, windowStart: number): Promise<{ ok: boolean; id: string; used: bigint }> {
    // no await before the check and the write: atomic within this process
    const bk = `${k}@${windowStart}`;
    let b = this.buckets.get(bk);
    if (!b) {
      this.prune(windowStart);
      b = { committed: 0n, pending: new Map() };
      this.buckets.set(bk, b);
    }
    let used = b.committed;
    for (const v of b.pending.values()) used += v;
    if (amt < 0n || used + amt > limit) return { ok: false, id: "", used };
    const id = `r${++this.seq}`;
    b.pending.set(id, amt);
    this.where.set(id, bk);
    return { ok: true, id, used: used + amt };
  }

  async commit(id: string): Promise<void> {
    const bk = this.where.get(id);
    const b = bk ? this.buckets.get(bk) : undefined;
    this.where.delete(id);
    const v = b?.pending.get(id);
    if (!b || v === undefined) return;
    b.pending.delete(id);
    b.committed += v;
  }

  async release(id: string): Promise<void> {
    const bk = this.where.get(id);
    this.where.delete(id);
    if (bk) this.buckets.get(bk)?.pending.delete(id);
  }

  async paymentSeen(id: string): Promise<boolean> {
    const until = this.paid.get(id);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.paid.delete(id);
      return false;
    }
    return true;
  }

  async markPaid(id: string, ttlS: number): Promise<void> {
    const t = this.now();
    for (const [k, until] of this.paid) if (until <= t) this.paid.delete(k);
    this.paid.set(id, t + ttlS * 1000);
  }
}
