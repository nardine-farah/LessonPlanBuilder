"use client";

import { useEffect, useRef, useState } from "react";
import type { DraftLesson } from "@/lib/types";
import { authedFetch } from "@/lib/planStore";

/**
 * Per-lesson artwork, inside the lesson editor (images no longer have their
 * own wizard step — they live with the lesson like video and narration).
 * Two ways in:
 *  - "Choose page": a browser of EVERY page in the linked source PDF
 *    (analysis-suggested pages are badged), click a page → crop → save.
 *  - "Upload image": a PNG/JPG/WebP of your own → same crop → save.
 * Crops upload at pick time (/api/lesson-image), so the chosen artwork
 * survives cache expiry and publishes instantly.
 */

interface RenderState {
  url?: string;
  error?: string;
  errorCode?: string;
}

/** Fetch a page render with auth; returns a blob URL plus loading/error state. */
function usePageRender(sourceId: string, page: number, width: number, enabled = true): RenderState {
  const [state, setState] = useState<RenderState>({});
  useEffect(() => {
    if (!enabled) return;
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
  }, [sourceId, page, width, enabled]);
  return state;
}

export function ArtworkSection(props: {
  lesson: DraftLesson;
  sourceId: string;
  lessonCount: number;
  onChange: (patch: Partial<DraftLesson>) => void;
  onApplyToAll: (image: NonNullable<DraftLesson["image"]>) => void;
}) {
  const { lesson: l, sourceId } = props;
  const [browsing, setBrowsing] = useState(false);
  const [cropSrc, setCropSrc] = useState<{ kind: "page"; page: number } | { kind: "upload"; url: string } | null>(
    null,
  );
  const uploadRef = useRef<HTMLInputElement>(null);

  const closeCrop = () => {
    if (cropSrc?.kind === "upload") URL.revokeObjectURL(cropSrc.url);
    setCropSrc(null);
  };

  return (
    <>
      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Artwork</h3>
      {l.image ? (
        <div className="img-chosen" style={{ marginTop: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={l.image.url} alt={l.title} className="img-preview" />
          <div>
            <div className="field-help" style={{ marginBottom: 8 }}>
              {l.image.page ? `Cropped from page ${l.image.page}.` : "Uploaded image."}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-small" onClick={() => props.onChange({ image: null })}>
                ✕ Remove image
              </button>
              <button
                className="btn btn-small"
                title={`Copy this image to all ${props.lessonCount} lessons`}
                onClick={() => props.onApplyToAll(l.image!)}
              >
                ⧉ Use for all lessons
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <button
              className="btn btn-small"
              disabled={!sourceId}
              title={
                sourceId
                  ? "Browse every page of the source PDF and crop the artwork"
                  : "No source PDF linked — attach it on the Source PDF step first"
              }
              onClick={() => setBrowsing(true)}
            >
              ⊞ Choose page
            </button>
            <button className="btn btn-small" onClick={() => uploadRef.current?.click()}>
              ⤒ Upload image
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setCropSrc({ kind: "upload", url: URL.createObjectURL(f) });
                e.currentTarget.value = "";
              }}
            />
            <span className="field-help" style={{ marginTop: 0 }}>
              Optional.
              {l.artPages.length > 0 && sourceId && (
                <> The analysis suggests page{l.artPages.length === 1 ? "" : "s"} {l.artPages.join(", ")}.</>
              )}
              {!sourceId && <> Attach the source PDF on step 1 to pick artwork from its pages.</>}
            </span>
          </div>
        </>
      )}

      {browsing && (
        <PageBrowser
          sourceId={sourceId}
          suggested={l.artPages}
          heading={`Choose the page with lesson ${l.n}’s artwork`}
          onClose={() => setBrowsing(false)}
          onPick={(page) => {
            setBrowsing(false);
            setCropSrc({ kind: "page", page });
          }}
        />
      )}

      {cropSrc &&
        (cropSrc.kind === "page" ? (
          <PdfCrop
            sourceId={sourceId}
            page={cropSrc.page}
            heading={`Crop the artwork — page ${cropSrc.page}`}
            onClose={closeCrop}
            onDone={(url) => {
              const page = (cropSrc as { page: number }).page;
              props.onChange({
                image: { url, page },
                artPages: [...new Set([...l.artPages, page])].sort((a, b) => a - b),
              });
              closeCrop();
            }}
          />
        ) : (
          <CropModal
            src={cropSrc.url}
            loading={false}
            loadError=""
            heading="Crop the uploaded image"
            onClose={closeCrop}
            onDone={(url) => {
              props.onChange({ image: { url, page: null } });
              closeCrop();
            }}
          />
        ))}
    </>
  );
}

