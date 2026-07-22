"use client";

import { useState } from "react";
import type { Draft, DraftLesson } from "@/lib/types";
import { emptyLesson } from "@/lib/types";
import { parseReference, isValidUsfm } from "@/lib/usfm";
import { TextArea, TextField } from "./ui";

export default function StepLessons(props: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
}) {
  const { draft, update } = props;
  const [open, setOpen] = useState<number | null>(draft.lessons.length ? 1 : null);

  const setLesson = (n: number, patch: Partial<DraftLesson>) => {
    update({
      lessons: draft.lessons.map((l) => (l.n === n ? { ...l, ...patch } : l)),
    });
  };

  const addLesson = () => {
    const n = draft.lessons.length + 1;
    update({ lessons: [...draft.lessons, emptyLesson(n)] });
    setOpen(n);
  };

  const removeLesson = (n: number) => {
    const next = draft.lessons.filter((l) => l.n !== n).map((l, i) => ({ ...l, n: i + 1 }));
    update({ lessons: next });
    setOpen(null);
  };

  return (
    <>
      <div className="notice notice-info">
        Each session from the PDF became one lesson. Review everything — especially the{" "}
        <strong>quiz answers</strong>: a wrong “correct” answer on Scripture is a trust
        failure. Quizzes the analysis drafted (rather than found in the PDF) still need a
        careful read against the passage.
      </div>

      {draft.lessons.map((lesson) => (
        <LessonEditor
          key={lesson.n}
          lesson={lesson}
          isOpen={open === lesson.n}
          onToggle={() => setOpen(open === lesson.n ? null : lesson.n)}
          onChange={(patch) => setLesson(lesson.n, patch)}
          onRemove={() => removeLesson(lesson.n)}
        />
      ))}

      <button className="btn" onClick={addLesson}>
        + Add a lesson
      </button>
    </>
  );
}

