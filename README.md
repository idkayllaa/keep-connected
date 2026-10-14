# Keep Connected

**Site: https://idkayllaa.github.io/keep-connected/**

The GHC stage might be closed, but the brilliant women in tech who drive this industry forward haven't gone anywhere. Keep Connected is a community-run list of events that are still happening: in-person meetups, speaker sessions, company events, and networking.

Not affiliated with AnitaB.org or the Grace Hopper Celebration.

## Share an event

[Submit an event](https://github.com/idkayllaa/keep-connected/issues/new?template=submit-event.yml). It's a short form, and your event shows up on the site in a minute or two. If something needs fixing, you'll get a comment explaining what to change.

- **Change your listing:** edit your issue. The site updates automatically.
- **Take your listing down:** comment `/remove` on your issue.
- **Report a listing:** use the Report link next to it on the site. Listings reported by three different people are hidden automatically.

## Subscribe

Use **Add to my calendar** on the site to subscribe in Google Calendar, Apple Calendar, or Outlook. New events appear in your calendar on their own. There are feeds for everything or for a single category:

- Everything: `https://idkayllaa.github.io/keep-connected/feeds/all.ics`
- In-person: `.../feeds/inperson.ics`
- Speaker sessions: `.../feeds/talk.ics`
- Company events: `.../feeds/company.ics`
- Networking: `.../feeds/network.ics`

## How it works

There's no server or database. GitHub does all of it:

1. The submit form is a GitHub issue form (`.github/ISSUE_TEMPLATE/submit-event.yml`).
2. When an issue is opened or edited, a GitHub Action (`.github/workflows/process-submissions.yml`) runs `scripts/process-issue.mjs`. It checks the submission, saves it as `data/events/<issue number>.json`, comments on the issue, and closes it.
3. The site is rebuilt by `scripts/build.mjs`, which writes the page, `events.json`, and the calendar feeds, and is published with GitHub Pages.

Submissions are treated as plain data. Nothing in an issue is ever run as code.

## For the maintainer

- **Remove any listing right away:** comment `/remove` on its issue, or file a report on it yourself. Either one from the repo owner hides it immediately.
- **Edit or delete by hand:** change or delete the file in `data/events/`. Setting `"hidden": true` hides a listing without deleting it. Saving a change redeploys the site automatically.
- **Unhide a listing:** set `"hidden": false` in its file.
- **Limits:** each person can have up to 10 upcoming listings. Change `MAX_ACTIVE_PER_PERSON` or `REPORTS_TO_HIDE` at the top of `scripts/process-issue.mjs`.
- **Categories and wording:** the page is `site/index.html`.
