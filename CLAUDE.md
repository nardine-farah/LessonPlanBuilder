# Lesson Plan Builder — project context

> Written 2026-07-15 as a session-continuity file. If you are Claude starting fresh:
> read this before touching anything. The companion repo is `~/Scripture Studio`
> (the consumer of everything this tool produces).

## What this is

A curator tool for Biblica (user: Nardine, nardine.farah@biblica.com). It turns any
ministry PDF (devotional/course/study guide, **any language**) into a lesson-plan JSON
for the Scripture Studio library, via a 6-step wizard:

1. **Source PDF** — upload; measured with `count_tokens` (free); oversized docs get a
   choice screen (analyze specific pages `1-10,15,22-30` or all-in-parts).
2. **Plan details** — title/subtitle/summary/planId/span/translation/reviewedBy.
3. **Who it's for** — match tags (exact enums the Studio matcher scores).
4. **Lessons** — per-lesson editor (passage + USFM, teaching, key idea, quiz with
   exactly-one-correct enforcement, prayer, reflectionScript, supporting scriptures).
5. **Lesson images** — see "Image pipeline" below.
6. **Review & export** — validates against the ported Studio schema; reviewer
   checklist (from Studio's LESSON_PLAN_AUTHORING.md §13); download/copy JSON
   (never blocked, even when invalid); **Finish** saves to profile.

## Hard invariants (do not break)

- **Scripture is referenced, never stored** — refs + USFM codes only; the AI prompt
  forbids verbatim verse text in teaching/keyIdea/reflectionScript.
- **`lib/schema.ts` is an EXACT port of Scripture Studio `src/lib/lesson-plans.ts`**
  (Zod). Any schema change must land in BOTH files (e.g. `media.image` was added to
  both on 2026-07-15). Library cap: **max 40 lessons/plan** (advise splitting into
  volumes).
- **Exports are always `status: "draft"`**; only `/api/publish` writes `"published"`.
- **The browser NEVER touches Firestore.** Scripture Studio's `firestore.rules` are
  deliberately deny-all for clients; all data goes through API routes using
  `firebase-admin` with Firebase ID-token verification (`Authorization: Bearer`).
- **AI proposes, curator disposes** — drafted quizzes/tags/images are flagged for
  human review; publishing gates on the completed checklist.

## Architecture

Next.js 15 App Router (port 3210 locally), TypeScript **pinned ^5** (npm resolves
TS 7 / native compiler otherwise, which breaks next.config.ts loading). Key modules:

- `lib/extraction.ts` — Claude extraction: `claude-opus-4-8`, PDF document blocks,
  adaptive thinking, structured outputs (`EXTRACTION_SCHEMA` — a *draft* shape, not
  the library schema; refs requested in display language AND English for USFM
  resolution; `artPages` per lesson = original page numbers with real artwork).
  Chunking: `planChunks` over selected page lists (1-page overlap), `slicePdf`
  (pdf-lib), `mergeExtractions` (part 1 wins plan fields; lessons dedupe by
  title+ref, artPages unioned on dupes), `toDraft`, `estimateParts`
  (single-pass ≤850k tokens & ≤500 pages; chunk budget 550k; env overrides
  `LPB_SINGLE_PASS_MAX`, `LPB_CHUNK_BUDGET`).
- `lib/jobs.ts` — **resumable analysis jobs** on disk (`.analysis-cache/`): PDF,
  measurement, chunk plan, and each part cached as completed; jobs keyed
  `hash(bytes+language)` + scope (`-full` / `-p<sel-hash>`); orphaned jobs revive
  after server restart (GET poll detects); prune >14 days; `storeSourcePdf` =
  attach-PDF-without-analysis. Failed token counts retried once, never cached.
- `lib/render.ts` — mupdf WASM page rendering (**lazy `import("mupdf")` — it's
  ESM-only with top-level await; static import breaks CJS server build**); 3-render
  semaphore; pixmap clamped on BOTH axes; `RenderError` carries machine `code`
  (`cache-miss`/`bad-page`/`render`); `renderPdfFromBytes` powers the selftest.
- `lib/tts.ts` — Google Cloud TTS **via the service account's OAuth** (no API key
  needed; the TTS API is enabled on the project). Natural-voice setup (2026-07-16):
  en `en-US-Studio-O`, ar `ar-XA-Wavenet-B` (no Arabic Studio voice exists); plain
  text → SSML (`toSsml`: 300ms lead-in, 550ms between sentences incl. Arabic `؟۔`,
  400ms trailing); `speakingRate 0.92` (`TTS_SPEAKING_RATE`), effects profile
  `headphone-class-device`. `audioSignature(language)` fingerprints the voice
  config into the MP3 filename (`{n}-{sig}.mp3`) — republish reuses a recording
  ONLY if script AND signature match, so voice upgrades re-render automatically.
  Env `TTS_VOICE`/`TTS_VOICE_AR`; providers switchable via
  `GOOGLE_TTS_API_KEY`/`OPENAI_API_KEY`/`TTS_PROVIDER` (OpenAI path = plain text,
  no SSML). Duration estimate accounts for rate + inserted pauses.
