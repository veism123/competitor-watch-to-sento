import { SentoClient } from "./sento.js";

// A get_entity response wraps content in [fenced-content <id>] ... [end
// fenced-content <id>] markers. Return only the content between them.
export function extractFencedBody(raw: string): string | null {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => l.startsWith("[fenced-content"));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("[end fenced-content"));
  if (end === -1) return null;
  return lines.slice(start + 1, end).join("\n").trim();
}
import { isSafeUrl } from "./rss.js";
import { log } from "./log.js";

// The watch list lives in Sento: the "Competitors" list entity, one entry
// per company, homepage URL on the body's first line, optional override
// lines (feed:, careers:, pricing:) after it — per that entity's authoring
// guide. Reading it every cycle is what makes adding a competitor a
// no-deploy operation.
export interface Competitor {
  name: string;
  entryId: string;
  homepage: string;
  feedOverride?: string;
  careersOverride?: string;
  pricingOverride?: string;
}

export function parseCompetitorBody(name: string, entryId: string, body: string): Competitor | null {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  // The server prepends a "Name: ..." display line when serving an entry
  // body (verified live 2026-09-02); the authored content starts after it.
  if (lines[0]?.toLowerCase().startsWith("name:")) lines.shift();
  if (lines.length === 0 || !isSafeUrl(lines[0])) return null;
  const competitor: Competitor = { name, entryId, homepage: lines[0] };
  for (const line of lines.slice(1)) {
    const m = line.match(/^(feed|careers|pricing):\s*(\S+)$/i);
    if (!m || !isSafeUrl(m[2])) continue;
    const key = m[1].toLowerCase();
    if (key === "feed") competitor.feedOverride = m[2];
    if (key === "careers") competitor.careersOverride = m[2];
    if (key === "pricing") competitor.pricingOverride = m[2];
  }
  return competitor;
}

// Local/dry runs can bypass Sento: COMPETITORS="Atlan|https://atlan.com,Dust|https://dust.tt"
export function competitorsFromEnv(): Competitor[] | null {
  const v = process.env.COMPETITORS;
  if (!v) return null;
  return v
    .split(",")
    .map((pair, i) => {
      const [name, url] = pair.split("|").map((s) => s.trim());
      if (!name || !url || !isSafeUrl(url)) return null;
      return { name, entryId: `env-${i}`, homepage: url };
    })
    .filter((c): c is Competitor => c !== null);
}

export async function loadCompetitors(
  sento: SentoClient,
  watchListEntity: string
): Promise<{ competitors: Competitor[]; unwatchable: string[] }> {
  const listId = await sento.findEntityIdByName(watchListEntity);
  const index = await sento.readEntity(listId);
  const entries = [...index.matchAll(/"([^"]+)" \(entry_id: ([0-9a-f-]{36})\)/g)];
  const competitors: Competitor[] = [];
  const unwatchable: string[] = [];
  for (const [, name, entryId] of entries) {
    const raw = await sento.readListEntry(listId, entryId);
    const body = extractFencedBody(raw) ?? "";
    const parsed = parseCompetitorBody(name, entryId, body);
    if (parsed) competitors.push(parsed);
    else {
      unwatchable.push(name);
      log(`[competitors] "${name}" is unwatchable: first body line must be a public https URL`);
    }
  }
  return { competitors, unwatchable };
}
