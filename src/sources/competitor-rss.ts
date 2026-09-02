import type { EntryItem, FeedConfig, Source, SourceItem } from "../types.js";
import { SentoClient } from "../sento.js";
import { loadConfig } from "../config.js";
import {
  competitorsFromEnv,
  loadCompetitors,
  extractFencedBody,
  type Competitor,
} from "../competitors.js";
import { COMMON_FEED_PATHS, discoverFeedUrl, isSafeUrl, parseFeed } from "../rss.js";
import { log } from "../log.js";

// Watches each competitor's blog/changelog feed and relays new posts as
// facts: title, link, date. Never summarizes. The watch list is the
// "Competitors" entity in Sento (or the COMPETITORS env var for local
// runs); the feed URL is the entry's override or auto-discovered from the
// homepage. Coverage is written back into each competitor entry's
// structured data so what is and is not watched stays explicit.
interface Options {
  watchListEntity?: string;
  lookbackDays?: number;
}

function sanitize(raw: string, maxLen: number): string {
  const cleaned = raw
    .split("")
    .map((ch) => {
      if (ch === '"') return "";
      const code = ch.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen).trim() || "(untitled)";
}

async function fetchText(url: string): Promise<string | null> {
  if (!isSafeUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "competitor-watch-to-sento (public feed reader)" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function resolveFeedUrl(c: Competitor): Promise<string | null> {
  if (c.feedOverride) return c.feedOverride;
  const html = await fetchText(c.homepage);
  if (html) {
    const discovered = discoverFeedUrl(html, c.homepage);
    if (discovered && isSafeUrl(discovered)) return discovered;
  }
  for (const path of COMMON_FEED_PATHS) {
    const candidate = new URL(path, c.homepage).toString();
    const body = await fetchText(candidate);
    if (body && (/<item[\s>]/i.test(body) || /<entry[\s>]/i.test(body))) return candidate;
  }
  return null;
}

export const competitorRssSource: Source = {
  async fetch(feed: FeedConfig): Promise<SourceItem[]> {
    const opts = (feed.options ?? {}) as Options;
    const lookbackDays = opts.lookbackDays ?? 14;
    const since = Date.now() - lookbackDays * 86_400_000;

    let competitors = competitorsFromEnv();
    let sento: SentoClient | null = null;
    let listId = "";
    if (!competitors) {
      const config = loadConfig();
      if (!config.sentoMcpUrl || !config.sentoCourierKey) {
        log(`[${feed.name}] no COMPETITORS env and no Sento credentials; nothing to watch`);
        return [];
      }
      sento = new SentoClient(config.sentoMcpUrl, config.sentoCourierKey);
      const watchList = opts.watchListEntity ?? "Competitors";
      listId = await sento.findEntityIdByName(watchList);
      const loaded = await loadCompetitors(sento, watchList);
      competitors = loaded.competitors;
      for (const name of loaded.unwatchable) {
        log(`[${feed.name}] coverage: "${name}" NOT watched (invalid entry; see authoring guide)`);
      }
    }
    log(`[${feed.name}] watching ${competitors.length} competitor(s)`);

    const items: EntryItem[] = [];
    for (const c of competitors) {
      const feedUrl = await resolveFeedUrl(c);
      if (!feedUrl) {
        log(`[${feed.name}] coverage: ${c.name} — no feed found; add a "feed:" override line to its entry`);
        await writeCoverage(sento, listId, c, null);
        continue;
      }
      const xml = await fetchText(feedUrl);
      if (!xml) {
        log(`[${feed.name}] coverage: ${c.name} — feed at ${feedUrl} did not respond`);
        await writeCoverage(sento, listId, c, feedUrl);
        continue;
      }
      const posts = parseFeed(xml);
      const recent = posts.filter((p) => !p.publishedAt || new Date(p.publishedAt).getTime() >= since);
      log(`[${feed.name}] ${c.name}: feed ${feedUrl}, ${posts.length} item(s), ${recent.length} within ${lookbackDays}d`);
      await writeCoverage(sento, listId, c, feedUrl);

      for (const post of recent) {
        if (!isSafeUrl(post.link)) continue;
        const date = (post.publishedAt ?? new Date().toISOString()).slice(0, 10);
        items.push({
          kind: "entry",
          sourceId: post.link,
          name: `${sanitize(c.name, 30)} — ${date} — ${sanitize(post.title, 60)}`.slice(0, 120).trim(),
          body:
            `${c.name} — blog/changelog post — published ${post.publishedAt ?? "date unknown"} — ${post.link}\n\n` +
            `${post.title}`,
          ...(post.publishedAt ? { occurredAt: post.publishedAt.replace(/\.\d+Z$/, "Z") } : {}),
          structured: { source: "competitor-watch", competitor: c.name, url: post.link },
          dedupeKey: post.link,
        });
      }
    }
    return items;
  },
};

// The explicit-coverage promise: each competitor entry's structured data
// says which feed is watched (or that none was found) and when it was last
// checked. Skipped in env-only local runs.
async function writeCoverage(
  sento: SentoClient | null,
  listId: string,
  c: Competitor,
  feedUrl: string | null
): Promise<void> {
  if (!sento || !listId || c.entryId.startsWith("env-")) return;
  try {
    const raw = await sento.readListEntry(listId, c.entryId);
    const body = extractFencedBody(raw);
    if (!body) return;
    await sento.updateListEntry({
      entityId: listId,
      entryId: c.entryId,
      name: c.name,
      body,
      structured: {
        watched_feed: feedUrl,
        feed_watched: feedUrl !== null,
        last_checked: new Date().toISOString(),
        not_tracked: "LinkedIn and private data are never collected",
      },
    });
  } catch (err) {
    log(`[coverage] could not update "${c.name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}