- `lib/firestore-server.ts` — admin SDK init (SA file locally, ADC in prod),
  `identityFromRequest`/`uidFromRequest`, `storageBucket()` (probes
  `.firebasestorage.app` then `.appspot.com`; env `FIREBASE_STORAGE_BUCKET`),
  `uploadLessonAudio` (download-token public URLs).
- `lib/planStore.ts` — client CRUD via `/api/plans` (`authedFetch` exported here);
  `StoredPlan` = plan record with `draftJson` string (≤900KB), status
  `in_progress|completed`, `checklistDone`, `publishedAt`.
- `lib/importPlan.ts` — "Import plan JSON" (accepts Studio seed files OR wizard
  drafts; lenient — invalid plans import for fixing).
- `lib/pages.ts` — page-spec parsing ("1-10, 15, 22-30"), shared client/server.

### API routes (all `runtime: nodejs`)

- `POST/GET /api/analyze` — start/poll jobs; POST returns `needsChoice` for
  oversized docs; GET revives orphans. Unauthenticated (content-hash capability).
- `GET /api/render?source&page&w` — **authed**; `?selftest=1` is an open health
  probe (renders a synthetic PDF; proves mupdf works in prod).
- `POST /api/lesson-image` — authed; validates 8-byte PNG signature, ≤3MB; uploads
  to Storage `lesson-images/{uid}/…`.
