@AGENTS.md

# Minutes to Momentum

Meeting-to-execution agent, built for an AI product hackathon (deadline: tonight, 2026-10-31).
**Problem:** decisions made in meetings get lost. **Fix:** turn a messy recap into confirmed
decisions + owned, dated tasks in Notion, with memory across meetings.

## Core flow

1. **Capture**: the user records a messy voice recap (browser speech-to-text) or pastes a
   transcript with speaker names (`Priya: we should ship Friday`).
2. **Clean**: Gemini removes fillers, false starts and crosstalk, keeping speaker attribution.
3. **Extract**: decisions, action items, owners, deadlines (relative dates like "next Friday"
   resolved against the meeting date), and attendees.
4. **Remember + check conflicts**: everything is stored in SQLite. New decisions are compared
   with older active decisions; contradictions are shown as warnings.
5. **Confirm**: the user reviews and edits extracted items and resolves conflicts
   (keep new / keep old / not a conflict). Nothing goes to Notion before this step.
6. **Ship**: confirmed action items are created as pages in the Notion tasks database.
7. **Follow through**: the Day dashboard shows due-soon reminders and open conflicts; the Weekly
   digest gives a per-person summary of decisions, owned tasks and what's due.

## Pages (App Router)

| Route           | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `/`             | Today: stat cards, Reminders (overdue + next 48h), items to discuss, recent meetings |
| `/meetings/new` | Capture (voice or paste) → review extraction → confirm      |
| `/tasks`        | Table of all action items; filters status / due / person; done syncs to Notion |
| `/digest`       | Pick a person -> AI digest (1 call, saved per person per day) + Copy |
| `/decisions`    | Decision history per meeting; replaced ones crossed out    |
| `/api/health`   | DB tables and which env vars are set (no secret values)    |

## Tech stack (free tools only)

- **Next.js 16.4 (App Router) + React 19 + TypeScript + Tailwind v4.** `cacheComponents` and
  `partialPrefetching` are ON in `next.config.ts`. Read `node_modules/next/dist/docs/` before
  using any Next API; this version differs from older training data.
- **AI: Google Gemini (Flash, free tier)** via the official `@google/genai` SDK. Model comes from
  `GEMINI_MODEL` (default `gemini-3.5-flash`).
- **Memory: SQLite** via `better-sqlite3` (file at `data/momentum.db`, git-ignored).
- **Tasks: Notion** via the official `@notionhq/client` (v5, Notion API `2025-09-03`).
- **Validation:** `zod` v4 (also generates the JSON schema sent to Gemini).
- **Voice:** browser Web Speech API (`webkitSpeechRecognition`, free; works best in Chrome/Edge).

## Key files

- `lib/schema.ts`: all `CREATE TABLE` SQL. Tables: `people`, `meetings`, `meeting_attendees`,
  `decisions` (+ `replaced_in_meeting_id`), `action_items` (+ `replaced_in_meeting_id`), `conflicts`,
  `ai_cache`. `decision_conflicts` is legacy/unused (it can only link decision to decision).
- `lib/db.ts`: `getDb()` returns a singleton connection, applies the schema and small additive
  migrations (`migrate()`: ALTER TABLE ADD COLUMN if missing) on first use (WAL, FKs on).
- `lib/conflicts.ts`: `findConflicts()`: ONE Gemini call (label `conflicts`) comparing new decisions /
  action items with all active decisions + open tasks. Items get short IDs (D1, A1, PD<id>, PT<id>);
  the AI only links IDs + writes a one-sentence explanation, the old meeting/date/owner come from the DB.
  Skipped (no AI call) when memory is empty. Types: contradicting_decision, changed_deadline,
  reassigned_owner, duplicate_task, scope_violation.
- Resolutions (applied in `saveMeeting`): replace_old -> old decision `superseded` (+ superseded_by,
  replaced_in_meeting_id) or old task `dropped`; keep_old -> new item not saved; discuss_later -> both
  saved, `conflicts.status = 'open'` until "Mark settled" on Today. Save is blocked until every conflict
  has a choice (client + zod).
- `lib/demo.ts`: `resetDemoData()` (Today page button, two-step confirm) wipes everything except
  `ai_cache` and loads two demo meetings with dates RELATIVE TO TODAY (`demoDates()` in
  `lib/demo-sample.ts`): Launch planning (today-7), Marketing sync (today-3); 3 tasks due tomorrow,
  2 overdue, 1 done, 1 later; one open "discuss later" conflict (free trial 14 vs 7 days).
  `demoNewMeeting(today)`: the clashing "Launch check-in" transcript for "Try a sample" (relative dates).
