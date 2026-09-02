// Read-only preflight: connects with the courier key and, for every feed in
// feeds.json, resolves the target entity and prints its authoring guide.
// Validates MCP connectivity and the key's standing without writing anything.
import { loadConfig } from "./config.js";
import { SentoClient } from "./sento.js";
import { loadFeeds } from "./feeds.js";

const config = loadConfig();
const feeds = loadFeeds();
const sento = new SentoClient(config.sentoMcpUrl, config.sentoCourierKey);
for (const feed of feeds) {
  const entityId = await sento.findEntityIdByName(feed.targetEntity);
  console.log(`\n=== [${feed.name}] "${feed.targetEntity}" -> ${entityId} ===\n`);
  console.log(await sento.readAuthoringGuide(entityId));
}
process.exit(0);
