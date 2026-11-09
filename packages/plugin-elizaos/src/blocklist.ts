import type { BlocklistEntry, Toll } from "@tollxyz/sdk";

/** Where the full list lives (JSON; ?format=csv or ?format=txt for the files). */
export const BLOCKLIST_URL = "https://t0ll.xyz/api/blocklist";

/**
 * Toll's open blocklist as text: whether `address` is listed (with its reasons, dates and evidence page), or the newest
 * `limit` entries when no address is given. A coin that is not listed is not cleared.
 */
export async function blocklistText(client: Toll, address?: string, limit = 10): Promise<string> {
  const r = await client.blocklist();
  if (r.notModified) return `Toll's blocklist has not changed since the last pull. ${BLOCKLIST_URL}`;
  const list = r.list;
  const reason = (code: string) => (list.reasons?.[code] ? `${code} (${list.reasons[code]})` : code);
  const line = (e: BlocklistEntry) =>
    [
      `${e.address} (${e.kind}${e.symbol ? `, symbol "${e.symbol}"` : ""})`,
      `reasons: ${e.reasons.map(reason).join("; ") || "none named"}`,
      `first seen ${e.first_seen}, last confirmed ${e.last_confirmed}`,
      `facts: ${e.evidence}`,
      ...(e.tx ? [`tx: ${e.tx}`] : []),
    ].join(" | ");
  const head = `Toll's open blocklist (Robinhood Chain): ${list.count} entries, generated ${list.generated_at}.`;
  if (address) {
    const hit = list.entries.find((e) => e.address.toLowerCase() === address.toLowerCase());
    return hit
      ? `${head}\n\n${address} is listed:\n${line(hit)}\n\n${BLOCKLIST_URL}`
      : `${head}\n\n${address} is not on the list. A coin that is not listed is not cleared: check it with TOLL_CHECK_COIN.\n\n${BLOCKLIST_URL}`;
  }
  const newest = [...list.entries].sort((a, b) => (a.last_confirmed < b.last_confirmed ? 1 : a.last_confirmed > b.last_confirmed ? -1 : 0)).slice(0, limit);
  if (newest.length === 0) return `${head}\n\n${BLOCKLIST_URL}`;
  return `${head}\n\nNewest ${newest.length} by last confirmed:\n${newest.map(line).join("\n")}\n\nThe full list (JSON, CSV, TXT): ${BLOCKLIST_URL}`;
}
