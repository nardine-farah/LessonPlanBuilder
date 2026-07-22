"use client";

import { useEffect, useRef, useState } from "react";
import type { Draft } from "@/lib/types";
import { formatRanges, parsePageSpec } from "@/lib/pages";
import { Card } from "./ui";

const JOB_KEY = "lpb-job-v1";
const POLL_MS = 4000;
/** Tolerate ~2 minutes of network hiccups before telling the user to reattach. */
const MAX_CONSECUTIVE_POLL_FAILURES = 30;

interface JobProgress {
  stage: string;
  partsTotal: number;
  partsDone: number;
  fileName: string;
}

interface SizeChoice {
  fileName: string;
  tokens: number;
  pageCount: number;
  singlePassMaxTokens: number;
  estimatedParts: number;
}

type AnalyzeMode = { mode: "all" } | { mode: "pages"; pages: string } | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);

export default function StepUpload(props: {
  hasDraft: boolean;
  onAnalyzed: (draft: Draft) => void;
}) {
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<SizeChoice | null>(null);
  const [pagesSpec, setPagesSpec] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeJob = useRef<string | null>(null);

  const pick = (f: File | null | undefined) => {
    setError("");
    setChoice(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    setFile(f);
  };

  /** Poll a job until it finishes. Network blips don't kill the analysis. */
  const pollJob = async (jobId: string, fileName: string) => {
    activeJob.current = jobId;
    setBusy(true);
    setError("");
    localStorage.setItem(JOB_KEY, JSON.stringify({ jobId, fileName }));
    let failures = 0;
    try {
      for (;;) {
        if (activeJob.current !== jobId) return; // superseded
        let body: any = null;
        try {
          const res = await fetch(`/api/analyze?job=${jobId}`);
          body = await res.json();
          if (res.status === 404) throw new FatalError(body?.error ?? "Unknown job.");
          if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
          failures = 0;
        } catch (e) {
          if (e instanceof FatalError) throw e;
          failures += 1;
          if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
            throw new FatalError(
              "Lost contact with the server, but the analysis keeps running and every finished part is saved. Reload this page (or re-upload the same file) to reattach.",
            );
          }
          await sleep(POLL_MS);
          continue;
        }

        const job = body.job;
        if (job.status === "done" && job.draft) {
          localStorage.removeItem(JOB_KEY);
          props.onAnalyzed(job.draft as Draft);
          return;
        }
        if (job.status === "error") {
          throw new FatalError(job.error ?? "The analysis failed.");
        }
        setProgress({
          stage: job.stage ?? "working",
          partsTotal: job.partsTotal ?? 0,
          partsDone: job.partsDone ?? 0,
          fileName: job.fileName || fileName,
        });
        await sleep(POLL_MS);
      }
    } catch (e) {
      localStorage.removeItem(JOB_KEY);
      setError(e instanceof Error ? e.message : "Something went wrong — please retry.");
    } finally {
      if (activeJob.current === jobId) {
        activeJob.current = null;
        setBusy(false);
        setProgress(null);
      }
    }
  };

  // Reattach to an in-flight job after a page reload.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_KEY);
      if (!raw) return;
      const { jobId, fileName } = JSON.parse(raw);
      if (jobId) {
        setProgress({ stage: "reattaching to the running analysis", partsTotal: 0, partsDone: 0, fileName: fileName ?? "" });
        void pollJob(jobId, fileName ?? "");
      }
    } catch {
      localStorage.removeItem(JOB_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyze = async (chosen: AnalyzeMode = null) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress({
      stage: chosen ? "starting the analysis" : "uploading & measuring the document",
      partsTotal: 0,
      partsDone: 0,
      fileName: file.name,
    });
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", language);
      if (chosen) {
        form.append("mode", chosen.mode);
        if (chosen.mode === "pages") form.append("pages", chosen.pages);
      }
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok && res.status !== 202) {
        throw new Error(body?.error ?? `The analysis failed to start (HTTP ${res.status}).`);
      }
      if (body.needsChoice) {
        // Too big for one pass — let the curator decide how to proceed.
        setChoice({ fileName: body.fileName, ...body.measurement });
        setBusy(false);
        setProgress(null);
        return;
      }
      setChoice(null);
      if (body.job?.status === "done" && body.job.draft) {
        // Same file + choice was analyzed before — cached result, no tokens spent.
        props.onAnalyzed(body.job.draft as Draft);
        setBusy(false);
        setProgress(null);
        return;
      }
      await pollJob(body.jobId, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please retry.");
      setBusy(false);
      setProgress(null);
    }
  };

  const parsedPages = choice && pagesSpec.trim() ? parsePageSpec(pagesSpec, choice.pageCount) : null;

  if (busy) {
    const parts =
      progress && progress.partsTotal > 1
        ? ` — part ${Math.min(progress.partsDone + 1, progress.partsTotal)} of ${progress.partsTotal}`
        : "";
    return (
      <Card>
        <div className="analyzing">
          <div className="quill" />
          <h2 className="analyzing-title">
            Studying “{progress?.fileName || file?.name || "the document"}”{parts}
          </h2>
          <p className="analyzing-sub">
            {progress?.stage ? capitalize(progress.stage) + "…" : "Working…"}
            <br />
            Long booklets can take several minutes. Progress is saved as it goes — even if
            this tab closes or the connection drops, reloading the page resumes where it
            left off.
          </p>
        </div>
      </Card>
    );
  }

  if (choice && file) {
    return (
      <>
        {error && <div className="notice notice-error">{error}</div>}
        <Card
          title={
            choice.tokens > 0
              ? `“${choice.fileName}” is too large for a single pass`
              : `“${choice.fileName}” may be too large for a single pass`
          }
          note={
            choice.tokens > 0 ? (
              <>
                This document measures <strong>{choice.pageCount} pages</strong> and roughly{" "}
                <strong>{fmtTokens(choice.tokens)} tokens</strong> — a single analysis pass
                handles up to ~{fmtTokens(choice.singlePassMaxTokens)}. Choose how to proceed.
                (Only measuring has happened so far; nothing has been analyzed yet.)
              </>
            ) : (
              <>
                This document has <strong>{choice.pageCount} pages</strong>; its exact size
                couldn't be measured, so it's safer to choose how to proceed. (Nothing has been
                analyzed yet.)
              </>
            )
          }
        >
          <div className="choice-option">
            <div className="choice-text">
              <div className="choice-title">Analyze specific pages</div>
              <div className="choice-hint">
                Best when the sessions you need sit in known sections — front matter, appendices,
                or other programs in the same booklet are skipped. List any mix of pages and
                ranges, e.g. <code>5-48</code> or <code>1-10, 15, 22-30</code>. If the selection
                is still large, it is split into parts automatically.
              </div>
              <div className="range-row">
                <label style={{ flex: 1, minWidth: 220 }}>
                  Pages (1–{choice.pageCount})
                  <input
                    type="text"
                    className="mono"
                    placeholder={`e.g. 5-48, 60, 112-${choice.pageCount}`}
                    value={pagesSpec}
                    onChange={(e) => setPagesSpec(e.target.value)}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={!parsedPages?.ok}
                  onClick={() => analyze({ mode: "pages", pages: pagesSpec })}
                >
                  {parsedPages?.ok
                    ? `Analyze ${parsedPages.pageCount} page${parsedPages.pageCount === 1 ? "" : "s"}`
                    : "Analyze selection"}
                </button>
              </div>
              {parsedPages && !parsedPages.ok && (
                <div className="field-error" style={{ marginTop: 6 }}>
                  {parsedPages.error}
                </div>
              )}
              {parsedPages?.ok && (
                <div className="field-help" style={{ marginTop: 6 }}>
                  Selected: pages {formatRanges(parsedPages.ranges)} ({parsedPages.pageCount} of{" "}
                  {choice.pageCount}).
                </div>
              )}
            </div>
          </div>

          <hr className="divider" />

          <div className="choice-option">
            <div className="choice-text">
              <div className="choice-title">Process the whole document in parts</div>
              <div className="choice-hint">
                The PDF is split into ~{choice.estimatedParts} overlapping page ranges, each
                analyzed separately and merged into one plan. Takes roughly{" "}
                {choice.estimatedParts} × a few minutes and {choice.estimatedParts} analysis
                passes; progress is saved part by part, so an interruption resumes.
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => analyze({ mode: "all" })}>
                  Analyze all {choice.pageCount} pages in ~{choice.estimatedParts} parts
                </button>
              </div>
            </div>
          </div>
        </Card>

        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => setChoice(null)}>
            ← Back to upload
          </button>
          <span />
        </div>
      </>
    );
  }

  return (
    <>
      {props.hasDraft && (
        <div className="notice notice-info">
          A draft is already in progress. Analyzing a new PDF will <strong>replace it</strong>.
        </div>
      )}
      {error && <div className="notice notice-error">{error}</div>}

      <Card
        title="1 · The source document"
        note="Any Biblica program PDF — devotional series, discipleship course, study guide — in any language. The builder reads it and proposes a draft plan; you review and shape everything before export."
      >
        <div
          className={`dropzone${dragging ? " dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="dropzone-icon">✦</div>
          <div className="dropzone-title">
            {file ? file.name : "Drop a PDF here, or click to browse"}
          </div>
          <div className="dropzone-hint">
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB — ready to analyze`
              : "Up to 30 MB · any language · very large booklets are analyzed in parts"}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
      </Card>

      <Card
        title="2 · The plan’s language"
        note="Which language should the finished lesson plan be written in? If the PDF is in another language, the content is translated and adapted during analysis."
      >
        <div className="chip-row">
          <button
            type="button"
            className={`chip${language === "en" ? " on" : ""}`}
            onClick={() => setLanguage("en")}
          >
            English · NIV
          </button>
          <button
            type="button"
            className={`chip${language === "ar" ? " on" : ""}`}
            onClick={() => setLanguage("ar")}
          >
            العربية · NAV
          </button>
        </div>
      </Card>

      <div className="btn-row">
        <span />
        <button className="btn btn-primary" disabled={!file} onClick={() => analyze()}>
          Analyze the PDF →
        </button>
      </div>
    </>
  );
}

class FatalError extends Error {}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
