"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { normalizeDraft, type Draft } from "@/lib/types";
import { deletePlan, newPlanKey, planRecord, savePlan } from "@/lib/planStore";
import { useAuth } from "../components/AuthProvider";
import StepUpload from "../components/StepUpload";
import StepPlanDetails from "../components/StepPlanDetails";
import StepTags from "../components/StepTags";
import StepLessons from "../components/StepLessons";
import StepImages from "../components/StepImages";
import StepReview from "../components/StepReview";

const STORAGE_KEY = "lpb-draft-v1";
const SYNC_DEBOUNCE_MS = 1500;

const STEPS = [
  { name: "Source PDF", hint: "Upload & analyze" },
  { name: "Plan details", hint: "Title, summary, provenance" },
  { name: "Who it's for", hint: "Matching tags" },
  { name: "Lessons", hint: "Review every session" },
  { name: "Lesson images", hint: "Pick artwork per lesson" },
  { name: "Review & export", hint: "Validate, checklist, JSON" },
];

const TITLES: { title: string; lede: string }[] = [
  {
    title: "Begin with the source",
    lede: "Feed the builder any Biblica program PDF — in any language — and it proposes a draft plan shaped exactly like the Scripture Studio library expects.",
  },
  {
    title: "Name the plan",
    lede: "How this plan introduces itself in the library. The analysis proposed everything below from the PDF — correct and refine it.",
  },
  {
    title: "Match it to the right groups",
    lede: "The builder interview in Scripture Studio recommends plans by these tags. Honest tags mean the right leaders find this plan.",
  },
  {
    title: "Walk every lesson",
    lede: "The heart of curation: check each session's passage, teaching, key idea, quiz, and prayer against the source.",
  },
  {
    title: "Give lessons their artwork",
    lede: "The analysis flagged pages with real illustrations. Crop the ones worth keeping — every image is optional and reviewed by you.",
  },
  {
    title: "Review & export",
    lede: "Validate against the Studio schema, work the reviewer checklist, and download the seed file.",
  },
];

type SyncState = "local" | "saving" | "synced" | "error";

