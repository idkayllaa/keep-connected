// Shared helpers for processing submissions and building the site.
// No dependencies: runs on plain Node 20+.

import fs from "node:fs";
import path from "node:path";

export const SITE_NAME = "Keep Connected";

// Labels here must match the labels in .github/ISSUE_TEMPLATE/*.yml exactly.
export const LABELS = {
  title: "Event name",
  tags: "Event type",
  date: "Date",
  endDate: "End date",
  start: "Start time",
  end: "End time",
  tz: "Time zone",
  where: "Where",
  host: "Hosted by",
  url: "Link to RSVP or join",
  desc: "Short description",
  confirm: "Confirm",
  reportId: "Event number",
  reportReason: "Reason",
  reportDetails: "Details",
};

export const TAGS = {
  "In-person": "inperson",
  "Speaker session": "talk",
  "Company event": "company",
  "Networking": "network",
};

export const TIMEZONES = {
  "Pacific (PT)": { tz: "America/Los_Angeles", short: "PT" },
  "Mountain (MT)": { tz: "America/Denver", short: "MT" },
  "Central (CT)": { tz: "America/Chicago", short: "CT" },
  "Eastern (ET)": { tz: "America/New_York", short: "ET" },
  "UK (London)": { tz: "Europe/London", short: "UK time" },
  "Central Europe (CET)": { tz: "Europe/Berlin", short: "CET" },
  "India (IST)": { tz: "Asia/Kolkata", short: "IST" },
};

export const FEEDS = {
  all: { name: "Keep Connected", filter: () => true },
  inperson: { name: "Keep Connected: in-person", filter: (e) => e.tags.includes("inperson") },
  talk: { name: "Keep Connected: speaker sessions", filter: (e) => e.tags.includes("talk") },
  company: { name: "Keep Connected: company events", filter: (e) => e.tags.includes("company") },
  network: { name: "Keep Connected: networking", filter: (e) => e.tags.includes("network") },
};

// ---------- Issue form parsing ----------

export function parseForm(body) {
  const out = {};
  const text = String(body || "").replace(/\r\n/g, "\n");
  const parts = text.split(/^### /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const label = (nl === -1 ? part : part.slice(0, nl)).trim();
    let value = nl === -1 ? "" : part.slice(nl + 1).trim();
    if (value === "_No response_" || value === "None") value = "";
    out[label] = value;
  }
  return out;
}