/**
 * Every page of the source PDF as a scrollable grid. Thumbnails render
 * lazily (IntersectionObserver) — booklets run to hundreds of pages and the
 * server renders at most a few at a time. Analysis-suggested pages are
 * badged and shown first.
 */
function PageBrowser(props: {
  sourceId: string;
  suggested: number[];
  heading: string;
  onClose: () => void;
  onPick: (page: number) => void;
}) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [jump, setJump] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authedFetch(`/api/source?sourceId=${encodeURIComponent(props.sourceId)}&pages=1`);
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `Couldn't open the source PDF (HTTP ${res.status}).`);
        if (!body.pageCount) {
          throw new Error(
            "The source PDF isn't available on the server — attach it on the Source PDF step, then try again.",
          );
        }
        if (alive) setPageCount(body.pageCount as number);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't open the source PDF.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.sourceId]);

  const suggested = props.suggested.filter((p) => pageCount === null || (p >= 1 && p <= pageCount));
  const jumpTo = (page: number) => {
    scrollRef.current
      ?.querySelector(`[data-page="${page}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="crop-backdrop" onClick={props.onClose}>
      <div className="crop-panel page-browser" onClick={(e) => e.stopPropagation()}>
        <div className="page-browser-head">
          <div>
            <h3 style={{ fontSize: 18, marginBottom: 2 }}>{props.heading}</h3>
            <p className="field-help" style={{ margin: 0 }}>
              {pageCount ? `${pageCount} pages — click one to crop its artwork.` : "Opening the source PDF…"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {pageCount !== null && pageCount > 12 && (
              <>
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  placeholder="page #"
                  value={jump}
                  onChange={(e) => setJump(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && Number(jump) >= 1) jumpTo(Number(jump));
                  }}
                  style={{ width: 90 }}
                />
                <button className="btn btn-small" disabled={!(Number(jump) >= 1)} onClick={() => jumpTo(Number(jump))}>
                  Go
                </button>
              </>
            )}
            <button className="btn btn-small btn-ghost" onClick={props.onClose}>
              ✕ Close
            </button>
          </div>
        </div>

        {error && <div className="notice notice-error">{error}</div>}

        {pageCount !== null && (
          <div className="page-browser-scroll" ref={scrollRef}>
            {suggested.length > 0 && (
              <>
                <div className="detail-caption" style={{ marginBottom: 8 }}>
                  Suggested by the analysis
                </div>
                <div className="page-grid">
                  {suggested.map((p) => (
                    <BrowserThumb key={`s-${p}`} sourceId={props.sourceId} page={p} suggested onPick={props.onPick} />
                  ))}
                </div>
                <div className="detail-caption" style={{ margin: "14px 0 8px" }}>
                  All pages
                </div>
              </>
            )}
            <div className="page-grid">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <BrowserThumb
                  key={p}
                  sourceId={props.sourceId}
                  page={p}
                  suggested={suggested.includes(p)}
                  onPick={props.onPick}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A page thumbnail that only renders once scrolled into view. */
function BrowserThumb(props: {
  sourceId: string;
  page: number;
  suggested?: boolean;
  onPick: (page: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: el.closest(".page-browser-scroll"), rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const render = usePageRender(props.sourceId, props.page, 220, visible);

  return (
    <button
      ref={ref}
      type="button"
      className="thumb page-thumb"
      data-page={props.page}
      title={`Crop artwork from page ${props.page}`}
      disabled={!render.url}
      onClick={() => props.onPick(props.page)}
    >
      {render.error ? (
        <span className="thumb-broken" style={{ width: "100%", minHeight: 120 }} title={render.error}>
          unavailable
        </span>
      ) : render.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={render.url} alt={`Page ${props.page}`} />
      ) : (
        <span className="thumb-loading" aria-label="Rendering…" />
      )}
      <span className="thumb-label">
        p. {props.page}
        {props.suggested && <span className="badge badge-gold" style={{ marginLeft: 6 }}>suggested</span>}
      </span>
    </button>
  );
}

/** Loads a hi-res page render, then hands it to the generic crop modal. */
function PdfCrop(props: {
  sourceId: string;
  page: number;
  heading: string;
  onClose: () => void;
  onDone: (url: string) => void;
}) {
  const render = usePageRender(props.sourceId, props.page, 1600);
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
