"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type OrgProfile = {
  id: string;
  name: string;
  mission?: string | null;
  homeState?: string | null;
  taxStatus?: string | null;
  fiscalYear?: string | null;
  crm?: string | null;
  address?: string | null;
  numEmployees?: number | null;
  foundedYear?: number | null;
  websiteUrl?: string | null;
  websiteConsent?: boolean | null;
};

type SortKey = "updated_desc" | "updated_asc" | "created_desc" | "created_asc";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function formatDate(ts: TimestampLike) {
  try {
    const d = ts instanceof Date ? ts : ts ? new Date(ts as any) : null;
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function initialsFromName(name?: string) {
  const n = String(name ?? "").trim();
  if (!n) return "O";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "O";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

export default function ActivityPage() {
  const router = useRouter();
  const { user, loading, authedFetch, activeOrgId } = useAuth();

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [status, setStatus] = useState<"in_progress" | "approved">("in_progress");
  const [sort, setSort] = useState<SortKey>("updated_desc");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Profile popover state
  const [profileOpen, setProfileOpen] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement | null>(null);
  const profilePopoverRef = useRef<HTMLDivElement | null>(null);

  // Org info (loaded from server via /api/me; server remains source of truth)
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [orgInfoOpen, setOrgInfoOpen] = useState(false);
  const [checkingOrg, setCheckingOrg] = useState(true);

  // Redirect if not signed in
  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  // Close profile popover on outside click / ESC
  useEffect(() => {
    if (!profileOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }

    function onMouseDown(e: MouseEvent) {
      const btn = profileBtnRef.current;
      const pop = profilePopoverRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (btn && btn.contains(target)) return;
      if (pop && pop.contains(target)) return;
      setProfileOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [profileOpen]);

  // Load org profile via server (/api/me uses requireOrgContext → needs x-org-id)
  useEffect(() => {
    async function loadOrg() {
      if (loading) return;
      if (!user) {
        setOrg(null);
        setCheckingOrg(false);
        return;
      }

      // If there's no active org selected, we cannot call org-scoped endpoints.
      if (!activeOrgId) {
        setOrg(null);
        setCheckingOrg(false);
        return;
      }

      setCheckingOrg(true);
      setErr(null);

      try {
        const res = await authedFetch("/api/me");
        const json: unknown = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg =
            isRecord(json) && typeof json.error === "string"
              ? json.error
              : "Failed to load organization";
          throw new Error(msg);
        }

        // Support both shapes:
        // (A) { ok:true, org:{...} }  (old)
        // (B) { ok:true, me:{ orgId, ... } } + optional org fields (new)
        const orgObj =
          isRecord(json) && isRecord((json as any).org) ? ((json as any).org as Record<string, unknown>) : null;

        const meObj =
          isRecord(json) && isRecord((json as any).me) ? ((json as any).me as Record<string, unknown>) : null;

        const orgId =
          (orgObj && asString(orgObj.id)) ||
          (meObj && asString(meObj.orgId)) ||
          asString((json as any).orgId) ||
          activeOrgId;

        const orgName =
          (orgObj && asString(orgObj.name)) ||
          asString((json as any).orgName) ||
          "Your organization";

        if (!orgId) {
          setOrg(null);
          return;
        }

        const loaded: OrgProfile = {
          id: orgId,
          name: String(orgName ?? "").trim() || "Your organization",
          mission: orgObj && typeof orgObj.mission === "string" ? (orgObj.mission as string) : null,
          homeState: orgObj && typeof orgObj.homeState === "string" ? (orgObj.homeState as string) : null,
          taxStatus: orgObj && typeof orgObj.taxStatus === "string" ? (orgObj.taxStatus as string) : null,
          fiscalYear: orgObj && typeof orgObj.fiscalYear === "string" ? (orgObj.fiscalYear as string) : null,
          crm: orgObj && typeof orgObj.crm === "string" ? (orgObj.crm as string) : null,
          address: orgObj && typeof orgObj.address === "string" ? (orgObj.address as string) : null,
          numEmployees: orgObj && typeof orgObj.numEmployees === "number" ? (orgObj.numEmployees as number) : null,
          foundedYear: orgObj && typeof orgObj.foundedYear === "number" ? (orgObj.foundedYear as number) : null,
          websiteUrl: orgObj && typeof orgObj.websiteUrl === "string" ? (orgObj.websiteUrl as string) : null,
          websiteConsent:
            orgObj && typeof orgObj.websiteConsent === "boolean" ? (orgObj.websiteConsent as boolean) : null,
        };

        setOrg(loaded);
      } catch (e: unknown) {
        console.error("Activity org load error:", e);
        setOrg(null);
        setErr(e instanceof Error ? e.message : "Failed to load organization");
      } finally {
        setCheckingOrg(false);
      }
    }

    loadOrg();
  }, [user, loading, authedFetch, activeOrgId]);

  async function loadPlans() {
    if (!user) return;

    // must have activeOrgId so authedFetch includes x-org-id; otherwise serverAuth throws 400
    if (!activeOrgId) return;

    setBusy(true);
    setErr(null);

    try {
      const res = await authedFetch(
        `/api/plans/list?templateType=fund_dev_handbook&status=all&sort=${encodeURIComponent(sort)}&limit=200`
      );

      const data: unknown = await res.json().catch(() => ({}));

      const errorMsg =
        isRecord(data) && typeof (data as any).error === "string"
          ? String((data as any).error)
          : "Failed to load plans";

      if (!res.ok) throw new Error(errorMsg);

      const plansArr =
        isRecord(data) && Array.isArray((data as any).plans)
          ? ((data as any).plans as PlanRow[])
          : [];

      setPlans(plansArr);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  // Load plans after auth + org selection known, and when sort changes
  useEffect(() => {
    if (!loading && user && activeOrgId) loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, activeOrgId, sort]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (plans ?? [])
      .filter((p) => (p.status ?? "in_progress") === status)
      .filter((p) => {
        if (!needle) return true;
        return (p.title ?? "").toLowerCase().includes(needle);
      });
  }, [plans, status, q]);

  // Loading / auth guard states
  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-4 shadow-lg">
            <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-4 shadow-lg">
            <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <p className="text-slate-700 font-medium">Please sign in to continue.</p>
        </div>
      </main>
    );
  }

  // If signed in but no active org selected → cannot call org-scoped endpoints
  if (!checkingOrg && !activeOrgId) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-xl">
          <h1 className="text-xl font-bold text-slate-900">No organization selected</h1>
          <p className="mt-2 text-sm text-slate-600">
            You’re signed in, but we don’t have an active organization selected yet — so we can’t load Activity.
          </p>
          <div className="mt-5 flex gap-2">
            <button
              className="rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
              onClick={() => router.push("/dashboard")}
              type="button"
            >
              Back to dashboard
            </button>
            <button
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition"
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

  // If we have an activeOrgId but /api/me didn’t resolve org details yet, still allow page to render.
  const orgDisplayName = (org?.name || "Your organization").trim() || "Your organization";
  const avatarText = initialsFromName(orgDisplayName);

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50 p-6 relative">
      {/* Profile icon in upper right */}
      <div className="absolute top-6 right-6 z-10">
        <div className="relative">
          <button
            ref={profileBtnRef}
            type="button"
            aria-label="Open profile"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-400 text-sm font-semibold text-white shadow-lg hover:shadow-xl hover:from-primary-600 hover:to-primary-500 transition-all"
            onClick={() => setProfileOpen((v) => !v)}
          >
            {avatarText}
          </button>

          {profileOpen ? (
            <div
              ref={profilePopoverRef}
              className="absolute right-0 z-50 mt-2 w-[380px] overflow-hidden rounded-2xl border-2 border-primary-100 bg-white shadow-2xl"
            >
              {/* Header */}
              <div className="bg-gradient-to-br from-primary-500 via-primary-500 to-accent-400 p-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-sm font-bold backdrop-blur-sm">
                      {avatarText}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{orgDisplayName}</div>
                      <div className="mt-0.5 text-xs text-white/80 truncate">
                        Signed in as <span className="font-medium">{user?.email ?? "Unknown"}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="rounded-lg bg-white/15 px-2 py-1 text-xs text-white hover:bg-white/20 border border-white/20 transition"
                    onClick={() => setProfileOpen(false)}
                  >
                    Close
                  </button>
                </div>

                {/* Mission preview */}
                <div className="mt-3 rounded-xl bg-white/15 backdrop-blur-sm p-3 border border-white/20">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-2 w-2 rounded-full bg-success-300" />
                    <div className="text-xs font-bold text-white/90">Mission</div>
                  </div>
                  <div className="text-sm leading-relaxed">
                    {org?.mission?.trim() ? org.mission : "Not provided yet."}
                  </div>
                </div>

                {/* Org info toggle */}
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl bg-white/15 backdrop-blur-sm px-3 py-2.5 text-left hover:bg-white/20 transition border border-white/20"
                  onClick={() => setOrgInfoOpen((v) => !v)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-accent-300" />
                      <div className="text-sm font-bold">Organization info</div>
                    </div>
                    <div className="text-sm font-bold">{orgInfoOpen ? "−" : "+"}</div>
                  </div>
                </button>
              </div>

              {/* Expanded org info */}
              {orgInfoOpen ? (
                <div className="p-4 bg-white">
                  <div className="space-y-2 text-sm">
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">Home state</div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.homeState?.trim() ? org.homeState : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">Tax status</div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.taxStatus?.trim() ? org.taxStatus : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">Fiscal year</div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.fiscalYear?.trim() ? org.fiscalYear : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">CRM</div>
                      <div className="mt-1 font-medium text-slate-900">{org?.crm?.trim() ? org.crm : "—"}</div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">Address</div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.address?.trim() ? org.address : "—"}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                        <div className="text-xs font-semibold text-slate-600">Employees</div>
                        <div className="mt-1 font-medium text-slate-900">
                          {typeof org?.numEmployees === "number" ? org.numEmployees : "—"}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                        <div className="text-xs font-semibold text-slate-600">Founded</div>
                        <div className="mt-1 font-medium text-slate-900">
                          {typeof org?.foundedYear === "number" ? org.foundedYear : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">Website</div>
                      <div className="mt-1 font-medium text-slate-900 break-all">
                        {org?.websiteConsent && org?.websiteUrl ? org.websiteUrl : "—"}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {org?.websiteUrl
                          ? org?.websiteConsent
                            ? "✓ Consent granted"
                            : "Consent not granted"
                          : "No website provided"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Footer actions */}
              <div className="p-4 border-t border-slate-200 bg-white">
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
                    onClick={() => {
                      setProfileOpen(false);
                      router.push("/dashboard");
                    }}
                  >
                    Return home
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-xl bg-slate-900 px-3 py-2 text-left text-sm font-medium text-white hover:bg-slate-800 transition"
                    onClick={async () => {
                      await signOut(auth);
                      router.push("/login");
                    }}
                  >
                    Sign out
                  </button>

                  <div className="pt-1 text-xs text-slate-500">{checkingOrg ? "Loading organization..." : null}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Activity</h1>
            <p className="mt-2 text-base text-slate-600 font-medium">
              View and resume in-progress documents or review approved documents.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="border-2 border-slate-200 bg-white rounded-xl px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
              onClick={() => router.push("/dashboard")}
              type="button"
            >
              Back
            </button>
            <button
              className="rounded-xl bg-gradient-to-r from-primary-500 to-accent-400 px-4 py-2 text-sm font-medium text-white hover:from-primary-600 hover:to-primary-500 shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40 transition disabled:opacity-60"
              onClick={loadPlans}
              disabled={busy || checkingOrg || !activeOrgId}
              type="button"
              title={!activeOrgId ? "Missing org context" : undefined}
            >
              {busy ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 items-center">
          <div className="flex gap-2">
            <button
              className={
                status === "in_progress"
                  ? "rounded-xl bg-gradient-to-r from-primary-500 to-accent-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/30"
                  : "rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
              }
              onClick={() => setStatus("in_progress")}
              type="button"
            >
              In progress
            </button>
            <button
              className={
                status === "approved"
                  ? "rounded-xl bg-gradient-to-r from-primary-500 to-accent-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/30"
                  : "rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
              }
              onClick={() => setStatus("approved")}
              type="button"
            >
              Approved
            </button>
          </div>

          <input
            className="flex-1 min-w-[260px] border-2 border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition"
            placeholder="Search documents..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="border-2 border-slate-200 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition bg-white"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="updated_desc">Most recently edited</option>
            <option value="updated_asc">Least recently edited</option>
            <option value="created_desc">Newest created</option>
            <option value="created_asc">Oldest created</option>
          </select>
        </div>

        {err && (
          <div className="mt-4 rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-medium">
            {err}
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-lg">
          {checkingOrg ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-600 font-medium">Loading organization...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mb-4">
                <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <p className="text-sm text-slate-600 font-medium">No documents found.</p>
              <p className="text-xs text-slate-500 mt-1">Try adjusting your search or filters.</p>
            </div>
          ) : (
            filtered.map((p, idx) => {
              const prog =
                p.progress && typeof p.progress.completedSections === "number"
                  ? `${p.progress.completedSections}/${p.progress.totalSections ?? 0}`
                  : null;

              const actionLabel = p.status === "approved" ? "View" : "Resume";
              const actionHref =
                p.status === "approved"
                  ? `/plans/${encodeURIComponent(p.id)}`
                  : `/handbook/crafter/template?planId=${encodeURIComponent(p.id)}`;

              return (
                <div
                  key={p.id}
                  className={
                    idx === 0
                      ? "flex items-center justify-between gap-4 p-6 hover:bg-slate-50 transition"
                      : "flex items-center justify-between gap-4 border-t-2 border-slate-100 p-6 hover:bg-slate-50 transition"
                  }
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 text-base">{p.title}</div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      {p.status === "approved" ? (
                        <span className="inline-flex items-center rounded-lg bg-gradient-to-r from-success-400 to-success-400 px-2.5 py-1 font-semibold text-white shadow-sm">
                          Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                          In progress
                        </span>
                      )}

                      {prog ? (
                        <span className="inline-flex items-center rounded-lg bg-slate-100 border border-slate-300 px-2.5 py-1 font-semibold text-slate-700">
                          Progress {prog}
                        </span>
                      ) : null}

                      {p.status === "approved" ? (
                        <span className="text-slate-600">
                          • Approved by{" "}
                          <span className="font-medium text-slate-800">{p.approvedBy?.email ?? "Unknown"}</span>
                          {p.approvedAt ? ` on ${formatDate(p.approvedAt)}` : ""}
                        </span>
                      ) : p.updatedAt ? (
                        <span className="text-slate-600">• Updated {formatDate(p.updatedAt)}</span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    className="flex-shrink-0 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 shadow-lg hover:shadow-xl transition"
                    onClick={() => router.push(actionHref)}
                    type="button"
                  >
                    {actionLabel}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-4 rounded-xl bg-primary-50 border-2 border-primary-200 px-4 py-3">
          <p className="text-xs text-primary-600 font-medium">
            💡 Tip: Once you add an &quot;Approve&quot; action, approved handbooks will appear under the Approved tab.
          </p>
        </div>
      </div>
    </main>
  );
}



