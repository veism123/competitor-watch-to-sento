import { log } from "./log.js";

// Optional Slack ping via an incoming webhook (SLACK_WEBHOOK_URL). Used for
// "something finished" moments only: an analyst wrote a brief, a report
// landed. Never for routine cycles. Sento stays the surface of record; the
// ping carries a pointer, not the content. Failures are logged, never fatal.
export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`[notify] slack webhook returned ${res.status}`);
  } catch (err) {
    log(`[notify] slack ping failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
