"use client";

import { useRef, useState } from "react";
import { renderNarration } from "@/lib/narration";
import type { Draft, DraftLesson, DraftLessonAudio, DraftLessonVideo } from "@/lib/types";
import { emptyLesson, narrationFresh } from "@/lib/types";
import { parseReference, isValidUsfm } from "@/lib/usfm";
import {
  VIDEO_ACCEPT,
  fmtBytes,
  fmtDuration,
  isVideoFile,
  probeVideoDuration,
  unsupportedVideoHost,
  uploadVideoFile,
  youTubeEmbedUrl,
  youTubeVideoId,
} from "@/lib/videoUpload";
import { ArtworkSection } from "./LessonArtwork";
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
          planId={draft.planId}
          language={draft.language}
          sourceId={draft.sourceId}
          lessonCount={draft.lessons.length}
          isOpen={open === lesson.n}
          onToggle={() => setOpen(open === lesson.n ? null : lesson.n)}
          onChange={(patch) => setLesson(lesson.n, patch)}
          onRemove={() => removeLesson(lesson.n)}
          onApplyImageToAll={(image) => {
            if (
              draft.lessons.length < 2 ||
              confirm(
                `Use this image for all ${draft.lessons.length} lessons? It replaces any artwork already chosen on other lessons.`,
              )
            ) {
              update({ lessons: draft.lessons.map((x) => ({ ...x, image: { ...image } })) });
            }
          }}
          onVideoAttached={() => {
            // A plan with real videos offers video — tick the matcher tag the
            // curator would otherwise have to remember (visible in "Who it's
            // for", untick there to opt out).
            if (!draft.match.resources.includes("video")) {
              update({ match: { ...draft.match, resources: [...draft.match.resources, "video"] } });
            }
          }}
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
  planId: string;
  language: "en" | "ar";
  sourceId: string;
  lessonCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DraftLesson>) => void;
  onRemove: () => void;
  onVideoAttached: () => void;
  onApplyImageToAll: (image: NonNullable<DraftLesson["image"]>) => void;
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
            help="Optional ~20–45s guided reflection a calm narrator reads. Your prose, never Scripture text."
          />
          <NarrationSection
            lesson={l}
            planId={props.planId}
            language={props.language}
            onRendered={(audio) => onChange({ reflectionAudio: audio })}
          />

          <hr className="divider" />
          <VideoSection
            video={l.video}
            onAttach={(video) => {
              onChange({ video });
              props.onVideoAttached();
            }}
            onRemove={() => onChange({ video: null })}
          />

          <hr className="divider" />
          <ArtworkSection
            lesson={l}
            sourceId={props.sourceId}
            lessonCount={props.lessonCount}
            onChange={onChange}
            onApplyToAll={props.onApplyImageToAll}
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

/**
 * In-editor narration: render the reflection script to MP3 and listen right
 * here, so script problems are heard and fixed BEFORE finishing. The audio
 * goes stale the moment the script changes; the Review step blocks Finish
 * until every scripted lesson has fresh audio, and publishing uses these
 * recordings as-is (it no longer synthesizes anything).
 */