- `lib/ai.ts`: **the only file that calls Gemini.** `generateJson({ prompt, schema, system, label })`
  - asks for JSON via `responseMimeType: "application/json"` + `responseJsonSchema` (from Zod)
  - validates the reply with the same Zod schema
  - every request has a time limit (20s main / 30s each fallback); on 429/500/502/503/504/timeout it walks the
    fallback chain `GEMINI_FALLBACK_MODEL` (comma-separated; default `gemini-3.5-flash-lite, gemini-3.1-flash-lite,
    gemini-flash-lite-latest`) and stops at the first answer; with none set, retries the same model once
  - caches validated replies in `ai_cache` (key = sha256 of model+system+prompt+schema+temp);
    `refresh: true` bypasses the cache read, `cache: false` disables it, `clearAiCache()` wipes it.
- `lib/extraction.ts`: the extraction prompt + Zod schema (`extractMeeting()`; one call does clean + extract).
  Gives Gemini a 45-day calendar so weekdays resolve correctly; unclear owner/deadline come back empty.
- `lib/meeting-types.ts`: shared draft types + Zod input schemas for the server actions (client-safe).
- `lib/meetings.ts`: `saveMeeting()`: one transaction for meeting, people, attendees, decisions, action items.
- `app/meetings/new/`: `actions.ts` (server actions return `{ ok, error: FriendlyError }`, never throw),
  `meeting-capture.tsx` (capture → review → save UI), `review-cards.tsx`, `use-speech-recognition.ts`.
- `lib/queries.ts`: read models + task mutations for Tasks / Digest / Today (`listTasks`, `taskCounts`,
  `dueSoon`, `weeklyDigest`, `setTaskDone`, `updateTaskDetails`). `lib/dates.ts`: YYYY-MM-DD helpers
  (UTC math, `dueLabel`, `weekStartIso` = Monday). `app/tasks/actions.ts`: server actions, call `refresh()`.
- `lib/notion.ts`: **the only file that calls Notion** (SDK v5, API 2025-09-03). `resolveTarget()` (cached
  10 min): database -> first data source -> maps properties by type/name (title, status "To Do", owner,
  due date, meeting); missing Owner (select) / Due date (date) / Meeting (rich text) are ADDED to the data
  source. `createTaskPage()` first looks for an existing page with the same title + meeting (adopts it),
  `updateTaskPage()` updates properties + appends a note. Errors -> `NotionError` with friendly messages.
- `lib/notion-sync.ts`: `approveAndSend(ids)`: owner + deadline required; approve (status proposed ->
  confirmed, approved_at); skip if `notion_status = 'sent'`; atomic 'sending' lock (expires after 2 min);
  update when the task already has a page (e.g. inherited via a "Replace old" conflict or edited after
  sending: `needs_update`), else create; on failure keep the task with `notion_status = failed` +
  `notion_error` for Retry. Approve step UI: `app/meetings/new/approve-panel.tsx`; Tasks page has
  Send / Update / Retry per task. `components/notion-badge.tsx`: "Sent to Notion" badge + link.
- `lib/digest.ts`: `generateDigest(name, today)`: ONE Gemini call (label `digest`) from `personFacts()`
  (overdue, open, done in 7 days, decisions from the last 14 days they attended/own, open conflicts);
  saved in `digests` (unique person + day), so reopening never calls the AI; nothing to say -> no AI call.
- Notion done sync: ticking a task calls `syncDoneStatus()` -> Status Done / To Do on its Notion page.
- Reminder bell (`components/reminder-bell.tsx`, server component in the layout): open tasks overdue or
  due within 48 hours.
- `components/icons.tsx`: the one icon set. `EmptyState` takes `icon` + `action`.
- Never export plain values (strings, objects) from a `"use client"` file for server components to use;
  put them in a plain module (e.g. `app/tasks/columns.ts`).
- `components/avatar.tsx`, `components/fields.ts`: shared avatar + pill/inline field styles.
- `components/nav.tsx`: client nav with active state (`usePathname`); the layout wraps it in `<Suspense>`.
- `components/page-header.tsx`: `PageHeader`, `EmptyState`.

## Conventions / gotchas

- **Never call Gemini directly**; add a Zod schema + prompt and use `generateJson`. Give every
  call a `label`. Include today's/meeting date in prompts so deadlines resolve correctly.
