import type { FeedConfig, Source } from "./types.js";
import { SentoClient } from "./sento.js";
import { competitorRssSource } from "./sources/competitor-rss.js";
import { runAllFeeds as runAllFeedsCore } from "./pipeline-core.js";

export { latestObservedAt } from "./pipeline-core.js";

export const SOURCES: Record<string, Source> = {
  "competitor-rss": competitorRssSource,
};

export async function runAllFeeds(
  feeds: FeedConfig[],
  sento: SentoClient | null,
  dryRun: boolean
): Promise<void> {
  return runAllFeedsCore(feeds, sento, dryRun, SOURCES);
}
