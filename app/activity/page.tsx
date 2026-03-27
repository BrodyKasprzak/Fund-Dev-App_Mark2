"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

type TimestampLike = Date | string | number | null | undefined;

type PlanRow = {
  id: string;
  title: string;
  templateType: string | null;
  status: "in_progress" | "approved" | string;
  progress: { completedSections: number; totalSections: number } | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  approvedAt?: TimestampLike;
  approvedBy?: { uid?: string | null; email?: string | null } | null;
};

type SortKey = "updated_desc" | "updated_asc" | "created_desc" | "created_asc";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatDate(value: TimestampLike) {
  try {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "--";
  }
}

export default function ActivityPage() {
  const router = useRouter();
  const { user, loading, authedFetch, activeOrgId } = useAuth();

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [status, setStatus] = useState<"in_progress" | "approved">("in_progress");
  const [sort, setSort] = useState<SortKey>("updated_desc");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, router, user]);

  async function loadPlans() {
    if (!user || !activeOrgId) return;

    setBusy(true);
    setError(null);

    try {
      const res = await authedFetch(
        `/api/plans/list?templateType=fund_dev_handbook&status=all&sort=${encodeURIComponent(sort)}&limit=200`,
      );
      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string" ? payload.error : "Failed to load plans";
        throw new Error(message);
      }

      const rows =
        isRecord(payload) && Array.isArray(payload.plans) ? (payload.plans as PlanRow[]) : ([] as PlanRow[]);
      setPlans(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!loading && user && activeOrgId) {
      void loadPlans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, activeOrgId, sort]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return plans
      .filter((plan) => (plan.status || "in_progress") === status)
      .filter((plan) => (!needle ? true : (plan.title || "").toLowerCase().includes(needle)));
  }, [plans, query, status]);

  if (loading) {
    return (
      <main className="min-h-screen p-6 md:p-8">
        <div className="auth-card mx-auto max-w-6xl p-6">
          <p className="text-sm text-slate-600">Loading activity...</p>
        </div>
      </main>
    );
  }

  if (!user) return null;

  if (!activeOrgId) {
    return (
      <main className="min-h-screen p-6 md:p-8">
        <div className="auth-card mx-auto w-full max-w-lg p-8">
          <h1 className="text-xl font-semibold text-slate-900">No organization selected</h1>
          <p className="mt-2 text-sm text-slate-600">
            You are signed in, but no active organization is selected for this session.
          </p>
          <div className="mt-5 flex gap-2">
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => router.push("/dashboard")} type="button">
              Back to dashboard
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={async () => {
                await signOut(auth);
                router.push("/login");
              }}
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
                Document Tracking
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Activity</h1>
              <p className="mt-2 text-sm text-slate-600">
                Resume in-progress plans or review approved versions.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary px-4 py-2 text-sm" onClick={() => router.push("/dashboard")} type="button">
                Back
              </button>
              <button
                className="btn-primary px-4 py-2 text-sm"
                onClick={() => void loadPlans()}
                disabled={busy}
                type="button"
              >
                {busy ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              <button
                className={
                  status === "in_progress"
                    ? "rounded-xl border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-700"
                    : "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                }
                onClick={() => setStatus("in_progress")}
                type="button"
              >
                In progress
              </button>
              <button
                className={
                  status === "approved"
                    ? "rounded-xl border border-success-200 bg-success-50 px-4 py-2 text-sm font-semibold text-success-700"
                    : "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                }
                onClick={() => setStatus("approved")}
                type="button"
              >
                Approved
              </button>
            </div>

            <input
              className="field-input min-w-[260px] flex-1 text-sm"
              placeholder="Search documents..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <select
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="updated_desc">Most recently edited</option>
              <option value="updated_asc">Least recently edited</option>
              <option value="created_desc">Newest created</option>
              <option value="created_asc">Oldest created</option>
            </select>
          </div>

          {error ? <div className="status-box status-box-error mt-4">{error}</div> : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-700">No documents found.</p>
              <p className="mt-1 text-xs text-slate-500">Try adjusting your filters or search terms.</p>
            </div>
          ) : (
            filtered.map((plan, idx) => {
              const progress =
                plan.progress && typeof plan.progress.completedSections === "number"
                  ? `${plan.progress.completedSections}/${plan.progress.totalSections ?? 0}`
                  : null;

              const actionLabel = plan.status === "approved" ? "View" : "Resume";
              const actionHref =
                plan.status === "approved"
                  ? `/plans/${encodeURIComponent(plan.id)}`
                  : `/handbook/crafter/template?planId=${encodeURIComponent(plan.id)}`;

              return (
                <div
                  key={plan.id}
                  className={idx === 0 ? "flex items-center justify-between gap-4 p-5" : "flex items-center justify-between gap-4 border-t border-slate-200 p-5"}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-slate-900">{plan.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      {plan.status === "approved" ? (
                        <span className="rounded-lg border border-success-200 bg-success-50 px-2.5 py-1 font-semibold text-success-700">
                          Approved
                        </span>
                      ) : (
                        <span className="rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1 font-semibold text-primary-700">
                          In progress
                        </span>
                      )}

                      {progress ? (
                        <span className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                          Progress {progress}
                        </span>
                      ) : null}

                      {plan.status === "approved" ? (
                        <span>
                          Approved by <span className="font-medium text-slate-800">{plan.approvedBy?.email ?? "Unknown"}</span>
                          {plan.approvedAt ? ` on ${formatDate(plan.approvedAt)}` : ""}
                        </span>
                      ) : (
                        <span>Updated {formatDate(plan.updatedAt)}</span>
                      )}
                    </div>
                  </div>

                  <button className="btn-primary px-5 py-2.5 text-sm" onClick={() => router.push(actionHref)} type="button">
                    {actionLabel}
                  </button>
                </div>
              );
            })
          )}
        </section>

        <div className="rounded-xl border border-accent-200 bg-accent-50/40 px-4 py-3">
          <p className="text-xs font-medium text-accent-700">
            Tip: Approved handbooks appear under the Approved tab as soon as they are finalized.
          </p>
        </div>
      </div>
    </main>
  );
}
