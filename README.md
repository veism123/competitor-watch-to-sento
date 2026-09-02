# Competitor watch to Sento

A radar on your competitors that files what it finds in your Sento
workspace, where your whole team and every AI tool they use can read it.

The watch list lives in Sento itself: a "Competitors" list entity, one
entry per company with its homepage URL. Adding a competitor is adding an
entry — from the console or by asking your AI — with no redeploy and no
code. Each daily cycle this service reads that list, finds each company's
blog or changelog feed (auto-discovered, or a "feed:" override line in the
entry), and appends every new post to a "Competitor moves" list: date,
title, link, verbatim. Never analysis, never the same post twice.

What is watched stays explicit: after every cycle each competitor's entry
carries a coverage report in its structured data — which feed is watched,
when it was last checked, and that LinkedIn and private data are never
collected. A company with no findable feed is reported as not watched,
loudly, rather than silently skipped.

A courier, not an analyst: no model calls in this service today. The
weekly analysis layer (funding and headcount search, the "Competitive
brief") is the next slice and will run here with your own Anthropic API
key.

## Setup

Three list entities in your Sento workspace: "Competitors" (the watch
list, with its authoring guide defining the entry format), "Competitor
moves", and "Competitive brief". Grant your courier connection read+write
on all three.

```bash
npm install
npm test
cp .env.example .env   # fill in; .env is gitignored
COMPETITORS="Acme|https://acme.com" npm run once   # local dry run, no Sento needed
npm run once           # dry run against your real watch list
```

`DRY_RUN=true` (default) logs what would be written. Flip to `false`
after reviewing a cycle. Deploy as an always-on worker (`npm start`) on
any modern host; feeds are checked daily after 07:00 UTC.
