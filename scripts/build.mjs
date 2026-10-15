// Builds the website into _site/: the page, events.json, and calendar feeds.
import fs from "node:fs";
import path from "node:path";
import { readEvents, toIcs, FEEDS, TAGS } from "./lib.mjs";

const OUT = "_site";
const repoFull = process.env.GITHUB_REPOSITORY || "idkayllaa/keep-connected";
const [owner, repo] = repoFull.split("/");
const host = `${owner.toLowerCase()}.github.io`;
const siteUrl = `https://${host}/${repo}/`;
const knownTags = new Set(Object.values(TAGS));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "feeds"), { recursive: true });
fs.cpSync("site", OUT, { recursive: true });

const events = readEvents("data/events")
  .filter((e) => !e.hidden && e.title && (e.dateTbd || (e.startUtc && e.endUtc)))
  .map((e) => ({
    id: e.id, title: e.title, host: e.host, date: e.date || "", start: e.start || "", end: e.end || "",
    dateTbd: !!e.dateTbd, timeTbd: !!e.timeTbd, endTbd: !!e.endTbd,
    tz: e.tz, tzLabel: e.tzLabel, where: e.where,
    tags: (e.tags || []).filter((t) => knownTags.has(t)),
    url: e.url, desc: e.desc || "", startUtc: e.startUtc || null, endUtc: e.endUtc || null,
  }))
  .sort((a, b) => (a.startUtc || "9999").localeCompare(b.startUtc || "9999") || a.id - b.id);

fs.writeFileSync(path.join(OUT, "events.json"),
  JSON.stringify({ updated: new Date().toISOString(), events }, null, 2));

for (const [key, feed] of Object.entries(FEEDS)) {
  fs.writeFileSync(path.join(OUT, "feeds", `${key}.ics`),
    toIcs(events.filter(feed.filter), { name: feed.name, siteUrl, host }));
}

console.log(`Built ${events.length} events into ${OUT}/ for ${siteUrl}`);
