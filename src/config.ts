import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load .courier/.env when present (local runs). Real environment variables
// take precedence, so deploy hosts that set vars directly are unaffected.
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Only the runner's own settings live here. Everything feed-specific —
// source, target entity, filter options, lookback — lives in feeds.json,
// and each feed names the env var holding its source API key.
export interface Config {
  sentoMcpUrl: string;
  sentoCourierKey: string;
  pollMinutes: number;
  dryRun: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function loadConfig(): Config {
  const rawDryRun = process.env.DRY_RUN;
  console.log(`[config] DRY_RUN raw value: ${rawDryRun === undefined ? "NOT SET" : JSON.stringify(rawDryRun)}`);
  const dryRun = !/^\s*false\s*$/i.test(rawDryRun ?? "");
  return {
    // Sento vars are only required once we intend to write.
    sentoMcpUrl: dryRun ? process.env.SENTO_MCP_URL ?? "" : required("SENTO_MCP_URL"),
    sentoCourierKey: dryRun ? process.env.SENTO_COURIER_KEY ?? "" : required("SENTO_COURIER_KEY"),
    pollMinutes: Number(process.env.POLL_MINUTES ?? "60"),
    dryRun,
  };
}
