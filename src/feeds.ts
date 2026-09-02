import { createRequire } from "node:module";
import type { FeedConfig } from "./types.js";

// require() so bundlers (Vercel's file tracing included) see the static
// dependency and ship feeds.json with the function.
const require = createRequire(import.meta.url);

export function loadFeeds(): FeedConfig[] {
  return require("../feeds.json") as FeedConfig[];
}