function LessonEditor(props: {
  lesson: DraftLesson;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DraftLesson>) => void;
  onRemove: () => void;
}) {
  const { lesson: l, onChange } = props;
  const usfmOk = isValidUsfm(l.verseUsfm);

  const deriveUsfm = () => {
    const parsed = parseReference(l.ref);
    if (parsed) onChange({ verseUsfm: parsed.usfm });
  };

  const setQuiz = (patch: Partial<DraftLesson["quiz"]>) => onChange({ quiz: { ...l.quiz, ...patch } });

  const correctCount = l.quiz.options.filter((o) => o.correct).length;

  return (
    <div className="lesson">
      <button className="lesson-head" onClick={props.onToggle}>
        <span className="lesson-n">{l.n}</span>
        <span className="lesson-title" dir="auto">
          {l.title || <em style={{ color: "var(--ink-faint)" }}>Untitled lesson</em>}
          <div className="lesson-ref" dir="auto">
            {l.ref || "no passage yet"}
            {!usfmOk && (
              <span className="badge badge-error" style={{ marginLeft: 8 }}>
                USFM missing
              </span>
            )}
            {l.quiz.enabled && correctCount !== 1 && (
              <span className="badge badge-error" style={{ marginLeft: 8 }}>
                quiz answer
              </span>
            )}
          </div>
        </span>
        <span style={{ color: "var(--ink-faint)" }}>{props.isOpen ? "▴" : "▾"}</span>
      </button>

      {props.isOpen && (
        <div className="lesson-body">
          <div className="grid-2" style={{ marginTop: 14 }}>
            <TextField label="Title" value={l.title} onChange={(v) => onChange({ title: v })} max={120} />
            <TextField
              label="Key verse (shown large)"
              value={l.keyVerseRef}
              onChange={(v) => onChange({ keyVerseRef: v })}
              max={80}
              help="Optional single anchor verse; falls back to the passage."
            />
          </div>
          <div className="grid-2">
            <TextField
              label="Passage (display form)"
              value={l.ref}
              onChange={(v) => onChange({ ref: v })}
              max={80}
              placeholder="Judges 6:11-16"
            />
            <div className="field">
              <label className="field-label">
                <span>Verse USFM</span>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  className="mono"
                  value={l.verseUsfm}
                  onChange={(e) => onChange({ verseUsfm: e.target.value.toUpperCase() })}
                  placeholder="JDG.6.11-16"
                  style={!usfmOk ? { borderColor: "var(--error)" } : undefined}
                />
                <button className="btn btn-small" onClick={deriveUsfm} title="Derive from an English-book-name passage">
                  Derive
                </button>
              </div>
              <div className="field-help">
                Canonical code the runtime fetches text with, e.g. PSA.56.11 or JHN.1.1-14.
              </div>
            </div>
          </div>

          <hr className="divider" />
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>Teaching paragraphs</h3>
          {l.teaching.map((p, i) => (
            <div className="para-row" key={i}>
              <textarea
                dir="auto"
                rows={3}
                value={p}
                onChange={(e) =>
                  onChange({ teaching: l.teaching.map((t, j) => (j === i ? e.target.value : t)) })
                }
              />
              <button
                className="btn btn-small btn-ghost"
                title="Remove paragraph"
                onClick={() => onChange({ teaching: l.teaching.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-small" onClick={() => onChange({ teaching: [...l.teaching, ""] })}>
            + Paragraph
          </button>
          <div className="field-help" style={{ marginTop: 8 }}>
            Paraphrase Scripture — never paste verse text verbatim. The Word itself is fetched
            live via the reference.
          </div>

          <hr className="divider" />
          <TextArea
            label="Key idea (“hold on to this”)"
            value={l.keyIdea}
            onChange={(v) => onChange({ keyIdea: v })}
            max={400}
            rows={2}
          />
          <TextArea
            label="Prayer"
            value={l.prayer}
            onChange={(v) => onChange({ prayer: v })}
            rows={2}
            help="Optional closing prayer."
          />
          <TextArea
            label="Reflection script (audio narration)"
            value={l.reflectionScript}
            onChange={(v) => onChange({ reflectionScript: v })}
            max={2000}
            rows={3}
            help="Optional ~20–45s guided reflection a calm narrator reads. Your prose, never Scripture text. Rendered to MP3 later via tts:render."
          />

          <hr className="divider" />
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>
            Comprehension quiz{" "}
            <button
              className="btn btn-small"
              style={{ marginLeft: 10 }}
              onClick={() => setQuiz({ enabled: !l.quiz.enabled })}
            >
              {l.quiz.enabled ? "Remove quiz" : "Add quiz"}
            </button>
          </h3>
          {l.quiz.enabled ? (
            <>
              {correctCount !== 1 && (
                <div className="notice notice-error" style={{ marginTop: 10 }}>
                  Exactly one option must be marked correct (currently {correctCount}). Click the
                  circle next to the right answer.
                </div>
              )}
              <TextArea
                label="Question"
                value={l.quiz.question}
                onChange={(v) => setQuiz({ question: v })}
                max={280}
                rows={2}
              />
              <div className="field">
                <label className="field-label">
                  <span>Options — mark the verified correct answer</span>
                </label>
                {l.quiz.options.map((o, i) => (
                  <div className="quiz-option" key={i}>
                    <button
                      type="button"
                      className={`correct-toggle${o.correct ? " on" : ""}`}
                      title="Mark as the correct answer"
                      onClick={() =>
                        setQuiz({
                          options: l.quiz.options.map((opt, j) => ({ ...opt, correct: j === i })),
                        })
                      }
                    >
                      ✓
                    </button>
                    <span className="mono" style={{ color: "var(--ink-faint)" }}>
                      {o.id}
                    </span>
                    <input
                      type="text"
                      dir="auto"
                      value={o.text}
                      onChange={(e) =>
                        setQuiz({
                          options: l.quiz.options.map((opt, j) =>
                            j === i ? { ...opt, text: e.target.value } : opt,
                          ),
                        })
                      }
                    />
                    {l.quiz.options.length > 2 && (
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() =>
                          setQuiz({ options: l.quiz.options.filter((_, j) => j !== i) })
                        }
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {l.quiz.options.length < 5 && (
                  <button
                    className="btn btn-small"
                    onClick={() =>
                      setQuiz({
                        options: [
                          ...l.quiz.options,
                          {
                            id: "abcde"[l.quiz.options.length],
                            text: "",
                            correct: false,
                          },
                        ],
                      })
                    }
                  >
                    + Option
                  </button>
                )}
              </div>
              <div className="grid-2">
                <TextArea
                  label="Feedback when right"
                  value={l.quiz.good}
                  onChange={(v) => setQuiz({ good: v })}
                  max={400}
                  rows={2}
                />
                <TextArea
                  label="Gentle correction when wrong"
                  value={l.quiz.bad}
                  onChange={(v) => setQuiz({ bad: v })}
                  max={400}
                  rows={2}
                />
              </div>
              <TextArea
                label="Reflection prompt (open, no wrong answer)"
                value={l.quiz.reflectPrompt}
                onChange={(v) => setQuiz({ reflectPrompt: v })}
                max={400}
                rows={2}
                help="Private to the learner — never seen by the leader."
              />
            </>
          ) : (
            <p className="field-help" style={{ marginTop: 6 }}>
              No quiz — the learner simply skips the check step for this lesson.
            </p>
          )}

          <hr className="divider" />
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>Scriptures to consider</h3>
          {l.supportingScriptures.map((s, i) => (
            <div className="quiz-option" key={i}>
              <input
                type="text"
                dir="auto"
                placeholder="Isaiah 41:10"
                value={s.ref}
                onChange={(e) => {
                  const next = l.supportingScriptures.map((x, j) =>
                    j === i ? { ...x, ref: e.target.value } : x,
                  );
                  onChange({ supportingScriptures: next });
                }}
              />
              <input
                type="text"
                className="mono"
                placeholder="ISA.41.10"
                style={{ maxWidth: 170 }}
                value={s.usfm}
                onChange={(e) => {
                  const next = l.supportingScriptures.map((x, j) =>
                    j === i ? { ...x, usfm: e.target.value.toUpperCase() } : x,
                  );
                  onChange({ supportingScriptures: next });
                }}
              />
              <button
                className="btn btn-small btn-ghost"
                onClick={() =>
                  onChange({ supportingScriptures: l.supportingScriptures.filter((_, j) => j !== i) })
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn btn-small"
            onClick={() =>
              onChange({ supportingScriptures: [...l.supportingScriptures, { ref: "", usfm: "" }] })
            }
          >
            + Scripture
          </button>

          <hr className="divider" />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn btn-small"
              style={{ color: "var(--error)", borderColor: "var(--error)" }}
              onClick={() => {
                if (confirm(`Remove lesson ${l.n} (“${l.title || "untitled"}”)?`)) props.onRemove();
              }}
            >
              Remove this lesson
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
