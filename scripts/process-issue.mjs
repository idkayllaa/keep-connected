// Runs in GitHub Actions when an issue is opened or edited, or a comment is added.
// - "Submit an event" issues are validated and published as data/events/<issue number>.json
// - "Report a listing" issues add a report; 3 reports hide a listing
// - "/remove" commented on an event's issue by its submitter or the repo owner hides it
// Issue text is treated as data only. Nothing from it is ever run as a command.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseForm, validateSubmission, LABELS, SITE_NAME } from "./lib.mjs";

const DATA_DIR = "data/events";
const REPORTS_TO_HIDE = 3;
const MAX_ACTIVE_PER_PERSON = 10;

const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const repoFull = process.env.GITHUB_REPOSITORY;
const [owner, repo] = repoFull.split("/");
const repoOwner = (process.env.GITHUB_REPOSITORY_OWNER || owner).toLowerCase();
const siteUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`;
const token = process.env.GITHUB_TOKEN;
const issue = payload.issue;
const action = payload.action;

let changed = false;

function setOutput() {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

async function gh(method, endpoint, data) {
  const res = await fetch(`https://api.github.com/repos/${repoFull}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) console.error(`GitHub API ${method} ${endpoint} failed: ${res.status} ${await res.text()}`);
  return res;
}
const comment = (n, body) => gh("POST", `/issues/${n}/comments`, { body });
const closeIssue = (n) => gh("PATCH", `/issues/${n}`, { state: "closed", state_reason: "completed" });
const setTitle = (n, title) => gh("PATCH", `/issues/${n}`, { title });

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Re-applies the change on top of the latest main and retries if someone else pushed first.
function commitWithRetry(mutate, message) {
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  for (let attempt = 1; attempt <= 6; attempt++) {
    git(["fetch", "origin", "main"]);
    git(["reset", "--hard", "origin/main"]);
    const result = mutate();
    if (!result.write) return result;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(result.file, JSON.stringify(result.data, null, 2) + "\n");
    git(["add", DATA_DIR]);
    if (!git(["status", "--porcelain"])) return { ...result, write: false };
    git(["commit", "-m", message]);
    try {
      git(["push", "origin", "HEAD:main"]);
      changed = true;
      return result;
    } catch (e) {
      console.warn(`Push attempt ${attempt} failed, retrying.`);
      sleep(1000 * attempt + Math.floor(Math.random() * 1000));
    }
  }
  throw new Error("Could not push after several attempts.");
}

const fileFor = (id) => path.join(DATA_DIR, `${id}.json`);
const readEvent = (id) => (fs.existsSync(fileFor(id)) ? JSON.parse(fs.readFileSync(fileFor(id), "utf8")) : null);

// ---------- Event submissions ----------

