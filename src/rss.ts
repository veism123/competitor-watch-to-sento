// Minimal RSS/Atom handling with no dependencies: feed auto-discovery from a
// homepage, and item parsing tolerant of both formats. Pure functions where
// possible so they are testable without the network.

export interface FeedItem {
  title: string;
  link: string;
  publishedAt?: string;
}

// The watcher fetches URLs a team-curated list names. Seatbelt anyway:
// public https web only, never internal addresses.
export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(":")) return false;
  if (!host.includes(".")) return false;
  return true;
}

// <link rel="alternate" type="application/rss+xml" href="..."> in the head,
// either attribute order.
export function discoverFeedUrl(html: string, baseUrl: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of links) {
    if (!/rel=["']alternate["']/i.test(tag)) continue;
    if (!/application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

// Fallback paths tried when the homepage declares no feed.
export const COMMON_FEED_PATHS = [
  "/feed",
  "/rss.xml",
  "/atom.xml",
  "/feed.xml",
  "/blog/rss.xml",
  "/blog/feed",
  "/blog/atom.xml",
  "/changelog/rss.xml",
];

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function firstTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decode(m[1]) : null;
}

// Atom link is an attribute: <link href="..." rel="alternate"/>.
function atomLink(block: string): string | null {
  const links = block.match(/<link\b[^>]*\/?>(?:<\/link>)?/gi) ?? [];
  let fallback: string | null = null;
  for (const tag of links) {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
    if (!href) continue;
    if (/rel=["']alternate["']/i.test(tag) || !/rel=/i.test(tag)) return href;
    fallback = fallback ?? href;
  }
  return fallback;
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = firstTag(block, "title") ?? "(untitled)";
    const isAtom = /^<entry/i.test(block.trim());
    const link = isAtom ? atomLink(block) : firstTag(block, "link") ?? atomLink(block);
    if (!link) continue;
    const published =
      firstTag(block, "pubDate") ?? firstTag(block, "published") ?? firstTag(block, "updated") ?? undefined;
    let publishedAt: string | undefined;
    if (published) {
      const d = new Date(published);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }
    items.push({ title, link: link.trim(), publishedAt });
  }
  return items;
}

// Fallback for the many modern sites with a blog but no feed: scan the blog
// index page for links to posts. A link counts when it resolves to the same
// site and goes deeper than the index itself. New URLs (not yet in the
// moves list) are new posts; titles come from the link text.
export function parseBlogIndexLinks(
  html: string,
  indexUrl: string
): Array<{ title: string; link: string }> {
  const base = new URL(indexUrl);
  const indexPath = base.pathname.replace(/\/$/, "");
  const anchors = html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) ?? [];
  const seen = new Set<string>();
  const out: Array<{ title: string; link: string }> = [];
  for (const a of anchors) {
    const href = a.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let u: URL;
    try {
      u = new URL(href, indexUrl);
    } catch {
      continue;
    }
    if (u.hostname !== base.hostname) continue;
    const path = u.pathname.replace(/\/$/, "");
    if (!path.startsWith(indexPath + "/") || path === indexPath) continue;
    u.hash = "";
    u.search = "";
    const link = u.toString();
    if (seen.has(link)) continue;
    seen.add(link);
    const title = decode(a.replace(/<[^>]+>/g, " "))
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    out.push({ title: title.slice(0, 200), link });
  }
  return out;
}

export const COMMON_BLOG_PATHS = ["/blog", "/changelog", "/news"];
