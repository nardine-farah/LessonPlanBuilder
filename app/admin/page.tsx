"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  AdminLibraryPlan,
  AdminOverview,
  AdminPlanSummary,
  AdminUser,
  LessonProgress,
} from "@/lib/adminData";
import { STAGE_INFO, STAGE_ORDER, planStage, stageCounts } from "@/lib/planStage";
import { authedFetch } from "@/lib/planStore";
import { AUDIENCE_TAGS, FOCUS_TAGS } from "@/lib/schema";
import { useAuth } from "../components/AuthProvider";

/**
 * Admin dashboard — every reviewer profile, every plan (with progress), and
 * the Studio library. Strictly read-only: looking never edits, deletes, or
 * publishes anything. Access is decided server-side (ADMIN_EMAILS); this
 * page just renders what /api/admin/overview is willing to say.
 */

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

function userLabel(u: AdminUser) {
  return u.displayName || u.email || `Reviewer ${u.uid.slice(0, 8)}…`;
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
  const extras = [
    lp.quiz === "ok" && "quiz ✓",
    lp.quiz === "partial" && "quiz incomplete",
    lp.image && "image ✓",
    lp.video && "video ✓",
    lp.supporting > 0 && `${lp.supporting} supporting`,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${lp.n}. ${lp.title}${missing ? ` — missing: ${missing}` : " — fully drafted"}${extras ? ` · ${extras}` : ""}`;
}

function lessonPillClass(lp: LessonProgress) {
  if (lp.core && lp.teaching && lp.keyIdea) return "lesson-pill complete";
  if (lp.core || lp.teaching || lp.keyIdea || lp.reflection || lp.prayer) return "lesson-pill partial";
  return "lesson-pill empty";
}

function StatusBadges({ plan }: { plan: AdminPlanSummary }) {
  const stage = planStage(plan);
  return (
    <span className={`badge ${STAGE_INFO[stage].badge}`} title={STAGE_INFO[stage].hint}>
      {STAGE_INFO[stage].label}
    </span>
  );
}

function PlanBlock({
  uid,
  plan,
  onDownload,
  downloading,
}: {
  uid: string;
  plan: AdminPlanSummary;
  onDownload: (uid: string, plan: AdminPlanSummary) => void;
  downloading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const p = plan.progress;
  return (
    <div className="admin-plan">
      <div className="admin-plan-row">
        <div className="plan-row-main">
          <div className="plan-row-title">
            {/* Title-only dir="auto": an Arabic title must not flip the badges. */}
            <span dir="auto">{plan.title}</span>
            <StatusBadges plan={plan} />
            {!p && <span className="badge badge-error">draft unreadable</span>}
          </div>
          <div className="plan-row-meta">
            <span className="mono">{plan.planId || "no-slug"}</span> · {plan.lessonCount} lessons ·{" "}
            {(plan.language || "en").toUpperCase()} ·{" "}
            {plan.status === "completed" && plan.finishedAt
              ? `finished ${fmtDate(plan.finishedAt)}`
              : `updated ${fmtDate(plan.updatedAt)}`}
            {plan.sourceFileName ? <> · from “{plan.sourceFileName}”</> : null}
          </div>
          {p && (
            <div
              className="progress-row"
              title={`Details ${p.detailsFilled}/${p.detailsTotal} · tags ${p.audience ? "✓" : "…"} · lessons drafted ${p.lessonsComplete}/${p.lessonsTotal} · images ${p.imagesChosen} · quizzes ${p.quizzesOk}`}
            >
              <div className="progress-track">
                <div className={`progress-fill${p.percent >= 100 ? " full" : ""}`} style={{ width: `${p.percent}%` }} />
              </div>
              <span className="progress-num">{p.percent}%</span>
            </div>
          )}
        </div>
        <div className="plan-row-actions">
          {p && (
            <button className="btn btn-small" onClick={() => setOpen(!open)}>
              {open ? "Hide detail ▴" : "Progress ▾"}
            </button>
          )}
          <button
            className="btn btn-small"
            disabled={downloading || !p}
            title="Download this plan as the seed-file JSON (always exports as draft)"
            onClick={() => onDownload(uid, plan)}
          >
            {downloading ? "…" : "⤓ JSON"}
          </button>
        </div>
      </div>

      {open && p && (
        <div className="plan-detail">
          <div className="plan-detail-cols">
            <ul className="detail-list">
              <li>{p.details ? "✓" : "○"} Plan details ({p.detailsFilled}/{p.detailsTotal} fields)</li>
              <li>{p.audience ? "✓" : "○"} Audience tags</li>
              <li>
                {p.lessonsComplete === p.lessonsTotal && p.lessonsTotal > 0 ? "✓" : "○"} Lessons drafted{" "}
                {p.lessonsComplete}/{p.lessonsTotal}
              </li>
              <li>○ Images {p.imagesChosen}/{p.lessonsTotal} <span className="detail-soft">(optional)</span></li>
              <li>○ Videos {p.videosAdded}/{p.lessonsTotal} <span className="detail-soft">(optional)</span></li>
              <li>{p.quizzesOk > 0 ? "✓" : "○"} Quizzes ready: {p.quizzesOk}</li>
              <li>
                {plan.status === "completed" ? "✓" : "○"} Finished
                {plan.finishedAt ? ` ${fmtDate(plan.finishedAt)}` : ""}
              </li>
              <li>{plan.checklistDone ? "✓" : "○"} Reviewer checklist</li>
              <li>
                {p.schemaValid ? (
                  <>✓ Passes the Studio schema</>
                ) : (
                  <span style={{ color: "var(--error)" }}>
                    ✗ Studio schema — {p.schemaIssueCount} issue{p.schemaIssueCount === 1 ? "" : "s"}
                  </span>
                )}
              </li>
              {plan.publishedAt && (
                <li>
                  ✓ In the Studio library as <span className="mono">{plan.publishedPlanId || plan.planId}</span>{" "}
                  since {fmtDate(plan.publishedAt)}
                </li>
              )}
            </ul>

            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="detail-caption">
                Lessons — <span className="pill-dot complete" /> drafted · <span className="pill-dot partial" />{" "}
                partial · <span className="pill-dot empty" /> empty (hover for detail)
              </div>
              <div className="lesson-grid">
                {p.lessons.map((lp) => (
                  <span key={lp.n} className={lessonPillClass(lp)} title={lessonTooltip(lp)}>
                    {lp.n}
                  </span>
                ))}
                {p.lessons.length === 0 && <span className="detail-soft">No lessons yet.</span>}
              </div>
            </div>
          </div>

          {!p.schemaValid && p.schemaIssues.length > 0 && (
            <ul className="error-list" style={{ marginTop: 12 }}>
              {p.schemaIssues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
              {p.schemaIssueCount > p.schemaIssues.length && (
                <li>… and {p.schemaIssueCount - p.schemaIssues.length} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ user }: { user: AdminUser }) {
  return user.photoURL ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.photoURL} alt="" className="user-avatar" referrerPolicy="no-referrer" />
  ) : (
    <div className="avatar-fallback">{(userLabel(user)[0] || "?").toUpperCase()}</div>
  );
}

/** Which of this reviewer's plans match the filter (empty string matches all). */
function matchingPlans(user: AdminUser, filter: string) {
  const q = filter.trim().toLowerCase();
  const userMatches =
    !q ||
    user.displayName.toLowerCase().includes(q) ||
    user.email.toLowerCase().includes(q) ||
    user.uid.toLowerCase().includes(q);
  const plans = userMatches
    ? user.plans
    : user.plans.filter(
        (p) => p.title.toLowerCase().includes(q) || p.planId.toLowerCase().includes(q),
      );
  return { userMatches, plans };
}

/** Compact summary card — the grid stays scannable however many plans each reviewer holds. */
function ReviewerCard({
  user,
  filter,
  onOpen,
}: {
  user: AdminUser;
  filter: string;
  onOpen: (uid: string) => void;
}) {
  const { userMatches, plans } = matchingPlans(user, filter);
  if (!userMatches && plans.length === 0) return null;

  const scored = user.plans.filter((p) => p.progress);
  const avg = scored.length
    ? Math.round(scored.reduce((sum, p) => sum + (p.progress?.percent ?? 0), 0) / scored.length)
    : null;
  const stages = stageCounts(user.plans);

  return (
    <button className="reviewer-card" onClick={() => onOpen(user.uid)}>
      <div className="reviewer-card-head">
        <Avatar user={user} />
        <div className="admin-user-info">
          <div className="user-name" style={{ fontSize: 15 }}>
            {userLabel(user)}
          </div>
          <div className="user-email" title={user.uid}>
            {user.email || <span className="mono">{user.uid.slice(0, 16)}…</span>}
          </div>
        </div>
      </div>
      <div className="reviewer-card-badges">
        {STAGE_ORDER.filter((s) => stages[s] > 0).map((s) => (
          <span key={s} className={`badge ${STAGE_INFO[s].badge}`} title={STAGE_INFO[s].hint}>
            {stages[s]} {STAGE_INFO[s].label.toLowerCase()}
          </span>
        ))}
        {!user.accountExists && <span className="badge badge-error">account removed</span>}
      </div>
      {avg !== null && (
        <div className="progress-row" style={{ marginTop: 0 }} title="Average progress across this reviewer's plans">
          <div className="progress-track">
            <div className={`progress-fill${avg >= 100 ? " full" : ""}`} style={{ width: `${avg}%` }} />
          </div>
          <span className="progress-num">{avg}%</span>
        </div>
      )}
      {!userMatches && (
        <div className="reviewer-card-match">
          {plans.length} plan{plans.length === 1 ? "" : "s"} match{plans.length === 1 ? "es" : ""}: “
          {plans[0].title}”{plans.length > 1 ? ", …" : ""}
        </div>
      )}
      <div className="reviewer-card-foot">
        <span>
          {user.counts.total} plan{user.counts.total === 1 ? "" : "s"} · last active {fmtDate(user.lastActive)}
        </span>
        <span className="reviewer-card-open">View plans →</span>
      </div>
    </button>
  );
}

/** Everything about one reviewer — their plans with progress bars, lesson grids, schema status, JSON export. */
function ReviewerDetail({
  user,
  onBack,
  onDownload,
  downloadingKey,
}: {
  user: AdminUser;
  onBack: () => void;
  onDownload: (uid: string, plan: AdminPlanSummary) => void;
  downloadingKey: string;
}) {
  return (
    <>
      <button className="btn btn-small" onClick={onBack}>
        ← All reviewers
      </button>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="admin-user-head">
          <Avatar user={user} />
          <div className="admin-user-info">
            <div className="user-name" style={{ fontSize: 15 }}>
              {userLabel(user)}
              {!user.accountExists && (
                <span className="badge badge-error" style={{ marginLeft: 8 }}>
                  account removed
                </span>
              )}
            </div>
            <div className="user-email" title={user.uid}>
              {user.email || <span className="mono">{user.uid}</span>}
            </div>
          </div>
          <div className="admin-user-counts">
            {user.counts.total} plan{user.counts.total === 1 ? "" : "s"}
            {STAGE_ORDER.filter((s) => stageCounts(user.plans)[s] > 0)
              .map((s) => ` · ${stageCounts(user.plans)[s]} ${STAGE_INFO[s].label.toLowerCase()}`)
              .join("")}
            <div style={{ textAlign: "right" }}>last active {fmtDate(user.lastActive)}</div>
          </div>
        </div>

        <div style={{ marginTop: 6 }}>
          {user.plans.map((plan) => (
            <PlanBlock
              key={plan.key}
              uid={user.uid}
              plan={plan}
              onDownload={onDownload}
              downloading={downloadingKey === `${user.uid}/${plan.key}`}
            />
          ))}
        </div>
      </section>
    </>
  );
}

const prettyTag = (t: string) => t.replace(/_/g, " ");

function LibraryCard({
  plan,
  onOpenReviewer,
  onUnpublish,
  unpublishing,
}: {
  plan: AdminLibraryPlan;
  onOpenReviewer: (uid: string) => void;
  onUnpublish: (plan: AdminLibraryPlan) => void;
  unpublishing: boolean;
}) {
  const publisherName = plan.publishedBy
    ? plan.publishedBy.displayName || plan.publishedBy.email || plan.publishedBy.uid
    : "";
  return (
    <div className="reviewer-card library-card">
      <div className="plan-row-title">
        <span dir="auto">{plan.title}</span>
        <span className={`badge ${plan.status === "published" ? "badge-moss" : "badge-gold"}`}>{plan.status}</span>
        {plan.language && <span className="badge badge-garnet">{plan.language.toUpperCase()}</span>}
      </div>
      {plan.subtitle && (
        <div className="library-card-sub" dir="auto">
          {plan.subtitle}
        </div>
      )}
      <div className="plan-row-meta">
        <span className="mono">{plan.planId}</span>
        {plan.lessonCount !== null && <> · {plan.lessonCount} lessons</>}
        {plan.translation && <> · {plan.translation}</>}
        {plan.span && <> · {plan.span}</>}
      </div>
      {plan.audience.length > 0 && (
        <div className="mini-tag-row">
          <span className="mini-tag-label">audience</span>
          {plan.audience.map((t) => (
            <span key={t} className="mini-tag">
              {prettyTag(t)}
            </span>
          ))}
        </div>
      )}
      {plan.focus.length > 0 && (
        <div className="mini-tag-row">
          <span className="mini-tag-label">topic</span>
          {plan.focus.map((t) => (
            <span key={t} className="mini-tag">
              {prettyTag(t)}
            </span>
          ))}
        </div>
      )}
      <div className="reviewer-card-foot">
        {plan.publishedBy ? (
          <button
            className="library-publisher"
            title="Open this reviewer's plans"
            onClick={() => onOpenReviewer(plan.publishedBy!.uid)}
          >
            by {publisherName} →
          </button>
        ) : (
          <span title="Seeded outside the builder (or published before publisher tracking)">Studio seed</span>
        )}
        {plan.status === "published" ? (
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {plan.publishedAt && <span>{fmtDate(plan.publishedAt)}</span>}
            <button
              className="btn btn-small"
              style={{ color: "var(--error)", borderColor: "var(--error)" }}
              title="Hide this plan from leaders in the Studio — it stays here as a draft and can be republished"
              disabled={unpublishing}
              onClick={() => onUnpublish(plan)}
            >
              {unpublishing ? "Unpublishing…" : "⇩ Unpublish"}
            </button>
          </span>
        ) : (
          <span>not live</span>
        )}
      </div>
    </div>
  );
}

/** The whole library as searchable, filterable cards. Filters reset when the tab remounts. */
function LibrarySection({
  library,
  onOpenReviewer,
  onUnpublish,
  unpublishingId,
}: {
  library: AdminLibraryPlan[];
  onOpenReviewer: (uid: string) => void;
  onUnpublish: (plan: AdminLibraryPlan) => void;
  unpublishingId: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("");
  const [audience, setAudience] = useState("");
  const [focus, setFocus] = useState("");

  const statuses = [...new Set(library.map((p) => p.status).filter(Boolean))].sort();
  const languages = [...new Set(library.map((p) => p.language).filter(Boolean))].sort();
  const anyFilter = search.trim() || status || language || audience || focus;

  const q = search.trim().toLowerCase();
  const matches = library.filter((p) => {
    if (status && p.status !== status) return false;
    if (language && p.language !== language) return false;
    if (audience && !p.audience.includes(audience)) return false;
    if (focus && !p.focus.includes(focus)) return false;
    if (q) {
      const haystack = [
        p.title,
        p.subtitle,
        p.planId,
        p.reviewedBy,
        p.publishedBy?.displayName ?? "",
        p.publishedBy?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <>
      <div className="filter-row">
        <input
          type="text"
          aria-label="Search the library"
          placeholder="Search title, planId, or publisher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select aria-label="Filter by language" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">All languages</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <select aria-label="Filter by audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="">Any audience</option>
          {AUDIENCE_TAGS.map((t) => (
            <option key={t} value={t}>
              {prettyTag(t)}
            </option>
          ))}
        </select>
        <select aria-label="Filter by topic" value={focus} onChange={(e) => setFocus(e.target.value)}>
          <option value="">Any topic</option>
          {FOCUS_TAGS.map((t) => (
            <option key={t} value={t}>
              {prettyTag(t)}
            </option>
          ))}
        </select>
        {anyFilter && (
          <button
            className="btn btn-small btn-ghost"
            onClick={() => {
              setSearch("");
              setStatus("");
              setLanguage("");
              setAudience("");
              setFocus("");
            }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      <p className="field-help" style={{ marginBottom: 12 }}>
        {matches.length} of {library.length} library plan{library.length === 1 ? "" : "s"}
        {anyFilter ? " match" : ""} — {library.filter((p) => p.publishedBy).length} published from this
        tool · {library.filter((p) => !p.publishedBy).length} seeded in the Studio (or published before
        publisher tracking).
      </p>

      {library.length === 0 ? (
        <section className="card">
          <p className="field-help">The library is empty.</p>
        </section>
      ) : matches.length === 0 ? (
        <section className="card">
          <p className="field-help">No library plans match these filters.</p>
        </section>
      ) : (
        <div className="reviewer-grid">
          {matches.map((plan) => (
            <LibraryCard
              key={plan.planId}
              plan={plan}
              onOpenReviewer={onOpenReviewer}
              onUnpublish={onUnpublish}
              unpublishing={unpublishingId === plan.planId}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading, signOutUser } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"reviewers" | "library">("reviewers");
  const [filter, setFilter] = useState("");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState("");
  const [unpublishingId, setUnpublishingId] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  const loadOverview = useCallback(async () => {
    try {
      const res = await authedFetch("/api/admin/overview");
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Load failed (HTTP ${res.status}).`);
      }
      setOverview((await res.json()) as AdminOverview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load the dashboard — reload to retry.");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadOverview();
  }, [user, loadOverview]);

  if (loading || !user) return null;

  const download = async (uid: string, plan: AdminPlanSummary) => {
    setError("");
    setDownloadingKey(`${uid}/${plan.key}`);
    try {
      const res = await authedFetch(
        `/api/admin/plan-json?uid=${encodeURIComponent(uid)}&key=${encodeURIComponent(plan.key)}`,
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Download failed (HTTP ${res.status}).`);
      const blob = new Blob([JSON.stringify(body.doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = body.fileName || "lesson-plan.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t download that plan’s JSON.");
    } finally {
      setDownloadingKey("");
    }
  };

  // The admin dashboard's only write action: hide a plan from leaders in the
  // Studio (library doc → status "draft"); the owner's plan becomes "Ready to
  // publish" and republishing brings it back.
  const unpublish = async (plan: AdminLibraryPlan) => {
    if (
      !confirm(
        `Unpublish “${plan.title}” from the Studio library?\n\nLeaders stop seeing it immediately. It stays here as a draft, and the reviewer's plan becomes “Ready to publish” — republishing brings it back.`,
      )
    ) {
      return;
    }
    setError("");
    setUnpublishingId(plan.planId);
    try {
      const res = await authedFetch("/api/admin/unpublish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.planId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Unpublish failed (HTTP ${res.status}).`);
      await loadOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t unpublish that plan — try again.");
    } finally {
      setUnpublishingId("");
    }
  };

  const totals = overview?.totals;

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

      <main>
        {error && <div className="notice notice-error">{error}</div>}

        {denied ? (
          <section className="card">
            <h2 className="card-title">Admins only</h2>
            <p className="card-note" style={{ marginBottom: 16 }}>
              This dashboard shows every reviewer’s plans, so it’s limited to admin accounts
              (the ADMIN_EMAILS allowlist). You’re signed in as {user.email}.
            </p>
            <button className="btn" onClick={() => router.push("/plans")}>
              ← Back to your plans
            </button>
          </section>
        ) : (
          <>
            <div className="plans-top">
              <div>
                <h2 className="page-title" style={{ fontSize: 26 }}>
                  Admin dashboard
                </h2>
                <p className="page-lede" style={{ marginBottom: 0 }}>
                  Every reviewer profile, their plans and progress, and the Studio library — read-only.
                </p>
              </div>
              <button className="btn" onClick={() => router.push("/plans")}>
                ← Your plans
              </button>
            </div>

            {!overview ? (
              <section className="card" style={{ marginTop: 22 }}>
                <p className="field-help">Loading every profile’s plans…</p>
              </section>
            ) : (
              <>
                {totals && (
                  <div className="summary-stats" style={{ marginTop: 18 }}>
                    <div>
                      <div className="stat-num">{totals.reviewers}</div>
                      <div className="stat-label">Reviewers</div>
                    </div>
                    <div>
                      <div className="stat-num">{totals.plans}</div>
                      <div className="stat-label">Plans</div>
                    </div>
                    {(() => {
                      const stages = stageCounts(overview.users.flatMap((u) => u.plans));
                      return STAGE_ORDER.map((s) => (
                        <div key={s} title={STAGE_INFO[s].hint}>
                          <div className="stat-num">{stages[s]}</div>
                          <div className="stat-label">{STAGE_INFO[s].label}</div>
                        </div>
                      ));
                    })()}
                    <div title="Everything in the Studio library — including Studio seeds and plans published before publisher tracking">
                      <div className="stat-num">{totals.libraryPlans}</div>
                      <div className="stat-label">Library plans</div>
                    </div>
                  </div>
                )}

                <div className="tab-row">
                  <button
                    className={`tab${tab === "reviewers" ? " on" : ""}`}
                    onClick={() => {
                      setTab("reviewers");
                      setSelectedUid(null);
                    }}
                  >
                    Reviewers &amp; plans
                  </button>
                  <button
                    className={`tab${tab === "library" ? " on" : ""}`}
                    onClick={() => {
                      setTab("library");
                      setSelectedUid(null);
                    }}
                  >
                    Studio library
                  </button>
                </div>

                {tab === "reviewers" &&
                  (() => {
                    const selected = selectedUid ? overview.users.find((u) => u.uid === selectedUid) : undefined;
                    if (selected) {
                      return (
                        <ReviewerDetail
                          user={selected}
                          onBack={() => setSelectedUid(null)}
                          onDownload={download}
                          downloadingKey={downloadingKey}
                        />
                      );
                    }
                    return (
                      <>
                        <div className="field" style={{ maxWidth: 420 }}>
                          <input
                            type="text"
                            placeholder="Filter by reviewer, plan title, or planId…"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                          />
                        </div>
                        {overview.users.length === 0 ? (
                          <section className="card">
                            <p className="field-help">
                              No reviewer profiles yet — profiles appear here once someone saves a plan.
                            </p>
                          </section>
                        ) : (
                          <div className="reviewer-grid">
                            {overview.users.map((u) => (
                              <ReviewerCard key={u.uid} user={u} filter={filter} onOpen={setSelectedUid} />
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}

                {tab === "library" && (
                  <LibrarySection
                    library={overview.library}
                    onOpenReviewer={(uid) => {
                      setTab("reviewers");
                      setSelectedUid(uid);
                    }}
                    onUnpublish={unpublish}
                    unpublishingId={unpublishingId}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