async function handleSubmission(fields) {
  const author = issue.user.login;
  const editor = (payload.sender?.login || author).toLowerCase();
  if (action === "edited" && editor !== author.toLowerCase() && editor !== repoOwner) return;

  const { errors, event } = validateSubmission(fields, author);
  if (errors.length) {
    await comment(issue.number,
      `Thanks for sharing! This couldn't be published yet:\n\n${errors.map((e) => `- ${e}`).join("\n")}\n\n` +
      `To fix it, edit this issue (open the ··· menu on your post, then choose Edit). It will be checked again automatically.`);
    return;
  }

  const result = commitWithRetry(() => {
    const existing = readEvent(issue.number);
    if (!existing) {
      const active = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")))
        .filter((e) => e.submittedBy === author && !e.hidden && (e.dateTbd || new Date(e.endUtc) > new Date())).length : 0;
      if (active >= MAX_ACTIVE_PER_PERSON && author.toLowerCase() !== repoOwner) return { write: false, limit: true };
    }
    const data = {
      id: issue.number,
      ...event,
      submittedBy: author,
      issue: issue.number,
      reports: existing?.reports || [],
      hidden: existing?.hidden || false,
      hiddenReason: existing?.hiddenReason || "",
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { write: true, file: fileFor(issue.number), data, isNew: !existing, wasHidden: existing?.hidden };
  }, `${action === "opened" ? "Add" : "Update"} event #${issue.number}: ${event.title}`);

  if (result.limit) {
    await comment(issue.number, `You already have ${MAX_ACTIVE_PER_PERSON} upcoming events listed, which is the limit per person. If one of them has ended or been canceled, comment \`/remove\` on its issue and then edit this one to try again.`);
    return;
  }

  await setTitle(issue.number, `[Event] ${event.title}`);
  if (result.isNew) {
    await comment(issue.number,
      `Your event is live on ${SITE_NAME}: ${siteUrl}\nIt can take a minute or two to appear.\n\n` +
      `Need to change something? Edit this issue and the listing updates automatically.\n` +
      `Event canceled? Comment \`/remove\` here and it comes down right away.` +
      (event.dateTbd || event.timeTbd
        ? `\n\nOnce the ${event.dateTbd ? "date" : "time"} is set, edit this issue and fill it in. The listing moves into place on the site and gets added to subscribed calendars automatically.`
        : ""));
  } else if (result.write) {
    await comment(issue.number, result.wasHidden
      ? "Your changes were saved, but this listing is currently hidden, so it won't show on the site."
      : "Listing updated. Changes appear on the site in a minute or two.");
  }
  if (issue.state === "open") await closeIssue(issue.number);
}

// ---------- Reports ----------

async function handleReport(fields) {
  if (action !== "opened") return;
  const reporter = issue.user.login;
  const id = Number(String(fields[LABELS.reportId] || "").replace(/[^\d]/g, ""));
  const reason = String(fields[LABELS.reportReason] || "").trim();

  const result = commitWithRetry(() => {
    const ev = id ? readEvent(id) : null;
    if (!ev) return { write: false, missing: true };
    if (ev.hidden) return { write: false, alreadyHidden: true };
    const reports = ev.reports || [];
    if (reports.map((r) => r.toLowerCase()).includes(reporter.toLowerCase())) return { write: false, duplicate: true };
    const data = { ...ev, reports: [...reports, reporter] };
    const isOwnerOrSubmitter = reporter.toLowerCase() === repoOwner || reporter.toLowerCase() === String(ev.submittedBy).toLowerCase();
    if (isOwnerOrSubmitter || data.reports.length >= REPORTS_TO_HIDE) {
      data.hidden = true;
      data.hiddenReason = isOwnerOrSubmitter ? `Removed by @${reporter}` : `Hidden after ${data.reports.length} reports`;
    }
    return { write: true, file: fileFor(id), data };
  }, `Report on event #${id || "?"}${reason ? ` (${reason})` : ""}`);

  let msg;
  if (result.missing) msg = `Couldn't find an event with number ${id || "(blank)"}. Use the Report link next to the listing on the site so the number is filled in for you.`;
  else if (result.alreadyHidden) msg = "Thanks. This listing has already been taken down.";
  else if (result.duplicate) msg = "Thanks. You've already reported this listing, so it was only counted once.";
  else if (result.data?.hidden) msg = "Thanks. This listing has been hidden from the site.";
  else msg = "Thanks, your report was recorded. Listings reported by three different people are hidden automatically.";
  await comment(issue.number, msg);
  await closeIssue(issue.number);
}

// ---------- /remove comments ----------

async function handleRemoveComment() {
  const body = String(payload.comment?.body || "").trim().toLowerCase();
  if (!body.startsWith("/remove")) return;
  const commenter = payload.comment.user.login;
  const result = commitWithRetry(() => {
    const ev = readEvent(issue.number);
    if (!ev) return { write: false, missing: true };
    const allowed = commenter.toLowerCase() === repoOwner || commenter.toLowerCase() === String(ev.submittedBy).toLowerCase();
    if (!allowed) return { write: false, denied: true };
    if (ev.hidden) return { write: false, alreadyHidden: true };
    return { write: true, file: fileFor(issue.number), data: { ...ev, hidden: true, hiddenReason: `Removed by @${commenter}` } };
  }, `Remove event #${issue.number}`);
  if (result.missing) return;
  if (result.denied) await comment(issue.number, "Only the person who submitted this event can remove it. To flag a problem, use the Report link on the site.");
  else if (result.alreadyHidden) await comment(issue.number, "This listing is already down.");
  else await comment(issue.number, "Done. This listing has been removed from the site.");
}

// ---------- Main ----------

try {
  if (issue.pull_request) {
    // Not an issue.
  } else if (payload.comment) {
    if (payload.comment.user?.type !== "Bot") await handleRemoveComment();
  } else {
    const fields = parseForm(issue.body);
    if (LABELS.title in fields && LABELS.date in fields) await handleSubmission(fields);
    else if (LABELS.reportId in fields) await handleReport(fields);
    else console.log("Not a Keep Connected form. Nothing to do.");
  }
} finally {
  setOutput();
}