function NarrationSection(props: {
  lesson: DraftLesson;
  planId: string;
  language: "en" | "ar";
  onRendered: (audio: DraftLessonAudio) => void;
}) {
  const { lesson } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!lesson.reflectionScript.trim()) return null;
  const fresh = narrationFresh(lesson);
  const audio = lesson.reflectionAudio;

  const render = async () => {
    setBusy(true);
    setError("");
    try {
      props.onRendered(await renderNarration(lesson, props.planId, props.language));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Narration failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narration-box">
      {audio && (
        <audio controls preload="metadata" src={audio.url} style={{ width: "100%", maxWidth: 420, display: "block" }} />
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: audio ? 8 : 0 }}>
        <button className="btn btn-small" disabled={busy} onClick={render}>
          {busy ? "Recording…" : audio ? "🎙 Re-render narration" : "🎙 Render narration"}
        </button>
        {audio && fresh && (
          <span className="badge badge-moss" title={`Rendered from this exact script${audio.duration ? ` · ~${Math.round(audio.duration)}s` : ""}`}>
            narration ready
          </span>
        )}
        {audio && !fresh && (
          <span className="badge badge-amber" title="The reflection script changed after this was recorded">
            script changed — re-render
          </span>
        )}
        {!audio && (
          <span className="field-help" style={{ marginTop: 0 }}>
            Listen before you finish — narration is required for every reflection script.
          </span>
        )}
      </div>
      {busy && (
        <div className="field-help" style={{ marginTop: 6 }}>
          Recording with the natural voice — a few seconds per lesson…
        </div>
      )}
      {error && (
        <div className="notice notice-error" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Per-lesson teaching video: upload a file (chunked to Storage at attach
 * time, so it survives cache expiry like lesson images) or paste a hosted
 * URL. Exported as media.video; the Studio player renders it above the
 * lesson. Duration is read from the file's metadata when possible.
 */
function VideoSection(props: {
  video: DraftLessonVideo | null;
  onAttach: (video: DraftLessonVideo) => void;
  onRemove: () => void;
}) {
  const { video } = props;
  const [progress, setProgress] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const pickFile = async (file: File | null | undefined) => {
    if (!file) return;
    setError("");
    if (!isVideoFile(file)) {
      setError("Use an MP4, WebM, or QuickTime video file (MP4 · H.264 plays everywhere).");
      return;
    }
    setProgress(0);
    try {
      const duration = await probeVideoDuration(file);
      const { url } = await uploadVideoFile(file, setProgress);
      props.onAttach({ url, duration, fileName: file.name, sizeBytes: file.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed — try again.");
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const attachUrl = async () => {
    const url = urlInput.trim();
    setError("");
    if (!/^https:\/\/.+/i.test(url)) {
      setError("Paste a full https:// link to a YouTube video or a hosted video file.");
      return;
    }
    // YouTube links play through the official embed player (a watch URL is a
    // web page — the native <video> element can't play it directly).
    if (youTubeVideoId(url)) {
      props.onAttach({ url, duration: null, fileName: "", sizeBytes: null });
      setUrlInput("");
      return;
    }
    const pageHost = unsupportedVideoHost(url);
    if (pageHost) {
      setError(
        `${pageHost} links can't play inside the lesson player. Use a YouTube link, upload the video file, or paste a direct video-file URL (.mp4/.webm).`,
      );
      return;
    }
    const duration = await probeVideoDuration(url);
    props.onAttach({ url, duration, fileName: "", sizeBytes: null });
    setUrlInput("");
  };

  return (
    <>
      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Teaching video</h3>
      {video ? (
        <div style={{ marginTop: 10 }}>
          {youTubeVideoId(video.url) ? (
            <iframe
              src={youTubeEmbedUrl(youTubeVideoId(video.url)!)}
              title="Teaching video preview"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              // YouTube's player needs an identifiable embedding origin or it
              // fails with error 153 — send only the origin (matches the
              // Studio player's fix; also guards against a future global
              // no-referrer policy here).
              referrerPolicy="origin"
              style={{
                display: "block",
                maxWidth: 420,
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "#0f2537",
              }}
            />
          ) : (
            <video
              controls
              preload="metadata"
              src={video.url}
              style={{
                display: "block",
                maxWidth: 420,
                width: "100%",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "#0f2537",
              }}
            />
          )}
          <div className="field-help" style={{ marginTop: 6 }}>
            {youTubeVideoId(video.url) && <>YouTube · </>}
            {video.fileName || video.url}
            {fmtDuration(video.duration) && <> · {fmtDuration(video.duration)}</>}
            {fmtBytes(video.sizeBytes) && <> · {fmtBytes(video.sizeBytes)}</>}
            <button className="btn btn-small btn-ghost" style={{ color: "var(--error)", marginLeft: 10 }} onClick={props.onRemove}>
              ✕ Remove video
            </button>
          </div>
        </div>
      ) : progress !== null ? (
        <div style={{ marginTop: 10, maxWidth: 420 }}>
          <div className="progress-row">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="progress-num">{Math.round(progress * 100)}%</span>
          </div>
          <div className="field-help" style={{ marginTop: 4 }}>Uploading — keep this tab open…</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <button className="btn btn-small" onClick={() => fileInput.current?.click()}>
              ⤒ Upload video
            </button>
            <span className="field-help" style={{ marginTop: 0 }}>or</span>
            <input
              type="text"
              placeholder="https://… YouTube link or video-file URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              style={{ flex: "1 1 220px", maxWidth: 340 }}
            />
            <button className="btn btn-small" disabled={!urlInput.trim()} onClick={attachUrl}>
              Attach URL
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={VIDEO_ACCEPT}
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>
          <div className="field-help" style={{ marginTop: 6 }}>
            Optional. Plays inside the lesson in Scripture Studio. Upload MP4 (H.264) files, or
            paste a YouTube link (plays via the official embed) or a direct video-file URL.
          </div>
        </>
      )}
      {error && (
        <div className="notice notice-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </>
  );
}
