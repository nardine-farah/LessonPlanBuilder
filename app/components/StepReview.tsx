"use client";

import { useMemo, useState } from "react";
import { planProgress, type LessonProgress } from "@/lib/adminData";
import { lessonPlanDocSchema } from "@/lib/schema";
import { buildPlanDoc, type Draft } from "@/lib/types";
import { Card } from "./ui";

/**
 * The HUMAN judgments a machine can't make — everything mechanical (slug
 * shape, USFM format, lesson caps, schema) is checked automatically above
 * this list. Publishing requires the schema to pass AND all of these ticked.
 */
const CHECKLIST: { text: string; hint: string }[] = [
  {
    text: "Every lesson says what the source booklet says.",
    hint: "Passages, teaching, and key ideas compared against the PDF — nothing invented, nothing lost in translation.",
  },
  {
    text: "Every quiz's marked answer is truly correct.",
    hint: "Checked against the passage itself — especially quizzes the analysis drafted rather than found.",
  },
  {
    text: "No Scripture is pasted word-for-word anywhere.",
    hint: "Teaching, key ideas, and reflection scripts are our own words; the app fetches the verse text live from the reference.",
  },
  {
    text: "It reads naturally in the plan's language.",
    hint: "Title, summary, and teaching flow well; reflection scripts sound right read slowly, out loud.",
  },
  {
    text: "The tags are honest, and the reviewer is named.",
    hint: "Audience/focus/length/resources describe what this plan really is and offers; reviewedBy records who checked it.",
  },
];

function lessonPillClass(lp: LessonProgress) {
  if (lp.core && lp.teaching && lp.keyIdea) return "lesson-pill complete";
  if (lp.core || lp.teaching || lp.keyIdea || lp.reflection || lp.prayer) return "lesson-pill partial";
  return "lesson-pill empty";
}

function lessonTooltip(lp: LessonProgress) {
  const missing = [
    !lp.core && "passage/title",
    !lp.teaching && "teaching",
    !lp.keyIdea && "key idea",
    !lp.reflection && "reflection",
    !lp.prayer && "prayer",
  ]
    .filter(Boolean)
    .join(", ");
  return `${lp.n}. ${lp.title}${missing ? ` — missing: ${missing}` : " — fully drafted"}`;
}

