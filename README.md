# LooseEnds

An AI assistant for the everyday tasks that slip through the cracks. Paste a message, email, screenshot or PDF. LooseEnds finds what needs doing, shows the exact sentence it came from, and prepares the next step: a reply draft, a calendar event, or a reminder. Nothing is ever sent, booked or paid on your behalf.

Runs on [publik](https://publikhq.com): Sign in with publik, and AI billed to your publik plan (or your own OpenAI-compatible key).

## What it does
- **Capture**: pasted text, screenshots (read by the model, then discarded) and PDFs (text extracted).
- **Grounded tasks**: every task has a verbatim evidence quote, highlighted in the source.
- **Honest dates**: explicit dates are confirmed; inferred ones ("Thursday") need your confirmation; vague ones ("before your visit") are marked unclear. Dates are never invented.
- **Next steps**: reply drafts (copy or open in your mail app), `.ics` / Google Calendar events, in-app reminders. Every export leaves a receipt.
- **Queue**: edit, snooze, merge duplicates, dismiss, complete; history of everything you approved or finished.
- **Safety**: message content is untrusted data. Embedded instructions are flagged and ignored; there are no outbound actions for them to trigger.

## Stack
Next.js 16 (App Router) · Tailwind v4 · Motion · PGlite (embedded Postgres, stored locally) · publik API (`publik-balanced`).

LooseEnds is a local web app: it runs on your computer at http://127.0.0.1:3000 and keeps everything in your app-data folder (`~/Library/Application Support/LooseEnds` on macOS).

## Run it
Install it from publik, or from source:
```sh
pnpm install && pnpm build
pnpm start          # http://127.0.0.1:3000
```
No configuration is needed.
To test without publik, run `node scripts/mock-publik.mjs` (set `MOCK_UPSTREAM_BASE_URL` / `MOCK_UPSTREAM_API_KEY` to any OpenAI-compatible endpoint) and start the app with `PUBLIK_ORIGIN=http://localhost:4555 PUBLIK_APP_TOKEN=pat_mocktoken`.

Self-test: `PUBLIK_SELF_TEST=1 pnpm start` prints `publik self-test: ok looseends <version>`.

## License
MIT