export function checkedBoxes(value) {
  return String(value || "")
    .split("\n")
    .map((l) => l.match(/^\s*-\s*[[xX]]\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

const TBD_RE = /^(tbd|tba|to be (determined|announced|decided)|not (set|scheduled) yet)\.?$/i;
export const isTbd = (str) => TBD_RE.test(String(str || "").trim());
const isBlank = (str) => !String(str || "").trim();

export function parseDate(str) {
  const s = String(str || "").trim();
  let y, m, d;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [, y, m, d] = mt.map(Number);
  else if ((mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, m, d, y] = mt.map(Number);
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseTime(str) {
  const s = String(str || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (s === "noon") return "12:00";
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[3] === "p" && h !== 12) h += 12;
    if (m[3] === "a" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return null;
}

// ---------- Time zones ----------

function tzOffsetMs(ts, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ts;
}

export function zonedToUtc(date, time, tz) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - tzOffsetMs(guess, tz);
  return new Date(guess);
}

// ---------- Validation ----------

function nextDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

export function validateSubmission(fields, author, now = new Date()) {
  const errors = [];
  const title = clean(fields[LABELS.title], 200);
  if (!title) errors.push("Add an event name.");
  else if (title.length > 120) errors.push("Keep the event name under 120 characters.");

  const tags = checkedBoxes(fields[LABELS.tags]).map((l) => TAGS[l]).filter(Boolean);
  if (!tags.length) errors.push("Pick at least one event type.");

  const rawDate = fields[LABELS.date];
  const dateTbd = isTbd(rawDate);
  const date = dateTbd ? "" : parseDate(rawDate);
  if (!dateTbd && !date) errors.push("Write the date as YYYY-MM-DD, for example 2026-10-28, or write TBD if it isn't set yet.");

  const rawEndDate = fields[LABELS.endDate];
  let endDate = date;
  if (!isBlank(rawEndDate)) {
    if (!isTbd(rawEndDate)) {
      endDate = parseDate(rawEndDate);
      if (!endDate) errors.push("Write the end date as YYYY-MM-DD, or leave it blank.");
    }
  }
  if (date && endDate && endDate < date) errors.push("The end date cannot be before the start date.");

  const rawStart = fields[LABELS.start], rawEnd = fields[LABELS.end];
  const timeTbd = dateTbd || isBlank(rawStart) || isTbd(rawStart);
  const start = timeTbd ? "" : parseTime(rawStart);
  const endTbd = !timeTbd && (isBlank(rawEnd) || isTbd(rawEnd));
  const end = timeTbd || endTbd ? "" : parseTime(rawEnd);
  if (!timeTbd && !start) errors.push("Write the start time like 10:00 AM or 14:30, or write TBD.");
  if (!timeTbd && !endTbd && !end) errors.push("Write the end time like 11:30 AM or 16:00, or leave it blank.");

  const rawTz = String(fields[LABELS.tz] || "").trim();
  const tzChoice = rawTz ? TIMEZONES[rawTz] : TIMEZONES["Pacific (PT)"];

  const where = clean(fields[LABELS.where], 200);
  if (!where) errors.push('Add a location, or write "Online".');
  else if (where.length > 120) errors.push("Keep the location under 120 characters.");

  const host = clean(fields[LABELS.host], 100);

  const rawUrl = String(fields[LABELS.url] || "").trim();
  let url = "";
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) throw 0;
    url = u.toString();
  } catch {
    errors.push("Add a full link to RSVP or join that starts with https://");
  }
  if (url.length > 500) errors.push("That link is too long.");

  const desc = clean(fields[LABELS.desc], 600);
  if (desc.length > 400) errors.push("Keep the description under 400 characters.");

  if (!checkedBoxes(fields[LABELS.confirm]).length) errors.push("Check the box confirming this is a real event.");

  let startUtc = null, endUtc = null;
  if (!dateTbd && date && tzChoice && (timeTbd || (start && (endTbd || end)))) {
    if (timeTbd) {
      startUtc = zonedToUtc(date, "00:00", tzChoice.tz);
      endUtc = zonedToUtc(nextDay(endDate || date), "00:00", tzChoice.tz);
    } else {
      startUtc = zonedToUtc(date, start, tzChoice.tz);
      endUtc = endTbd ? new Date(startUtc.getTime() + 3600e3) : zonedToUtc(endDate || date, end, tzChoice.tz);
    }
    if (endUtc <= startUtc) errors.push("The end time needs to be after the start time.");
    else if (endUtc < now) errors.push("That event has already ended. Check the date and times.");
    else if (startUtc - now > 366 * 864e5) errors.push("That date is more than a year away. Check the year.");
  }

  if (errors.length) return { errors };
  return {
    errors,
    event: {
      title, host, date, endDate, start, end,
      dateTbd, timeTbd, endTbd,
      tz: tzChoice.tz, tzLabel: tzChoice.short,
      where, tags, url, desc,
      startUtc: startUtc ? startUtc.toISOString() : null,
      endUtc: endUtc ? endUtc.toISOString() : null,
    },
  };
}

// ---------- Data ----------

export function readEvents(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
      catch (e) { console.warn(`Skipping ${f}: ${e.message}`); return null; }
    })
    .filter(Boolean);
}

// ---------- Calendar feeds (iCalendar) ----------

const icsText = (s) => String(s || "")
  .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function toIcs(events, { name, siteUrl, host }) {
  const stamp = icsDate(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Keep Connected//Events//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
    `X-WR-CALDESC:${icsText("Community events, talks, and meetups. " + siteUrl)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    if (e.dateTbd || !e.startUtc) continue;
    const timing = e.timeTbd
      ? [`DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(e.endDate || e.date).replace(/-/g, "")}`]
      : [`DTSTART:${icsDate(e.startUtc)}`, `DTEND:${icsDate(e.endUtc)}`];
    const note = e.timeTbd ? "Time to be announced." : e.endTbd ? "End time to be announced." : "";
    const details = [note, e.desc, e.host ? `Hosted by ${e.host}` : "", `RSVP or join: ${e.url}`, `More events: ${siteUrl}`].filter(Boolean).join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:keep-connected-${e.id}@${host}`,
      `DTSTAMP:${stamp}`,
      ...timing,
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(details)}`,
      `LOCATION:${icsText(e.where)}`,
      `URL:${e.url}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