export default function StepReview(props: {
  draft: Draft;
  /** True when this plan's checklist was completed before a reopen — boxes start ticked for a re-confirm. */
  initialAllChecked?: boolean;
  onStartOver: () => void;
  onFinish: (checklistDone: boolean) => void;
}) {
  const { draft } = props;
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => !!props.initialAllChecked));
  const [showJson, setShowJson] = useState(false);

  const progress = useMemo(() => planProgress(draft, "in_progress", false), [draft]);

  const { doc, errors } = useMemo(() => {
    const doc = buildPlanDoc(draft);
    const result = lessonPlanDocSchema.safeParse(doc);
    const errors = result.success
      ? []
      : result.error.issues.map((i) => {
          const path = i.path.length ? i.path.join(" › ") : "plan";
          return `${humanizePath(path)} — ${i.message}`;
        });
    return { doc, errors };
  }, [draft]);

  const json = useMemo(() => JSON.stringify(doc, null, 2), [doc]);
  const valid = errors.length === 0;
  const allChecked = checked.every(Boolean);
  const quizCount = draft.lessons.filter((l) => l.quiz.enabled).length;

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.planId || "lesson-plan"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Card title={draft.title || "Untitled plan"} note={draft.subtitle}>
        <div className="summary-stats">
          <div>
            <div className="stat-num">{draft.lessons.length}</div>
            <div className="stat-label">Lessons</div>
          </div>
          <div>
            <div className="stat-num">{quizCount}</div>
            <div className="stat-label">Quizzes</div>
          </div>
          <div>
            <div className="stat-num">{draft.language.toUpperCase()}</div>
            <div className="stat-label">{draft.translation}</div>
          </div>
          <div>
            <div className="stat-num" style={{ fontSize: 20, paddingTop: 6 }}>
              <span className="badge badge-gold">draft</span>
            </div>
            <div className="stat-label">Export status</div>
          </div>
        </div>
        <p className="field-help">
          Plans always export as <code>status: "draft"</code> — drafts never appear in
          matching. Flip to <code>published</code> in the JSON only after editorial and
          theological review in Scripture Studio.
        </p>
      </Card>

      <Card
        title="What the machine checked"
        note="Computed automatically — the same measure the admin dashboard shows. The reviewer checklist below covers only what a human must judge."
      >
        <div className="plan-detail-cols">
          <ul className="detail-list">
            <li>{progress.details ? "✓" : "○"} Plan details ({progress.detailsFilled}/{progress.detailsTotal} fields)</li>
            <li>{progress.audience ? "✓" : "○"} Audience tags</li>
            <li>
              {progress.lessonsComplete === progress.lessonsTotal && progress.lessonsTotal > 0 ? "✓" : "○"} Lessons
              drafted {progress.lessonsComplete}/{progress.lessonsTotal}
            </li>
            <li>○ Images {progress.imagesChosen}/{progress.lessonsTotal} <span className="detail-soft">(optional)</span></li>
            <li>○ Videos {progress.videosAdded}/{progress.lessonsTotal} <span className="detail-soft">(optional)</span></li>
            <li>{progress.quizzesOk > 0 ? "✓" : "○"} Quizzes ready: {progress.quizzesOk}</li>
            <li>
              {valid ? (
                <>✓ Passes the Studio schema</>
              ) : (
                <span style={{ color: "var(--error)" }}>✗ Studio schema — {errors.length} issue{errors.length === 1 ? "" : "s"} (below)</span>
              )}
            </li>
          </ul>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="detail-caption">
              Lessons — <span className="pill-dot complete" /> drafted · <span className="pill-dot partial" /> partial ·{" "}
              <span className="pill-dot empty" /> empty (hover for detail)
            </div>
            <div className="lesson-grid">
              {progress.lessons.map((lp) => (
                <span key={lp.n} className={lessonPillClass(lp)} title={lessonTooltip(lp)}>
                  {lp.n}
                </span>
              ))}
              {progress.lessons.length === 0 && <span className="detail-soft">No lessons yet.</span>}
            </div>
          </div>
        </div>
      </Card>

      {valid ? (
        <div className="notice notice-ok">
          ✓ The plan passes the Scripture Studio schema — the seeder will accept it as-is.
        </div>
      ) : (
        <Card title="Fix before export" note="These are the same checks the Studio seeder runs. You can still download the JSON below to save your progress — it just won't seed until these pass.">
          {draft.lessons.length > 40 && (
            <div className="notice notice-info" style={{ marginBottom: 14 }}>
              This plan has <strong>{draft.lessons.length} lessons</strong>, but the library
              holds at most <strong>40 per plan</strong>. The usual fix is to split long
              programs into volumes (e.g. “Part 1” and “Part 2” as two plans) — remove the
              later lessons here, export part 1, then reopen the saved JSON idea for part 2.
            </div>
          )}
          <ul className="error-list">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Reviewer checklist"
        note="Five things only you can judge — publishing to the Studio requires all of them. Tick each one only after actually checking it."
      >
        {props.initialAllChecked && (
          <div className="notice notice-info" style={{ marginBottom: 12 }}>
            This checklist was completed before the plan was reopened, so the boxes start
            ticked — glance through them again and untick anything your edits put in doubt.
          </div>
        )}
        {CHECKLIST.map((item, i) => (
          <label className="check-item" key={i}>
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))}
            />
            <span>
              <strong>{item.text}</strong>
              <div className="field-help" style={{ marginTop: 2 }}>{item.hint}</div>
            </span>
          </label>
        ))}
      </Card>

      <Card
        title="Export"
        note={
          <>
            Save the file as{" "}
            <code>data/lesson-plans/{draft.planId || "{planId}"}.json</code> in Scripture
            Studio, then run <code>npm run db:seed:plans</code> (and optionally{" "}
            <code>npm run tts:render</code> for reflection audio) and test at{" "}
            <code>/studio/lesson-plan</code>.
          </>
        }
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={download}>
            ⤓ Download {draft.planId || "lesson-plan"}.json
          </button>
          <button className="btn" onClick={() => navigator.clipboard.writeText(json)}>
            Copy JSON
          </button>
          <button className="btn btn-ghost" onClick={() => setShowJson(!showJson)}>
            {showJson ? "Hide" : "Preview"} JSON
          </button>
        </div>
        {!valid && (
          <p className="field-help" style={{ marginTop: 12, color: "var(--error)" }}>
            Downloading is always available so your work is never stuck — but this file will
            fail the Studio seeder until the issues above are fixed.
          </p>
        )}
        {valid && !allChecked && (
          <p className="field-help" style={{ marginTop: 12 }}>
            You can export now, but the checklist above still has unchecked items — the plan
            isn't review-ready until they all pass.
          </p>
        )}
        {showJson && (
          <pre className="json-preview" style={{ marginTop: 16 }}>
            {json}
          </pre>
        )}
      </Card>

      <Card
        title="Finish"
        note="Finishing saves this plan to your completed list (in this browser), marks it done, and clears the workspace for the next PDF. You can reopen or re-download a completed plan any time."
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={() => {
              if (
                allChecked ||
                confirm(
                  "The reviewer checklist isn't fully checked yet — finish anyway and mark the remaining items in review?",
                )
              ) {
                props.onFinish(allChecked);
              }
            }}
          >
            ✓ Finish this plan
          </button>
          {!valid && (
            <span className="field-help">Fix the schema errors above before finishing.</span>
          )}
          {valid && !allChecked && (
            <span className="badge badge-gold">checklist incomplete</span>
          )}
          {valid && allChecked && <span className="badge badge-moss">checklist complete</span>}
        </div>
      </Card>

      <div className="btn-row">
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (confirm("Discard this draft and start over with a new PDF?")) props.onStartOver();
          }}
        >
          Discard draft and start over
        </button>
        <span />
      </div>
    </>
  );
}

function humanizePath(path: string): string {
  return path
    .replace(/^lessons › (\d+)/, (_, n) => `Lesson ${Number(n) + 1}`)
    .replace(/^match › /, "Match tags › ")
    .replace(/quiz › mc/, "quiz");
}
