"use client";

import { useMemo, useState } from "react";
import { lessonPlanDocSchema } from "@/lib/schema";
import { buildPlanDoc, type Draft } from "@/lib/types";
import { Card } from "./ui";

const CHECKLIST = [
  "planId is a clean slug and will be the file name.",
  "Match tags honestly reflect audience, focus, and length.",
  "Resources list only what the plan actually delivers.",
  "Every lesson has a real passage reference and correct USFM code.",
  "No verbatim Scripture pasted into teaching, key ideas, or reflection scripts.",
  "Every quiz's correct answer and feedback verified against the passage (especially AI-drafted quizzes).",
  "Reflection scripts read well aloud and are pastoral in tone.",
  "Provenance recorded in reviewedBy.",
];

export default function StepReview(props: {
  draft: Draft;
  onStartOver: () => void;
  onFinish: (checklistDone: boolean) => void;
}) {
  const { draft } = props;
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [showJson, setShowJson] = useState(false);

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
        note="From LESSON_PLAN_AUTHORING.md §13 — work through it before handing the file to review."
      >
        {CHECKLIST.map((item, i) => (
          <label className="check-item" key={i}>
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))}
            />
            <span>{item}</span>
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
