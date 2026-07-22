"use client";

import { useEffect, useRef, useState } from "react";
import type { Draft, DraftLesson } from "@/lib/types";
import { authedFetch } from "@/lib/planStore";
import { Card } from "./ui";

/**
 * Lesson-image picker: the analysis suggests pages with artwork (artPages),
 * the server renders them locally from the cached PDF (/api/render), and the
 * curator picks + crops — or uploads their own image, which runs through the
 * same crop flow. Renders are fetched with the reviewer's token and shown as
 * blob URLs; the cropped PNG uploads once, at pick time, so the chosen image
 * survives cache expiry and publishes instantly.
 */

interface RenderState {
  url?: string;
  error?: string;
  errorCode?: string;
}

/** Fetch a page render with auth; returns a blob URL plus loading/error state. */
function usePageRender(sourceId: string, page: number, width: number, epoch = 0): RenderState {
  const [state, setState] = useState<RenderState>({});
  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    setState({});
    (async () => {
      try {
        const res = await authedFetch(`/api/render?source=${sourceId}&page=${page}&w=${width}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const err = new Error(body?.error ?? `Rendering failed (HTTP ${res.status}).`);
          (err as any).code = body?.code;
          throw err;
        }
        const blob = await res.blob();
        objUrl = URL.createObjectURL(blob);
        if (alive) setState({ url: objUrl });
      } catch (e) {
        if (alive)
          setState({
            error: e instanceof Error ? e.message : "Rendering failed.",
            errorCode: (e as any)?.code,
          });
      }
    })();
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [sourceId, page, width, epoch]);
  return state;
}

type CropSource = { kind: "page"; page: number } | { kind: "upload"; url: string };

interface CropTarget {
  lessonN: number;
  title: string;
  src: CropSource;
}

export default function StepImages(props: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
}) {
  const { draft, update } = props;
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [attachedPages, setAttachedPages] = useState<number | null>(null);
  const [cacheMissing, setCacheMissing] = useState(false);
  const [renderEpoch, setRenderEpoch] = useState(0);

  const setLesson = (n: number, patch: Partial<DraftLesson>) => {
    update({ lessons: draft.lessons.map((l) => (l.n === n ? { ...l, ...patch } : l)) });
  };

  const applyToAllLessons = (image: NonNullable<DraftLesson["image"]>) => {
    if (
      !confirm(
        `Use this image for all ${draft.lessons.length} lessons? Lessons that already have a different image will be replaced.`,
      )
    ) {
      return;
    }
    update({ lessons: draft.lessons.map((l) => ({ ...l, image: { ...image } })) });
  };

  const closeCrop = () => {
    if (cropTarget?.src.kind === "upload") URL.revokeObjectURL(cropTarget.src.url);
    setCropTarget(null);
  };

  const canRender = !!draft.sourceId;

  return (
    <>
      {!canRender || cacheMissing ? (
        <AttachSource
          language={draft.language}
          cacheMissing={cacheMissing}
          onAttached={(sourceId, pageCount) => {
            update({ sourceId });
            setAttachedPages(pageCount);
            setCacheMissing(false);
            setRenderEpoch((e) => e + 1); // remount thumbnails against the restored cache
          }}
        />
      ) : (
        <div className="notice notice-info">
          {attachedPages !== null ? (
            <>
              ✓ Source PDF attached ({attachedPages} pages). Add each lesson's artwork page
              below —{" "}
            </>
          ) : (
            <>
              The analysis flagged pages that carry real artwork for each session. Click a page
              to crop the illustration you want —{" "}
            </>
          )}
          images are optional, and lessons without one simply show no artwork in the Studio.{" "}
          <strong>Check rights:</strong> only use artwork Biblica is licensed to display in
          apps, not just in print.
        </div>
      )}

      {draft.lessons.map((lesson) => (
        <Card key={lesson.n}>
          <div className="img-lesson-head">
            <span className="lesson-n">{lesson.n}</span>
            <span className="lesson-title" dir="auto">
              {lesson.title || <em style={{ color: "var(--ink-faint)" }}>Untitled lesson</em>}
            </span>
          </div>

          {lesson.image ? (
            <div className="img-chosen">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lesson.image.url} alt={lesson.title} className="img-preview" />
              <div>
                <div className="field-help" style={{ marginBottom: 8 }}>
                  {lesson.image.page ? `Cropped from page ${lesson.image.page}.` : "Uploaded image."}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-small" onClick={() => setLesson(lesson.n, { image: null })}>
                    ✕ Remove image
                  </button>
                  <button
                    className="btn btn-small"
                    title="Copy this image to every lesson in the plan"
                    onClick={() => applyToAllLessons(lesson.image!)}
                  >
                    ⧉ Use for all lessons
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <CandidateRow
              lesson={lesson}
              sourceId={draft.sourceId}
              canRender={canRender}
              epoch={renderEpoch}
              onCacheMiss={() => setCacheMissing(true)}
              onPick={(page) =>
                setCropTarget({ lessonN: lesson.n, title: lesson.title, src: { kind: "page", page } })
              }
              onUpload={(file) =>
                setCropTarget({
                  lessonN: lesson.n,
                  title: lesson.title,
                  src: { kind: "upload", url: URL.createObjectURL(file) },
                })
              }
              onAddPage={(page) =>
                setLesson(lesson.n, { artPages: [...new Set([...lesson.artPages, page])].sort((a, b) => a - b) })
              }
              onRemovePage={(page) =>
                setLesson(lesson.n, { artPages: lesson.artPages.filter((p) => p !== page) })
              }
            />
          )}
        </Card>
      ))}

      {cropTarget &&
        (cropTarget.src.kind === "page" ? (
          <PdfCrop
            sourceId={draft.sourceId}
            page={cropTarget.src.page}
            epoch={renderEpoch}
            heading={`Crop the artwork — page ${cropTarget.src.page}`}
            onClose={closeCrop}
            onDone={(url) => {
              const page = (cropTarget.src as { page: number }).page;
              setLesson(cropTarget.lessonN, { image: { url, page } });
              closeCrop();
            }}
          />
        ) : (
          <CropModal
            src={cropTarget.src.url}
            loading={false}
            loadError=""
            heading="Crop the uploaded image"
            onClose={closeCrop}
            onDone={(url) => {
              setLesson(cropTarget.lessonN, { image: { url, page: null } });
              closeCrop();
            }}
          />
        ))}
    </>
  );
}

/** Loads a hi-res page render, then hands it to the generic crop modal. */
function PdfCrop(props: {
  sourceId: string;
  page: number;
  epoch: number;
  heading: string;
  onClose: () => void;
  onDone: (url: string) => void;
}) {
  const render = usePageRender(props.sourceId, props.page, 1600, props.epoch);
  return (
    <CropModal
      src={render.url ?? null}
      loading={!render.url && !render.error}
      loadError={render.error ?? ""}
      heading={props.heading}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}

function AttachSource(props: {
  language: string;
  cacheMissing?: boolean;
  onAttached: (sourceId: string, pageCount: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const attach = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", props.language);
      const res = await authedFetch("/api/source", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Attaching failed (HTTP ${res.status}).`);
      props.onAttached(body.sourceId as string, body.pageCount as number);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Attaching failed — try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="notice notice-info">
      {props.cacheMissing ? (
        <>
          The server no longer has this plan's source PDF (its cache resets when the app is
          redeployed), so pages can't be rendered right now — already-picked images are safe.{" "}
        </>
      ) : (
        <>
          This plan isn't linked to a source PDF on this server, so page renders aren't
          available yet — existing images are kept.{" "}
        </>
      )}
      <strong>Attach the original booklet PDF</strong> to enable page renders (no re-analysis,
      no AI cost; your edits are untouched). You can also upload standalone images per lesson
      below.
      <div style={{ marginTop: 10 }}>
        <button className="btn btn-small" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Attaching…" : "⤒ Attach source PDF"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => attach(e.target.files?.[0])}
        />
      </div>
      {error && (
        <div className="field-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function Thumb(props: {
  sourceId: string;
  page: number;
  epoch: number;
  onPick: () => void;
  onRemove: () => void;
  onCacheMiss: () => void;
}) {
  const render = usePageRender(props.sourceId, props.page, 360, props.epoch);
  const { onCacheMiss } = props;
  useEffect(() => {
    if (render.errorCode === "cache-miss") onCacheMiss();
  }, [render.errorCode, onCacheMiss]);

  return (
    <div className="thumb-wrap">
      <button
        type="button"
        className="thumb-remove"
        title={`Remove page ${props.page} from this lesson's candidates`}
        onClick={props.onRemove}
      >
        ✕
      </button>
      {render.error ? (
        <div className="thumb thumb-broken" title={render.error}>
          <span>unavailable</span>
          <span className="thumb-label">p. {props.page}</span>
        </div>
      ) : (
        <button
          type="button"
          className="thumb"
          title={`Crop an image from page ${props.page}`}
          disabled={!render.url}
          onClick={props.onPick}
        >
          {render.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={render.url} alt={`Page ${props.page}`} />
          ) : (
            <span className="thumb-loading" aria-label="Rendering…" />
          )}
          <span className="thumb-label">p. {props.page}</span>
        </button>
      )}
    </div>
  );
}

function CandidateRow(props: {
  lesson: DraftLesson;
  sourceId: string;
  canRender: boolean;
  epoch: number;
  onCacheMiss: () => void;
  onPick: (page: number) => void;
  onUpload: (file: File) => void;
  onAddPage: (page: number) => void;
  onRemovePage: (page: number) => void;
}) {
  const [manual, setManual] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const pages = props.lesson.artPages;

  return (
    <>
      {props.canRender && pages.length === 0 && (
        <p className="field-help" style={{ marginBottom: 10 }}>
          The analysis found no artwork for this session — add a page number, or upload an
          image of your own.
        </p>
      )}
      <div className="thumb-row">
        {props.canRender &&
          pages.map((p) => (
            <Thumb
              key={`${p}-${props.epoch}`}
              sourceId={props.sourceId}
              page={p}
              epoch={props.epoch}
              onCacheMiss={props.onCacheMiss}
              onPick={() => props.onPick(p)}
              onRemove={() => props.onRemovePage(p)}
            />
          ))}
        <div className="thumb-add">
          {props.canRender && (
            <>
              <input
                type="number"
                min={1}
                placeholder="page #"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
              <button
                className="btn btn-small"
                disabled={!Number.isInteger(Number(manual)) || Number(manual) < 1}
                onClick={() => {
                  props.onAddPage(Number(manual));
                  setManual("");
                }}
              >
                + Add page
              </button>
            </>
          )}
          <button
            className="btn btn-small"
            title="Upload your own image for this lesson (PNG or JPG) — it goes through the same crop step"
            onClick={() => uploadRef.current?.click()}
          >
            ⤒ Upload image
          </button>
          <input
            ref={uploadRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onUpload(f);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </div>
    </>
  );
}

interface Sel {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cropped uploads are downscaled to this width so PNGs stay small and fast. */
const MAX_OUTPUT_WIDTH = 1600;

function CropModal(props: {
  src: string | null;
  loading: boolean;
  loadError: string;
  heading: string;
  onClose: () => void;
  onDone: (url: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgReady, setImgReady] = useState(false);
  const [error, setError] = useState("");

  const localPoint = (e: React.PointerEvent) => {
    const rect = imgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
    };
  };

  /** Output pixel size of the current selection (or whole image). */
  const outputDims = (crop: Sel | null): { w: number; h: number } | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const rect = img.getBoundingClientRect();
    const fx = img.naturalWidth / rect.width;
    const fy = img.naturalHeight / rect.height;
    const sw = crop ? Math.max(1, Math.round(crop.w * fx)) : img.naturalWidth;
    const sh = crop ? Math.max(1, Math.round(crop.h * fy)) : img.naturalHeight;
    const outW = Math.min(sw, MAX_OUTPUT_WIDTH);
    return { w: outW, h: Math.round((sh * outW) / sw) };
  };

  const upload = async (crop: Sel | null) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) {
      setError("The image hasn't loaded yet — wait a moment and try again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const rect = img.getBoundingClientRect();
      const fx = img.naturalWidth / rect.width;
      const fy = img.naturalHeight / rect.height;
      const sx = crop ? Math.round(crop.x * fx) : 0;
      const sy = crop ? Math.round(crop.y * fy) : 0;
      const sw = crop ? Math.max(1, Math.round(crop.w * fx)) : img.naturalWidth;
      const sh = crop ? Math.max(1, Math.round(crop.h * fy)) : img.naturalHeight;
      const outW = Math.min(sw, MAX_OUTPUT_WIDTH);
      const outH = Math.round((sh * outW) / sw);

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("Couldn't read the cropped image.");

      const form = new FormData();
      form.append("file", new File([blob], "lesson-image.png", { type: "image/png" }));
      const res = await authedFetch("/api/lesson-image", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Upload failed (HTTP ${res.status}).`);
      props.onDone(body.url as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
      setBusy(false);
    }
  };

  const usable = imgReady && !busy;
  const dims = imgReady ? outputDims(sel) : null;
  const ratioLabel = dims ? `${dims.w}×${dims.h}px · ${(dims.w / Math.max(1, dims.h)).toFixed(2)}:1` : "";

  return (
    <div className="crop-backdrop" onClick={() => !busy && props.onClose()}>
      <div className="crop-panel" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, marginBottom: 4 }}>{props.heading}</h3>
        <p className="field-help" style={{ marginBottom: 12 }}>
          Drag a rectangle around the artwork, or use the whole image. Wide crops (roughly
          16:9 to 3:2) sit best above the lesson text in the Studio.
        </p>
        {(error || props.loadError) && (
          <div className="notice notice-error">{error || props.loadError}</div>
        )}
        <div
          className="crop-stage"
          onPointerDown={(e) => {
            if (busy || !imgReady || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = localPoint(e);
            dragStart.current = p;
            setSel({ x: p.x, y: p.y, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (!dragStart.current) return;
            const p = localPoint(e);
            const s = dragStart.current;
            setSel({
              x: Math.min(s.x, p.x),
              y: Math.min(s.y, p.y),
              w: Math.abs(p.x - s.x),
              h: Math.abs(p.y - s.y),
            });
          }}
          onPointerUp={() => {
            dragStart.current = null;
            setSel((s) => (s && s.w > 15 && s.h > 15 ? s : null));
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            setSel(null);
          }}
          onLostPointerCapture={() => {
            dragStart.current = null;
          }}
        >
          {props.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={props.src}
              alt="Crop source"
              draggable={false}
              onLoad={() => setImgReady(true)}
            />
          ) : props.loading ? (
            <div className="crop-loading">Rendering…</div>
          ) : null}
          {sel && (
            <div
              className="crop-rect"
              style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}
            />
          )}
        </div>
        {imgReady && (
          <div className="crop-meta">
            {sel ? `Selection → ${ratioLabel}` : `Whole image → ${ratioLabel}`}
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={props.onClose}>
            Cancel
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" disabled={!usable} onClick={() => upload(null)}>
              {busy ? "Saving…" : "Use whole image"}
            </button>
            <button className="btn btn-primary" disabled={!usable || !sel} onClick={() => upload(sel)}>
              {busy ? "Saving…" : "Use selection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
