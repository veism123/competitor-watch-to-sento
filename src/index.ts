import { loadConfig } from "./config.js";
import { SentoClient } from "./sento.js";
import { runAllFeeds } from "./pipeline.js";
import { loadFeeds } from "./feeds.js";
import { log, logError } from "./log.js";

const config = loadConfig();
const once = process.argv.includes("--once");

const feeds = loadFeeds();
const hourlyFeeds = feeds.filter((f) => (f.schedule ?? "hourly") === "hourly");
const dailyFeeds = feeds.filter((f) => f.schedule === "daily");

const sento = config.dryRun ? null : new SentoClient(config.sentoMcpUrl, config.sentoCourierKey);

// Daily feeds run once per UTC day, on the first cycle after 07:00 UTC —
// after the sources have complete data for yesterday. The marker is process
// memory only: a restart re-runs them once, which dedupe makes harmless.
let lastDailyDate = "";

async function cycle(): Promise<void> {
  try {
    await runAllFeeds(hourlyFeeds, sento, config.dryRun);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (dailyFeeds.length > 0 && today !== lastDailyDate && now.getUTCHours() >= 7) {
      lastDailyDate = today;
      await runAllFeeds(dailyFeeds, sento, config.dryRun);
    }
  } catch (err) {
    logError("cycle failed", err);
  }
}

log(
  `sento-courier starting: dryRun=${config.dryRun}, poll=${config.pollMinutes}m, ` +
    `hourly=[${hourlyFeeds.map((f) => f.name).join(", ")}], daily=[${dailyFeeds.map((f) => f.name).join(", ")}]`
);
if (once) {
  // Supervision runs everything, schedules ignored.
  await runAllFeeds(feeds, sento, config.dryRun);
} else {
  await cycle();
  setInterval(cycle, config.pollMinutes * 60_000);
}
