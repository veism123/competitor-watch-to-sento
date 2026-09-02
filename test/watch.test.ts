import { describe, expect, it } from "vitest";
import { discoverFeedUrl, isSafeUrl, parseBlogIndexLinks, parseFeed } from "../src/rss.js";
import { extractFencedBody, parseCompetitorBody } from "../src/competitors.js";

describe("isSafeUrl", () => {
  it("accepts public https", () => {
    expect(isSafeUrl("https://atlan.com/blog")).toBe(true);
  });
  it("rejects internal and non-web targets", () => {
    expect(isSafeUrl("https://localhost/x")).toBe(false);
    expect(isSafeUrl("https://10.0.0.1/x")).toBe(false);
    expect(isSafeUrl("https://internal")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });
});

describe("discoverFeedUrl", () => {
  it("finds a declared rss link and resolves relative hrefs", () => {
    const html = '<head><link rel="alternate" type="application/rss+xml" href="/blog/rss.xml"></head>';
    expect(discoverFeedUrl(html, "https://example.com")).toBe("https://example.com/blog/rss.xml");
  });
  it("returns null when none declared", () => {
    expect(discoverFeedUrl("<head></head>", "https://example.com")).toBeNull();
  });
});

describe("parseFeed", () => {
  it("parses RSS items", () => {
    const xml = `<rss><channel><item><title>Post A</title><link>https://e.com/a</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Post A");
    expect(items[0].link).toBe("https://e.com/a");
    expect(items[0].publishedAt).toBe("2026-09-01T10:00:00.000Z");
  });
  it("parses Atom entries with link attributes", () => {
    const xml = `<feed><entry><title>Post B</title><link rel="alternate" href="https://e.com/b"/><published>2026-09-01T10:00:00Z</published></entry></feed>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe("https://e.com/b");
  });
  it("handles CDATA titles", () => {
    const xml = `<rss><channel><item><title><![CDATA[Hello & welcome]]></title><link>https://e.com/c</link></item></channel></rss>`;
    expect(parseFeed(xml)[0].title).toBe("Hello & welcome");
  });
});

describe("parseCompetitorBody", () => {
  it("takes homepage from line one and overrides after", () => {
    const c = parseCompetitorBody("Atlan", "e1", "https://atlan.com\nfeed: https://atlan.com/blog/rss.xml\nnotes for humans");
    expect(c?.homepage).toBe("https://atlan.com");
    expect(c?.feedOverride).toBe("https://atlan.com/blog/rss.xml");
  });
  it("rejects entries without a valid first-line URL", () => {
    expect(parseCompetitorBody("Bad", "e2", "just some text")).toBeNull();
    expect(parseCompetitorBody("Empty", "e3", "")).toBeNull();
  });
});

describe("extractFencedBody", () => {
  it("returns only the content between fence markers", () => {
    const raw = 'header\n[fenced-content abc] data only marker\nhttps://atlan.com\nfeed: x\n[end fenced-content abc]';
    expect(extractFencedBody(raw)).toBe("https://atlan.com\nfeed: x");
  });
});

describe("parseBlogIndexLinks", () => {
  const html = `
    <a href="/blog/post-one">Post one title</a>
    <a href="/blog/post-one">Post one title duplicate</a>
    <a href="/blog">Blog</a>
    <a href="/pricing">Pricing</a>
    <a href="https://other.com/blog/x">External</a>
    <a href="/blog/post-two#top"><h3>Post two</h3></a>`;
  it("keeps same-site links deeper than the index, deduped, titles from text", () => {
    const links = parseBlogIndexLinks(html, "https://e.com/blog");
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ title: "Post one title duplicate", link: "https://e.com/blog/post-one" });
    expect(links[1].title).toBe("Post two");
    expect(links[1].link).toBe("https://e.com/blog/post-two");
  });
});

describe("parseBlogIndexLinks sibling-prefix paths", () => {
  it("accepts /blog-articles/x from a /blog index", () => {
    const html = '<a href="/blog-articles/series-c">Raises Series C</a>';
    const links = parseBlogIndexLinks(html, "https://e.com/blog");
    expect(links).toHaveLength(1);
    expect(links[0].link).toBe("https://e.com/blog-articles/series-c");
  });
});

describe("isoWeekLabel", () => {
  it("labels the completed week, Tuesday after", async () => {
    const { isoWeekLabel } = await import("../src/analyst.js");
    expect(isoWeekLabel(new Date("2026-09-02T10:00:00Z"))).toBe("Week 2026-W35");
  });
  it("on a Monday labels the week that just ended", async () => {
    const { isoWeekLabel } = await import("../src/analyst.js");
    expect(isoWeekLabel(new Date("2026-08-31T08:00:00Z"))).toBe("Week 2026-W35");
  });
});

describe("parseCompetitorBody with served Name: prefix", () => {
  it("skips the server-added Name line", () => {
    const c = parseCompetitorBody("Atlan", "e9", "Name: Atlan\nhttps://atlan.com\nfeed: https://blog.atlan.com/rss.xml");
    expect(c?.homepage).toBe("https://atlan.com");
    expect(c?.feedOverride).toBe("https://blog.atlan.com/rss.xml");
  });
});