export default function BuilderPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [planKey, setPlanKey] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  // True when this plan's reviewer checklist was completed before (a reopen):
  // autosaves keep the flag, and the Review step pre-ticks the boxes for a
  // conscious re-confirm instead of a full re-tick after every small edit.
  const [checklistCarried, setChecklistCarried] = useState(false);
  const [sync, setSync] = useState<SyncState>("local");
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncEpoch = useRef(0);
  const dirtyRef = useRef<{ key: string; draft: Draft; createdAt: string; checklistDone: boolean } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.draft) {
          setDraft(normalizeDraft(saved.draft));
          // Clamp restored step — older saves used a 5-step wizard, and an
          // out-of-range value must never render an empty page.
          const restored = Number(saved.step ?? 1);
          setStep(Number.isInteger(restored) ? Math.min(Math.max(restored, 0), 5) : 1);
          setPlanKey(saved.key ?? newPlanKey(saved.draft));
          setCreatedAt(saved.createdAt ?? new Date().toISOString());
          setChecklistCarried(!!saved.checklistDone);
        }
      }
    } catch {
      /* corrupted save — start fresh */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (draft) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ draft, step, key: planKey, createdAt, checklistDone: checklistCarried }),
      );
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [draft, step, planKey, createdAt, checklistCarried, loaded]);

  // Debounced sync of the working draft to the reviewer's profile. The epoch
  // ref invalidates pending saves when the draft is finished or discarded, so
  // a stale "in_progress" write can't regress a completed plan or resurrect a
  // deleted one; dirtyRef backs the flush-on-unmount below.
  useEffect(() => {
    if (!loaded || !user || !draft || !planKey) return;
    setSync("saving");
    dirtyRef.current = { key: planKey, draft, createdAt, checklistDone: checklistCarried };
    const epoch = syncEpoch.current;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      if (epoch !== syncEpoch.current) return; // finished/discarded meanwhile
      try {
        await savePlan(planRecord(planKey, draft, "in_progress", checklistCarried, createdAt));
        if (epoch === syncEpoch.current) {
          dirtyRef.current = null;
          setSync("synced");
        }
      } catch {
        if (epoch === syncEpoch.current) setSync("error");
      }
    }, SYNC_DEBOUNCE_MS);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [draft, planKey, createdAt, user, loaded]);

  // Leaving the builder with an un-synced edit (e.g. "← My plans" within the
  // debounce window) flushes it fire-and-forget so the profile copy is never
  // older than what the curator last saw.
  useEffect(() => {
    return () => {
      const pending = dirtyRef.current;
      if (pending && user) {
        dirtyRef.current = null;
        void savePlan(
          planRecord(pending.key, pending.draft, "in_progress", pending.checklistDone, pending.createdAt),
        ).catch(() => {});
      }
    };
  }, [user]);

  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const startOver = async () => {
    syncEpoch.current++; // invalidate any pending debounced save
    dirtyRef.current = null;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (user && planKey) {
      try {
        await deletePlan(planKey);
      } catch {
        /* best effort — the doc stays as in_progress on the plans page */
      }
    }
    setDraft(null);
    setPlanKey("");
    setCreatedAt("");
    setChecklistCarried(false);
    setStep(0);
    setSync("local");
  };

  const finishPlan = async (checklistDone: boolean) => {
    if (!draft || !user) return;
    syncEpoch.current++; // invalidate any pending debounced save
    dirtyRef.current = null;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    const key = planKey || newPlanKey(draft);
    try {
      await savePlan(planRecord(key, draft, "completed", checklistDone, createdAt || undefined));
    } catch {
      alert(
        "Couldn't save the finished plan to your profile (network?). Nothing was lost — your draft is still here; try again in a moment.",
      );
      return;
    }
    sessionStorage.setItem("lpb-just-finished", draft.title || draft.planId || "The plan");
    setDraft(null);
    setPlanKey("");
    setCreatedAt("");
    setStep(0);
    router.push("/plans");
  };

  if (!loaded || loading || !user) return null;

  return (
    <div className="frame">
      <aside className="rail">
        <div>
          <div className="brand-kicker">Biblica · Scripture Studio</div>
          <h1 className="brand-title">
            Lesson Plan <em>Builder</em>
          </h1>
          <p className="brand-sub">
            From any PDF, in any language, to a curated plan ready for the library.
          </p>
          <p style={{ marginTop: 12 }}>
            <Link href="/plans" className="rail-link">
              ← My plans
            </Link>
          </p>
        </div>

        <nav className="steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button
              key={s.name}
              className={`step-item${i === step ? " current" : ""}${i < step && draft ? " done" : ""}`}
              disabled={i > 0 && !draft}
              onClick={() => (i === 0 || draft) && setStep(i)}
            >
              <span className="step-marker">
                <span className="step-dot">{i < step && draft ? "✓" : i + 1}</span>
              </span>
              <span className="step-text">
                <span className="step-name">{s.name}</span>
                <div className="step-hint">{s.hint}</div>
              </span>
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          {draft && (
            <div style={{ marginBottom: 8 }}>
              <span className="badge badge-garnet">{draft.title || "untitled"}</span>{" "}
              <span
                className={`badge ${sync === "synced" ? "badge-moss" : sync === "error" ? "badge-error" : "badge-gold"}`}
              >
                {sync === "synced"
                  ? "synced to profile"
                  : sync === "saving"
                    ? "saving…"
                    : sync === "error"
                      ? "sync failed — kept locally"
                      : "local"}
              </span>
            </div>
          )}
          Signed in as {user.displayName || user.email}
        </div>
      </aside>

      <main className="main">
        <h1 className="page-title">{TITLES[step].title}</h1>
        <p className="page-lede">{TITLES[step].lede}</p>

        {step === 0 && (
          <StepUpload
            draft={draft}
            onAnalyzed={(d) => {
              setDraft(d);
              setPlanKey(newPlanKey(d));
              setCreatedAt(new Date().toISOString());
              setChecklistCarried(false);
              setStep(1);
            }}
          />
        )}
        {step === 1 && draft && <StepPlanDetails draft={draft} update={update} />}
        {step === 2 && draft && <StepTags draft={draft} update={update} />}
        {step === 3 && draft && <StepLessons draft={draft} update={update} />}
        {step === 4 && draft && <StepImages draft={draft} update={update} />}
        {step === 5 && draft && (
          <StepReview
            draft={draft}
            initialAllChecked={checklistCarried}
            onStartOver={startOver}
            onFinish={finishPlan}
          />
        )}

        {draft && step > 0 && step < 5 && (
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(step - 1)}>
              ← Back
            </button>
            <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
              Continue →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