- Free quota is tiny: prefer **one** combined extraction call per meeting (clean + extract
  together), then one conflict-check call that is given only relevant prior active decisions.
- **Sync SQLite + cacheComponents:** better-sqlite3 queries would run at build/prerender time and
  be frozen. In pages and route handlers call `await connection()` (from `next/server`) before
  reading the DB, and wrap dynamic sections in `<Suspense>`. Mutations go in Server Actions / route handlers.
- `lib/db.ts` and `lib/ai.ts` import `server-only`; never import them from client components.
- The dev server keeps ONE DB connection for its lifetime (globalThis singleton), so schema/migration
  changes only apply after restarting `npm run dev`.
- Right after a fresh `next dev` start, pages sometimes reload in a loop for a few minutes ("Compiled in
  1ms" + "[Fast Refresh] rebuilding" repeating), then it stops. Not caused by app code. For demos and
  browser tests use the production server: `npm run build && npm start` (no HMR).
- Dates: store `YYYY-MM-DD` strings. People are matched by name, case-insensitive (`people.name` is `COLLATE NOCASE`).
- **Notion v5:** API `2025-09-03` uses *data sources*. Resolve `NOTION_DATABASE_ID` once via
  `notion.databases.retrieve({ database_id })` → `data_sources[0].id`, then
  `notion.pages.create({ parent: { data_source_id }, properties })`. Read the property names
  and types from the data source instead of hard-coding them. The integration must be added to the database (… → Connections).
  Store the returned `page.id` / `page.url` on the action item.
- Styling: Apple-style materials (see `app/globals.css`). Font: Onest. A fixed `.ambient` layer (soft
  sky/peach light + grain) sits behind everything. Utilities: `glass` / `glass-flat` / `glass-strong` for
  chrome and secondary surfaces, `sheet` (solid) for lists you act on. Color tokens: `ink`, `ink-2`, `ink-3`,
  `fill`, `hairline`, `primary` (ink pill buttons), `blue` (links/focus only), `live` (recording/errors),
  `go`, `attention` = yellow, reserved for "needs clarification", and `caution` = orange for conflicts
  (red `live` for contradicting decisions / scope breaks). Shared button classes:
  `primaryButton` / `secondaryButton` in `components/page-header.tsx`.
  Theme: tokens use `light-dark()`; `components/theme-toggle.tsx` (Auto / Light / Dark, saved in
  localStorage) sets `<html data-theme>` and an inline script in the layout applies it before paint.
  Never put `light-dark()` inside `@media` (Tailwind's Lightning CSS turns it into a prefers-color-scheme
  query that ignores the toggle); define a token and reference it with `var()` instead. Don't use `dark:`.
  No uppercase labels, no mono, no arrows on buttons. Note: with Windows "Transparency effects" off, Chrome
  reports reduced transparency and the glass becomes more opaque (by design).

## Env vars (`.env.local`, template in `.env.example`)

`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `NOTION_TOKEN`, `NOTION_DATABASE_ID` (optional: `DATABASE_PATH`,
`SEED_DEMO_ON_EMPTY`).

## Deploy (Render, free)

`render.yaml` is a Render Blueprint: free Node 22 web service in Singapore, `npm ci && npm run build`, `npm start`
(Next reads Render's `PORT`), health check `/api/health`. Secrets (`GEMINI_API_KEY`, `NOTION_TOKEN`,
`NOTION_DATABASE_ID`) are entered in the Render dashboard, never committed. The free disk is wiped whenever the
service restarts or sleeps (15 min idle), so `SEED_DEMO_ON_EMPTY=1` makes `getDb()` (`seedIfEmpty`) load the demo
meetings into an empty database; the health check triggers it on start. Saved meetings do not survive a restart there.
Pushes to `main` redeploy automatically.

## Status

- [x] Foundation: packages, schema, AI helper, env template, layout + nav, placeholder pages
- [x] Capture UI (voice + paste) and extraction prompt
- [x] Persist meeting / people / decisions / action items (meeting `confirmed`, decisions `active`, items `confirmed`; source quote stored in `action_items.description`)
- [x] Conflict detection + resolution UI (cards at top of review, Today counter + open list, `/decisions` history, demo reset)
- [x] Approve tasks -> Notion (approve screen after save, never duplicates, update on reassignment, retry on failure)
- [x] Today dashboard (stats, reminders, discuss, recent meetings) + reminder bell, Tasks table (status/due/person filters, done -> Notion), AI weekly digest with Copy, relative-date demo data, UI polish
