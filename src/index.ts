import { loadConfig } from "./config.js";
import { SentoClient } from "./sento.js";
import { runAllFeeds } from "./pipeline.js";
import { loadFeeds } from "./feeds.js";
import { runAnalyst } from "./analyst.js";
import { log, logError } from "./log.js";

const config = loadConfig();
const once = process.argv.includes("--once");

const feeds = loadFeeds();
const hourlyFeeds = feeds.filter((f) => (f.schedule ?? "hourly") === "hourly");
const dailyFeeds = feeds.filter((f) => f.schedule === "daily");

const sento = config.dryRun ? null : new SentoClient(config.sentoMcpUrl, config.sentoCourierKey);

// Daily feeds run once per UTC day, on the first cycle after 07:00 UTC.
// The analyst runs Mondays after 07:00 UTC; its entry-name dedupe makes
// restarts harmless. Markers are process memory only: a restart re-runs
// at most once, which dedupe absorbs.
let lastDailyDate = "";
let lastAnalystDate = "";

async function cycle(): Promise<void> {
  try {
    await runAllFeeds(hourlyFeeds, sento, config.dryRun);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (dailyFeeds.length > 0 && today !== lastDailyDate && now.getUTCHours() >= 7) {
      lastDailyDate = today;
      await runAllFeeds(dailyFeeds, sento, config.dryRun);
    }
    if (now.getUTCDay() === 1 && now.getUTCHours() >= 7 && today !== lastAnalystDate) {
      lastAnalystDate = today;
      try {
        await runAnalyst();
      } catch (err) {
        logError("analyst run failed (collector continues)", err);
      }
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
} else if (process.env.RUN_ANALYST_ON_BOOT === "true") {
  // One-shot cloud trigger for a supervised analyst run: set the env var,
  // redeploy, read the brief, remove the var. The weekly dedupe still
  // applies, so leaving it set cannot produce duplicate briefs.
  log("RUN_ANALYST_ON_BOOT is set: running the analyst now");
  try {
    await runAnalyst();
  } catch (err) {
    logError("analyst run failed (collector continues)", err);
  }
  await cycle();
  setInterval(cycle, config.pollMinutes * 60_000);
} else {
  await cycle();
  setInterval(cycle, config.pollMinutes * 60_000);
}