- `POST /api/source` — authed; attach a PDF to the render cache (no analysis).
- `GET/PUT/DELETE /api/plans` — authed; PUT has an **updatedAt out-of-order write
  guard** (stale autosave can't regress a finished plan) and **preserves
  publishedAt/publishedPlanId/finishedAt across rewrites** (builder autosaves build
  fresh records; a 2026-07-16 bug wiped the "in library" marker on reopen — fixed).
  Reopening a completed plan asks for confirmation and explains the published
  library copy stays live until Republish.
- `POST /api/publish` — authed + **email must end `@biblica.com`**
  (`PUBLISH_ALLOWED_DOMAIN` env); requires completed+checklistDone; validates
  schema; 409 (confirm-overwrite) if planId exists in library; writes
  `lessonPlans/{planId}` with status published (same write as Studio's
  `db:seed:plans`); **auto-renders reflection audio** (reuses unchanged narrations
  on republish; audio failures never block publish); returns `audio` summary.

### Reviewer profiles / auth

Google sign-in (popup), **same Firebase project as Scripture Studio**
(`scripture-studio-df955`) so one account works across both. Routes: `/` welcome,
`/plans` dashboard (Continue/Reopen/⤓ JSON/Publish/Import/delete), `/builder`
(auth-gated wizard). Working draft lives in localStorage (`lpb-draft-v1`
{draft, step, key, createdAt}) AND debounce-syncs (1.5s) to
`reviewerPlans/{uid}/plans/{key}`. Race guards: sync-epoch ref invalidates pending
saves on finish/discard; flush-on-unmount; plans-page Continue with the SAME key
never overwrites localStorage (local may be newer). Legacy localStorage completed
plans auto-import on first sign-in.

### Image pipeline ("analysis notes pages → local render → human picks")

- Analysis fills `lesson.artPages` (clamped to real page count in jobs.ts).
- StepImages renders candidate thumbs via authed blob URLs; ✕ removes candidates;
  manual page add; **⤒ Upload image** (png/jpg/webp) goes through the same crop
  modal; crop modal caps display at 58vh (whole page always visible), shows live
  output px + ratio (wide 16:9–3:2 recommended), downscales output to ≤1600px PNG;
  upload happens AT PICK TIME to Storage (survives cache expiry); "⧉ Use for all
  lessons" copies one image everywhere. `draft.sourceId` links to the cached PDF;
  when the cache is gone (`cache-miss` code) an **Attach source PDF** banner
  appears (same content hash reconnects everything, no AI cost).
- Export: `media.image {asset, alt}` per lesson.

## Source control

- **GitHub: `nardine-farah/LessonPlanBuilder`** (separate repo from the Studio's
  `nardine-farah/ScriptureStudio` — two apps, two backends, two repos). Pushed
  2026-07-16. Secrets (`.env.local`, `.secrets/`) are gitignored and NOT on GitHub.
- **GitHub auto-deploy is LIVE** (set up 2026-07-22): the `lesson-plan-builder`
  App Hosting backend is connected to this repo with automatic rollouts enabled on
  `main` — every push auto-builds+deploys, matching the Studio's `biblica` backend.
  `firebase deploy --only apphosting` still works as a manual fallback. (Note: the
  CLI `backends:get` "ABIU" column = Automatic Base Image Updates, a SEPARATE
  runtime-patching feature — NOT the auto-rollout signal; don't confuse them.)
- The two project folders are siblings under `~/` — a single Claude Code session
  started from `~/` (or referencing both by path) works across both repos.

## Firebase / deployment

- Project `scripture-studio-df955`. SA file: `.secrets/firebase-service-account.json`
  (gitignored; copied from Scripture Studio). `.env.local` has ANTHROPIC_API_KEY,
  NEXT_PUBLIC_FIREBASE_*, FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS.
- **Deployed on Firebase App Hosting**: backend `lesson-plan-builder`, us-central1,
  live at https://lesson-plan-builder--scripture-studio-df955.us-central1.hosted.app
  — deploy with `firebase deploy --only apphosting` (CLI is logged in as the user;
  local-source deploy, `firebase.json` + `apphosting.yaml`; ANTHROPIC_API_KEY is a
  Secret Manager secret; `maxInstances: 1`).
- **Every rollout wipes `.analysis-cache`** (fresh Cloud Run disk) → in-progress
  plans show the attach-PDF recovery banner. Durable fix (not built): persist the
  cache to the Storage bucket.
- Hosted domain is registered in Firebase Auth authorized domains (done via
  Identity Toolkit API with the SA).
- Storage bucket exists (`scripture-studio-df955.firebasestorage.app`) — holds
  `lesson-audio/{planId}/{n}.mp3` and `lesson-images/{uid}/…`.
- Health checks: `/api/render?selftest=1`; all other APIs 401 without token.

## Scripture Studio repo (cross-repo state)

- Studio deploys from **GitHub** (`nardine-farah/ScriptureStudio`, App Hosting
  backend `biblica` auto-builds on push to main).
- Changes I made there (schema `media.image`, lesson-runtime image pass-through,
  LessonPlayer image rendering, CSP `media-src`/`img-src` + firebasestorage):
  committed by the user as `297637e` and pushed via cherry-pick to main.
- **PENDING uncommitted edit in the Studio**: LessonPlayer image `maxHeight: 340,
  objectFit: "cover"` (added 2026-07-15). Needs commit+push to take effect.
- Studio quirks: CSP blocks any origin not whitelisted (this caused the "audio
  won't play" bug); `getLessonPlan` casts Firestore data without schema parse.

## Facts & lessons learned

- PDFs tokenize at roughly **~2.5k tokens/page** (text + page image); the 512-page
  R4L reader measured 1,299,156 tokens (hence chunking; model window 1M).
- **These print booklets contain almost no embedded raster images** — artwork is
  vector, which is why images are captured by page-render+crop, not extraction.
- `count_tokens` is free; measurement failures must not be cached (was a real bug:
  cached `tokens: 0` skipped the size-choice prompt).
- A 55-lesson plan fails the library's 40-lesson cap — advise splitting volumes
  ("Reach4Life" was split; rescued full export lives at
  `exports/reach4life-story.json`).
- An adversarial review (2026-07-16, 53 findings / 49 confirmed) was triaged: all
  highs + material mediums fixed. Notable deferred: Studio service worker doesn't
  cache firebasestorage assets offline; no rate limiting on uploads; artPages
  numbering in chunked mode relies on the model translating page labels.

## Offered but not built (user may ask)

- "Split into volumes" one-click on the Review step for >40-lesson plans.
- "Suggest artwork pages" re-scan for plans analyzed before artPages existed.
- Persisting the analysis cache to the Storage bucket (survives redeploys).
- Cross-team shared plan lists (profiles are per-reviewer).
