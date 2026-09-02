import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { SentoClient } from "./sento.js";
import { log, logError } from "./log.js";

// The weekly analyst: the one place in this service that calls a model.
// It reads the week's collected Competitor moves and the watch list from
// Sento, searches the web for what companies do not self-announce
// (funding, headcount), and writes one cited "Competitive brief" entry.
// The collector never interprets; the analyst never collects beyond its
// cited searches. Skipped entirely when ANTHROPIC_API_KEY is unset.

const BRIEF_ENTITY = process.env.BRIEF_ENTITY ?? "Competitive brief";
// Cost controls. The analyst runs at most once per week (the entry-name
// dedupe enforces it); these bound what one run may spend. Rough ceiling
// per run at defaults: ~30 searches ($0.01 each) plus input/output tokens,
// typically well under $1. Actual usage is logged after every run.
const MAX_SEARCHES = Number(process.env.ANALYST_MAX_SEARCHES ?? "30");
const MAX_OUTPUT_TOKENS = Number(process.env.ANALYST_MAX_TOKENS ?? "16000");
const MOVES_ENTITY = process.env.MOVES_ENTITY ?? "Competitor moves";
const WATCHLIST_ENTITY = process.env.WATCHLIST_ENTITY ?? "Competitors";

export function isoWeekLabel(now: Date): string {
  // ISO week of the week that just ended (the most recent completed week).
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day); // last Sunday = end of completed week
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - 3); // Thursday of that ISO week
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `Week ${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function runAnalyst(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log("[analyst] skipping: ANTHROPIC_API_KEY is not set");
    return;
  }
  const config = loadConfig();
  if (!config.sentoMcpUrl || !config.sentoCourierKey) {
    log("[analyst] skipping: Sento credentials are not set");
    return;
  }
  const sento = new SentoClient(config.sentoMcpUrl, config.sentoCourierKey);

  const briefId = await sento.findEntityIdByName(BRIEF_ENTITY);
  const entryName = `${isoWeekLabel(new Date())} competitive brief`;
  const briefIndex = await sento.readEntity(briefId);
  if (briefIndex.includes(entryName)) {
    log(`[analyst] "${entryName}" already exists, skipping`);
    return;
  }

  const movesId = await sento.findEntityIdByName(MOVES_ENTITY);
  const movesIndex = await sento.readEntity(movesId);
  const watchlistId = await sento.findEntityIdByName(WATCHLIST_ENTITY);
  const watchlist = await sento.readEntity(watchlistId);
  const guide = await sento.readAuthoringGuide(briefId);

  const systemPrompt = readFileSync(
    fileURLToPath(new URL("../ANALYST.md", import.meta.url)),
    "utf8"
  );
  const task =
    `Write the "${entryName}" entry.\n\n` +
    `## The watch list (Competitors entity)\n${watchlist}\n\n` +
    `## Collected moves (Competitor moves entry index, newest first)\n${movesIndex}\n\n` +
    `## The entry's authoring guide\n${guide}\n\n` +
    `Today is ${new Date().toISOString().slice(0, 10)}. Research and write the brief now.`;

  // Identity-linked API keys require the workspace id on every request.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: task }];
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  // Web-search turns can pause (stop_reason "pause_turn"); resume by
  // pushing the paused assistant turn back, bounded to avoid loops.
  for (let attempt = 0; attempt < 6; attempt++) {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5",
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }],
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
    });
    const message = await stream.finalMessage();
    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "refusal") {
      logError("[analyst] the model declined the request", message.stop_details);
      return;
    }
    text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    break;
  }
  // Visible spend: Opus 5 is $5/M input, $25/M output; searches $10/1000.
  const estUsd = (inputTokens * 5 + outputTokens * 25) / 1_000_000 + MAX_SEARCHES * 0.01;
  log(`[analyst] usage: ${inputTokens} in / ${outputTokens} out tokens, run cost at most ~$${estUsd.toFixed(2)}`);
  if (!text) {
    logError("[analyst] no brief text produced", null);
    return;
  }

  if (config.dryRun) {
    log(`[analyst] DRY RUN would write "${entryName}"`, { bodyChars: text.length });
    log(text.slice(0, 1500));
    return;
  }
  const result = await sento.writeListEntry({
    entityId: briefId,
    name: entryName,
    body: text,
    structured: { source: "competitor-watch-analyst", model: "claude-opus-5" },
  });
  log(`[analyst] wrote "${entryName}"`, { server: result.slice(0, 160) });
}
