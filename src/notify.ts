import { log } from "./log.js";

// Optional Slack ping for "something finished" moments only: an analyst
// wrote a brief, a report landed. Never for routine cycles. Sento stays the
// surface of record; the ping carries a pointer, not the content.
//
// Uses the team's existing Slack bot: set SLACK_BOT_TOKEN (the sento-slackbot
// Bot User OAuth Token, xoxb-...) and SLACK_CHANNEL (a channel id like
// C0123456789, or a user id to DM). SLACK_WEBHOOK_URL is the fallback for
// teams without a bot. Failures are logged, never fatal.
export async function notifySlack(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL;
  try {
    if (token && channel) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, text }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!body.ok) log(`[notify] slack postMessage failed: ${body.error ?? res.status}`);
      return;
    }
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) return;
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
