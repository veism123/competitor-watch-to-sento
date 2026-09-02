// A feed is one source-to-entity pipe: which source module, which API key
// (named by env var, never by value), which Sento entity receives the items,
// and source-specific options. Feeds are declared in feeds.json.
export interface FeedConfig {
  name: string;
  source: string;
  targetEntity: string;
  // Env var holding the source's API key. Omit for sources that need none
  // (public-web fetchers); the source then receives an empty string.
  apiKeyEnv?: string;
  // Which cron schedule runs this feed (default "hourly"). Local runs
  // (npm run once / dev) always run every feed.
  schedule?: "hourly" | "daily";
  options?: Record<string, unknown>;
}

// What every source hands the pipeline: ready-to-write items. The source
// owns fetching and composition; the pipeline owns dedupe and the gate write.
export interface EntryItem {
  kind: "entry";
  sourceId: string;
  name: string;
  body: string;
  occurredAt?: string;
  structured?: Record<string, unknown>;
  // What must not already appear in the target's entry index for this item
  // to be written. Defaults to the item name.
  dedupeKey?: string;
}

// One dated observation for a metric entity, recorded verbatim as the
// source returned it. Dedupe is a high-water mark: a metric read shows its
// latest observed_at, and only observations after it are written.
export interface ObservationItem {
  kind: "observation";
  sourceId: string;
  value: number | string;
  observedAt: string;
}

export type SourceItem = EntryItem | ObservationItem;

export interface Source {
  fetch(feed: FeedConfig, apiKey: string): Promise<SourceItem[]>;
}
