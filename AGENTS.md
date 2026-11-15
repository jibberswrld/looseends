<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Model routing (`src/lib/server/agent.ts`, publik sessions only): each agent turn starts with one publik-fast router call that picks the tier (fast, balanced or smart) for the whole turn from its reading of the request, never from keywords. Router failure or timeout (8 s) means balanced; 401/402/429 surface like the main call. A fast round that is empty or has malformed tool calls is retried once on balanced, and the turn stays there. Inbox triage, "Draft a reply" and the one-line follow-up after an approval use publik-fast; extraction and Ask use publik-balanced. Text a round says before calling tools is narration and is cleared (`text` event with `reset`) so only the answer stays. A turn has at most 12 rounds and keeps 30 s of its 240 s for a final no-tools answer, so a turn cut short by rounds, time or a failing AI still answers from what it read (with a note). Gmail listings go back to the model compact (ids, sender, subject, date, labels, 300-character snippet). check_inbox imports mail and is for explicit "check my inbox" requests, not for answering questions Own-key sessions skip routing and use their configured model. The chosen tier is logged per turn without content (`[agent] turn <id> tier=...`)
- Sign in with publik: the gate (`src/lib/server/gate.ts`, UI `src/components/app/gate.tsx`) runs before any app screen; it also sends usage telemetry (`src/lib/server/publik.ts`)
- Gate: GET /api/gate never creates anything (cookieless visitors get the sign-in screen); POST /api/gate, sent when "Sign in with publik" is clicked, creates the session row and the publik install. The client polls GET every 3 s for a minute, then every 10 s, for at most 10 minutes
- Key: one `pk_` from POST /installs per browser session, encrypted in the `sessions` row; never sent to the browser
- App token: publik-app-token.txt (public by design, committed) or PUBLIK_APP_TOKEN
- Runs as a hosted web app on Vercel; Neon Postgres with `DATABASE_URL`, PGlite only for local development/tests
- 402: show error.message plus error.top_up_url only
- Errors: API routes answer `{error:{code,message}}`; the client (`src/components/app/api.ts`) shows `message` as is (429 included) and maps non-JSON 413/429/5xx to plain sentences
- Agent writes are approval cards (`src/components/app/agent-ui.tsx`): every argument must be visible on the card (readable fields, the rest under Details). Never hide an argument that will be sent
- Connected apps (Composio): Gmail, Google Calendar, Outlook, Slack, Notion, Google Drive, Google Docs, Google Sheets, GitHub, Linear, Todoist. After connecting, the user lands on `/connected?app=<toolkit>`
- Uploads: images are downscaled in the browser (`downscaleImage` in `src/components/app/capture.tsx`) before POST /api/capture; the multipart body is `file` (+ `force`) only
- User-facing promises live in `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, the gate and Settings; keep them true when behaviour changes
- Local runs: mocks in `scripts/` (see README); never point a local run at the production database or real Composio
- CI: `.github/workflows/ci.yml` runs lint, build, then `tsc --noEmit` (needs the build's generated route types)
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md
