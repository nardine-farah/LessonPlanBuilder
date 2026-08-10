# Lesson Plan Builder

A curator tool for **Biblica's Scripture Studio**: feed it any ministry PDF — devotional
series, discipleship course, study guide, **in any language** — and it walks you through a
guided interview that turns the document into a lesson-plan seed file for the Studio
library (`data/lesson-plans/{planId}.json`).

It automates the manual workflow described in Scripture Studio's
`LESSON_PLAN_AUTHORING.md`, while keeping every one of its guardrails:

- **Scripture is referenced, never stored.** The AI is instructed to paraphrase teaching
  and never copy verse text; references are resolved to canonical USFM codes
  (`JDG.6.11-16`) with the same book mapping the Studio runtime uses.
- **AI proposes, the curator disposes.** The analysis produces a *draft* — every field is
  editable, every AI-drafted quiz is flagged for verification against the passage, and
  exports are always `status: "draft"`. Publishing remains a human review decision.
- **The export passes the real schema.** `lib/schema.ts` is an exact port of the Studio's
  Zod schema, so a downloaded file validates cleanly under `npm run db:seed:plans`.

## The flow

1. **Source PDF** — upload the document, choose the plan's output language (en/NIV or
   ar/NAV). Claude reads the PDF (translating if needed) and maps its structure: series
   title → title/subtitle, sessions → lessons, anchor verses, teaching, key ideas,
   prayers, supporting scriptures — and drafts a comprehension quiz per lesson.
2. **Plan details** — title, subtitle, summary, span, planId slug, translation, provenance.
3. **Who it's for** — the matching-tag interview (faith level, audience, focus, length
   band, resources) using the exact tag vocabulary the Studio's matcher scores on.
4. **Lessons** — review each session: passage + USFM (with a "derive" helper), teaching
   paragraphs, key idea, prayer, reflection script, quiz (exactly-one-correct enforced),
   scriptures to consider.
5. **Review & export** — live validation against the Studio schema, the reviewer
   checklist from `LESSON_PLAN_AUTHORING.md` §13, JSON preview, and download.

Drafts auto-save to the browser (localStorage), so you can close the tab and continue.

## Reviewer profiles

Reviewers sign in with Google (same Firebase project as Scripture Studio, so one
account works across both tools). Every plan being reviewed syncs to the
reviewer's profile in Firestore at `reviewerPlans/{uid}/plans/{key}` —
`in_progress` while it's the working draft, `completed` after Finish.

- `/` — welcome + Google sign-in
- `/plans` — the reviewer's plans: continue, reopen, download, delete, start new
- `/builder` — the wizard (auth-gated; autosaves locally **and** to the profile)

**Security architecture (matches Scripture Studio):** the browser never touches
Firestore. All reads/writes go through `/api/plans`, which verifies the
reviewer's Firebase ID token and uses `firebase-admin` server-side — so the
project's deny-all Firestore client rules stay exactly as they are.

## Publishing to the Studio library

A plan that is **completed with the reviewer checklist fully checked** gets a
**⇪ Publish to Studio** button on the plans page. Publishing performs the same
write as Scripture Studio's `npm run db:seed:plans` — the schema-validated
`LessonPlanDoc` is upserted at `lessonPlans/{planId}` — but with
`status: "published"`, so it becomes matchable in the Studio immediately.

Guards: only `@biblica.com` accounts may publish (`PUBLISH_ALLOWED_DOMAIN` env
overrides the domain); the doc must pass the Studio schema; and an existing
library plan with the same `planId` is never overwritten without an explicit
confirmation.

**Reflection audio renders automatically on publish.** Each lesson's
`reflectionScript` is synthesized with Google Cloud Text-to-Speech
(authenticated by the same service account — no TTS API key needed), uploaded
to Firebase Storage at `lesson-audio/{planId}/{n}.mp3`, and its public URL is
written into `media.reflectionAudio` — the Studio player uses the URL as-is.
Republishing reuses audio for unchanged scripts; audio failures never block a
publish (the player just stays hidden for that lesson).

One-time setup: enable **Storage** in the Firebase console (Build → Storage →
Get started) so the project has its default bucket, or point
`FIREBASE_STORAGE_BUCKET` at an existing bucket. Voices default to
`en-US-Neural2-D` / `ar-XA-Wavenet-B`; override with `TTS_VOICE` /
`TTS_VOICE_AR`, or switch provider entirely with `GOOGLE_TTS_API_KEY`,
`OPENAI_API_KEY`, and `TTS_PROVIDER`.

## Setup

```bash
npm install
# .env.local needs:
# ANTHROPIC_API_KEY=sk-ant-...
# NEXT_PUBLIC_FIREBASE_API_KEY / _AUTH_DOMAIN / _PROJECT_ID / _APP_ID  (same as Scripture Studio)
# FIREBASE_PROJECT_ID=...
# GOOGLE_APPLICATION_CREDENTIALS=./.secrets/firebase-service-account.json  (local dev only)
npm run dev        # http://localhost:3210
```

## Deployment (Firebase App Hosting)

**Live:** https://lesson-plan-builder--scripture-studio-df955.us-central1.hosted.app
(backend `lesson-plan-builder` in the `scripture-studio-df955` project, region
us-central1 — alongside the Studio's own `biblica` backend).

**Continuous deployment:** the `lesson-plan-builder` backend is connected to
GitHub (`nardine-farah/LessonPlanBuilder`, live branch `main`) with **automatic
rollouts enabled** — every push to `main` builds and deploys on its own. No
manual step needed.

Manual deploy is still available if you ever need it (e.g. to ship without a
commit):

```bash
firebase deploy --only apphosting
```

Configuration lives in `apphosting.yaml` (public Firebase env vars, secret
reference for `ANTHROPIC_API_KEY` in Secret Manager, `maxInstances: 1` so the
on-disk analysis resume-cache stays coherent). Production credentials come from
the runtime's Application Default Credentials — no service-account file is
deployed. The hosted domain is registered in Firebase Auth's authorized
domains, so Google sign-in works there.

The analysis endpoint (`app/api/analyze/route.ts`) calls Claude (`claude-opus-4-8`) with
the PDF as a document block and a structured-output schema, so extraction is deterministic
JSON. PDFs up to 30 MB / ~600 pages are supported; very long books may need splitting.

## After export

In the Scripture Studio repo:

```bash
cp ~/Downloads/{planId}.json data/lesson-plans/
npm run db:seed:plans     # validates + upserts
npm run tts:render        # optional: renders reflectionScript → MP3, fills media
npm run db:seed:plans     # re-seed so the audio path is live
```

Then test end-to-end at `/studio/lesson-plan` and flip `status` to `"published"` only
after editorial + theological review.

<!-- rollout: bind ELEVENLABS_API_KEY (57bcc3c) -->
