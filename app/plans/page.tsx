"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buildPlanDoc } from "@/lib/types";
import { importedDraftFromJson } from "@/lib/importPlan";
import {
  PublishConflictError,
  deletePlan,
  listPlans,
  newPlanKey,
  parseStoredDraft,
  planRecord,
  publishPlan,
  savePlan,
  type StoredPlan,
} from "@/lib/planStore";
import { useAuth } from "../components/AuthProvider";

const WORKING_KEY = "lpb-draft-v1";
const LEGACY_COMPLETED_KEY = "lpb-completed-v1";

export default function PlansPage() {
  const router = useRouter();
  const { user, loading, signOutUser } = useAuth();
  const [plans, setPlans] = useState<StoredPlan[] | null>(null);
  const [justFinished, setJustFinished] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [publishing, setPublishing] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    setJustFinished(sessionStorage.getItem("lpb-just-finished") ?? "");
    sessionStorage.removeItem("lpb-just-finished");
  }, []);

  const refresh = async () => {
    try {
      setPlans(await listPlans());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your plans — reload to retry.");
      setPlans([]);
    }
  };

  // Load plans + one-time import of pre-profile completed plans from this browser.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const raw = localStorage.getItem(LEGACY_COMPLETED_KEY);
        if (raw) {
          const legacy = JSON.parse(raw);
          if (Array.isArray(legacy) && legacy.length) {
            for (const p of legacy) {
              if (!p?.draft || !p?.key) continue;
              const record = planRecord(p.key, p.draft, "completed", !!p.checklistDone, p.finishedAt);
              record.finishedAt = p.finishedAt ?? record.finishedAt;
              await savePlan(record);
            }
            setNotice(`Imported ${legacy.length} plan${legacy.length === 1 ? "" : "s"} from this browser into your profile.`);
          }
          localStorage.removeItem(LEGACY_COMPLETED_KEY);
        }
      } catch {
        /* leave the legacy list in place for a later attempt */
      }
      await refresh();
    })();
  }, [user]);

  if (loading || !user) return null;

  const download = (plan: StoredPlan) => {
    const draft = parseStoredDraft(plan);
    if (!draft) return;
    const json = JSON.stringify(buildPlanDoc(draft), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.planId || "lesson-plan"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openInBuilder = async (plan: StoredPlan, reopenCompleted: boolean) => {
    const draft = parseStoredDraft(plan);
    if (!draft) {
      setError("This plan's saved data couldn't be read.");
      return;
    }
    const working = localStorage.getItem(WORKING_KEY);
    if (working) {
      let current: any = null;
      try {
        current = JSON.parse(working);
      } catch {
        /* corrupted — treat as absent */
      }
      if (current?.key === plan.key && !reopenCompleted) {
        // Same plan is already open in the builder — the local working copy
        // may be NEWER than the profile (un-flushed edits), so never
        // overwrite it here; just continue where the browser left off.
        router.push("/builder");
        return;
      }
      if (
        current &&
        current.key !== plan.key &&
        !confirm("Another draft is currently open in the builder — replace it with this plan? (The other draft stays saved in your profile.)")
      ) {
        return;
      }
    }
    if (reopenCompleted) {
      const inLibrary = !!plan.publishedAt;
      if (
        !confirm(
          `Reopen “${plan.title}” for editing? It moves back to “in review” in your plans${
            inLibrary
              ? " — the published copy stays live in the Studio library, and your edits only reach it when you Republish"
              : ""
          }.`,
        )
      ) {
        return;
      }
      try {
        await savePlan({ ...plan, status: "in_progress", updatedAt: new Date().toISOString() });
      } catch {
        /* non-fatal — it flips on the next builder autosave */
      }
    }
    localStorage.setItem(
      WORKING_KEY,
      JSON.stringify({ draft, step: 1, key: plan.key, createdAt: plan.createdAt }),
    );
    router.push("/builder");
  };

  const importFile = async (file: File | null | undefined) => {
    if (!file) return;
    setError("");
    setNotice("");
    setImporting(true);
    try {
      const result = importedDraftFromJson(await file.text(), file.name);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const record = planRecord(newPlanKey(result.draft), result.draft, "in_progress", false);
      await savePlan(record);
      await refresh();
      setNotice(
        `Imported “${record.title}” (${record.lessonCount} lessons) into your plans — press Continue to review it.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import that file.");
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  };

  const publish = async (plan: StoredPlan) => {
    const republish = !!plan.publishedAt;
    if (
      !confirm(
        republish
          ? `Republish “${plan.title}” to the Scripture Studio library? This overwrites the live library copy (${plan.publishedPlanId || plan.planId}).`
          : `Publish “${plan.title}” to the Scripture Studio library?\n\nIt goes live as status "published" — leaders can be matched to it immediately. Only publish after the editorial & theological review is truly done.`,
      )
    ) {
      return;
    }
    setError("");
    setNotice("");
    setPublishing(plan.key);
    const audioNote = (audio?: { rendered: number; reused: number; warnings: string[] }) => {
      if (!audio || (audio.rendered === 0 && audio.reused === 0 && audio.warnings.length === 0)) return "";
      const bits: string[] = [];
      if (audio.rendered) bits.push(`${audio.rendered} narration${audio.rendered === 1 ? "" : "s"} rendered`);
      if (audio.reused) bits.push(`${audio.reused} reused`);
      let note = bits.length ? ` Audio: ${bits.join(", ")}.` : "";
      if (audio.warnings.length) note += ` ⚠ ${audio.warnings[0]}`;
      return note;
    };
    try {
      try {
        const res = await publishPlan(plan.key, republish);
        setNotice(`✓ “${plan.title}” is live in the Studio library as ${res.planId}.${audioNote(res.audio)}`);
      } catch (e) {
        if (e instanceof PublishConflictError) {
          if (!confirm(`${e.message}\n\nOverwrite the library copy with this plan?`)) return;
          const res = await publishPlan(plan.key, true);
          setNotice(`✓ “${plan.title}” is live in the Studio library as ${res.planId} (overwrote the previous copy).${audioNote(res.audio)}`);
        } else {
          throw e;
        }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publishing failed — try again.");
    } finally {
      setPublishing("");
    }
  };

  const remove = async (plan: StoredPlan) => {
    if (!confirm(`Remove “${plan.title}” from your profile? This can't be undone.`)) return;
    try {
      await deletePlan(plan.key);
      const working = localStorage.getItem(WORKING_KEY);
      if (working && JSON.parse(working)?.key === plan.key) localStorage.removeItem(WORKING_KEY);
      await refresh();
    } catch {
      setError("Couldn't delete the plan — try again.");
    }
  };

  return (
    <div className="plans-shell">
      <header className="plans-header">
        <div>
          <div className="brand-kicker">Biblica · Scripture Studio</div>
          <h1 className="brand-title">
            Lesson Plan <em>Builder</em>
          </h1>
        </div>
        <div className="user-chip">
          {user.photoURL && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="" className="user-avatar" referrerPolicy="no-referrer" />
          )}
          <div>
            <div className="user-name">{user.displayName || "Reviewer"}</div>
            <div className="user-email">{user.email}</div>
          </div>
          <button
            className="btn btn-small btn-ghost"
            onClick={async () => {
              await signOutUser();
              router.replace("/");
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="plans-main">
        {justFinished && (
          <div className="notice notice-ok">
            ✓ <strong>{justFinished}</strong> is finished and saved to your profile.
          </div>
        )}
        {notice && <div className="notice notice-info">{notice}</div>}
        {error && <div className="notice notice-error">{error}</div>}

        <div className="plans-top">
          <div>
            <h2 className="page-title" style={{ fontSize: 26 }}>
              Your plans
            </h2>
            <p className="page-lede" style={{ marginBottom: 0 }}>
              Everything you're reviewing, synced to your profile.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn"
              disabled={importing}
              onClick={() => importInput.current?.click()}
              title="Import a plan JSON — a file exported here, or a Scripture Studio seed file — to edit or review it"
            >
              {importing ? "Importing…" : "⤒ Import plan JSON"}
            </button>
            <button className="btn btn-primary" onClick={() => router.push("/builder")}>
              + Start building a new plan
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => importFile(e.target.files?.[0])}
            />
          </div>
        </div>

        <section className="card" style={{ marginTop: 22 }}>
          {plans === null ? (
            <p className="field-help">Loading your plans…</p>
          ) : plans.length === 0 ? (
            <div className="plans-empty">
              <div className="dropzone-icon">✦</div>
              <p>
                No plans yet. Start your first one — upload a Biblica PDF and the builder walks
                you from document to library-ready plan.
              </p>
              <button className="btn btn-primary" onClick={() => router.push("/builder")}>
                + Start building a new plan
              </button>
            </div>
          ) : (
            plans.map((plan) => (
              <div className="plan-row" key={plan.key}>
                <div className="plan-row-main">
                  <div className="plan-row-title" dir="auto">
                    {plan.title}
                    <span
                      className={`badge ${
                        plan.status === "in_progress"
                          ? "badge-garnet"
                          : plan.checklistDone
                            ? "badge-moss"
                            : "badge-gold"
                      }`}
                    >
                      {plan.status === "in_progress"
                        ? "in review"
                        : plan.checklistDone
                          ? "completed"
                          : "completed · checklist pending"}
                    </span>
                    {plan.publishedAt && (
                      <span className="badge badge-garnet" title={`Published ${new Date(plan.publishedAt).toLocaleString()}`}>
                        in library
                      </span>
                    )}
                  </div>
                  <div className="plan-row-meta">
                    <span className="mono">{plan.planId || "no-slug"}</span> · {plan.lessonCount}{" "}
                    lessons · {(plan.language || "en").toUpperCase()} ·{" "}
                    {plan.status === "completed" && plan.finishedAt
                      ? `finished ${new Date(plan.finishedAt).toLocaleDateString()}`
                      : `updated ${new Date(plan.updatedAt).toLocaleDateString()}`}
                    {plan.sourceFileName ? <> · from “{plan.sourceFileName}”</> : null}
                  </div>
                </div>
                <div className="plan-row-actions">
                  {plan.status === "in_progress" ? (
                    <button className="btn btn-small btn-primary" onClick={() => openInBuilder(plan, false)}>
                      Continue
                    </button>
                  ) : (
                    <>
                      {plan.checklistDone && (
                        <button
                          className="btn btn-small btn-primary"
                          disabled={publishing === plan.key}
                          title="Write this plan into the Scripture Studio library as published"
                          onClick={() => publish(plan)}
                        >
                          {publishing === plan.key
                            ? "Publishing…"
                            : plan.publishedAt
                              ? "⇪ Republish"
                              : "⇪ Publish to Studio"}
                        </button>
                      )}
                      <button className="btn btn-small" onClick={() => openInBuilder(plan, true)}>
                        Reopen
                      </button>
                    </>
                  )}
                  <button className="btn btn-small" onClick={() => download(plan)}>
                    ⤓ JSON
                  </button>
                  <button
                    className="btn btn-small btn-ghost"
                    style={{ color: "var(--error)" }}
                    onClick={() => remove(plan)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
