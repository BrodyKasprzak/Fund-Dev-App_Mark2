"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";
import { doc, getDoc } from "firebase/firestore";

type PlanRow = {
  id: string;
  title: string;
  templateType: string | null;
  status: "in_progress" | "approved" | string;
  progress: { completedSections: number; totalSections: number } | null;
  createdAt: any;
  updatedAt: any;
  approvedAt?: any;
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

function formatDate(ts: any) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    if (!d) return "";
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
  const { user, loading } = useAuth();

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [status, setStatus] = useState<"in_progress" | "approved">("in_progress");
  const [sort, setSort] = useState<
    "updated_desc" | "updated_asc" | "created_desc" | "created_asc"
  >("updated_desc");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Profile popover state
  const [profileOpen, setProfileOpen] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement | null>(null);
  const profilePopoverRef = useRef<HTMLDivElement | null>(null);

  // Org profile state (mirrors dashboard info)
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [orgInfoOpen, setOrgInfoOpen] = useState(false);
  const [checkingOrg, setCheckingOrg] = useState(true);

  // Load org profile (same approach as Dashboard)
  useEffect(() => {
    async function loadOrg() {
      if (loading) return;
      if (!user) {
        setCheckingOrg(false);
        return;
      }

      setCheckingOrg(true);
      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? snap.data() : null;
        const orgId = (data as any)?.orgId;

        if (!orgId) {
          setOrg(null);
          return;
        }

        // Ensure membership exists
        const memberRef = doc(db, "organizations", orgId, "members", user.uid);
        const memberSnap = await getDoc(memberRef);
        if (!memberSnap.exists()) {
          setOrg(null);
          return;
        }

        const orgRef = doc(db, "organizations", orgId);
        const orgSnap = await getDoc(orgRef);
        if (!orgSnap.exists()) {
          setOrg(null);
          return;
        }

        const o = orgSnap.data() as any;

        const loaded: OrgProfile = {
          id: orgId,
          name: String(o?.name ?? "").trim() || "Your organization",
          mission: typeof o?.mission === "string" ? o.mission : null,
          homeState: typeof o?.homeState === "string" ? o.homeState : null,
          taxStatus: typeof o?.taxStatus === "string" ? o.taxStatus : null,
          fiscalYear: typeof o?.fiscalYear === "string" ? o.fiscalYear : null,
          crm: typeof o?.crm === "string" ? o.crm : null,
          address: typeof o?.address === "string" ? o.address : null,
          numEmployees: typeof o?.numEmployees === "number" ? o.numEmployees : null,
          foundedYear: typeof o?.foundedYear === "number" ? o.foundedYear : null,
          websiteUrl: typeof o?.websiteUrl === "string" ? o.websiteUrl : null,
          websiteConsent: typeof o?.websiteConsent === "boolean" ? o.websiteConsent : null,
        };

        setOrg(loaded);
      } catch (e) {
        console.error("Activity org load error:", e);
        setOrg(null);
      } finally {
        setCheckingOrg(false);
      }
    }

    loadOrg();
  }, [user, loading]);

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

  async function load() {
    if (!user) return;
    setBusy(true);
    setErr(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/plans/list?templateType=fund_dev_handbook&status=all&sort=${encodeURIComponent(
          sort
        )}&limit=200`,
        {
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load plans");
      setPlans(data?.plans ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!loading && user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, sort]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (plans ?? [])
      .filter((p) => (p.status ?? "in_progress") === status)
      .filter((p) => {
        if (!needle) return true;
        return (p.title ?? "").toLowerCase().includes(needle);
      });
  }, [plans, status, q]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-4 shadow-lg">
            <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="text-slate-700 font-medium">Please sign in to continue.</p>
        </div>
      </main>
    );
  }

  const orgDisplayName = (org?.name || "").trim() || "Your organization";
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
                      <div className="text-sm font-semibold truncate">
                        {orgDisplayName}
                      </div>
                      <div className="mt-0.5 text-xs text-white/80 truncate">
                        Signed in as{" "}
                        <span className="font-medium">
                          {user?.email ?? "Unknown"}
                        </span>
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
                    <div className="text-xs font-bold text-white/90">
                      Mission
                    </div>
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
                      <div className="text-xs font-semibold text-slate-600">
                        Home state
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.homeState?.trim() ? org.homeState : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">
                        Tax status
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.taxStatus?.trim() ? org.taxStatus : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">
                        Fiscal year
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.fiscalYear?.trim() ? org.fiscalYear : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">CRM</div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.crm?.trim() ? org.crm : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">
                        Address
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {org?.address?.trim() ? org.address : "—"}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                        <div className="text-xs font-semibold text-slate-600">
                          Employees
                        </div>
                        <div className="mt-1 font-medium text-slate-900">
                          {typeof org?.numEmployees === "number"
                            ? org.numEmployees
                            : "—"}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                        <div className="text-xs font-semibold text-slate-600">
                          Founded
                        </div>
                        <div className="mt-1 font-medium text-slate-900">
                          {typeof org?.foundedYear === "number"
                            ? org.foundedYear
                            : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-600">
                        Website
                      </div>
                      <div className="mt-1 font-medium text-slate-900 break-all">
                        {org?.websiteConsent && org?.websiteUrl
                          ? org.websiteUrl
                          : "—"}
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

                  {/* Optional subtle status line */}
                  <div className="pt-1 text-xs text-slate-500">
                    {checkingOrg ? "Loading organization..." : null}
                  </div>
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
            >
              Back
            </button>
            <button
              className="rounded-xl bg-gradient-to-r from-primary-500 to-accent-400 px-4 py-2 text-sm font-medium text-white hover:from-primary-600 hover:to-primary-500 shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40 transition disabled:opacity-60"
              onClick={load}
              disabled={busy}
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
            onChange={(e) => setSort(e.target.value as any)}
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
          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mb-4">
                <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
                          <span className="font-medium text-slate-800">
                            {p.approvedBy?.email ?? "Unknown"}
                          </span>
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
            💡 Tip: Once you add an "Approve" action, approved handbooks will appear under the Approved tab.
          </p>
        </div>
      </div>
    </main>
  );
}



// "use client";

// import { useEffect, useMemo, useRef, useState } from "react";
// import { useRouter } from "next/navigation";
// import { signOut } from "firebase/auth";
// import { auth, db } from "@/lib/firebaseClient";
// import { useAuth } from "@/lib/AuthContext";
// import { doc, getDoc } from "firebase/firestore";

// type PlanRow = {
//   id: string;
//   title: string;
//   templateType: string | null;
//   status: "in_progress" | "approved" | string;
//   progress: { completedSections: number; totalSections: number } | null;
//   createdAt: any;
//   updatedAt: any;
//   approvedAt?: any;
//   approvedBy?: { uid?: string | null; email?: string | null } | null;
// };

// type OrgProfile = {
//   id: string;
//   name: string;
//   mission?: string | null;
//   homeState?: string | null;
//   taxStatus?: string | null;
//   fiscalYear?: string | null;
//   crm?: string | null;
//   address?: string | null;
//   numEmployees?: number | null;
//   foundedYear?: number | null;
//   websiteUrl?: string | null;
//   websiteConsent?: boolean | null;
// };

// function formatDate(ts: any) {
//   try {
//     const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
//     if (!d) return "";
//     return d.toLocaleDateString(undefined, {
//       year: "numeric",
//       month: "short",
//       day: "numeric",
//     });
//   } catch {
//     return "";
//   }
// }

// function initialsFromName(name?: string) {
//   const n = String(name ?? "").trim();
//   if (!n) return "O";
//   const parts = n.split(/\s+/).filter(Boolean);
//   const a = parts[0]?.[0] ?? "O";
//   const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
//   return (a + b).toUpperCase();
// }

// export default function ActivityPage() {
//   const router = useRouter();
//   const { user, loading } = useAuth();

//   const [plans, setPlans] = useState<PlanRow[]>([]);
//   const [status, setStatus] = useState<"in_progress" | "approved">("in_progress");
//   const [sort, setSort] = useState<
//     "updated_desc" | "updated_asc" | "created_desc" | "created_asc"
//   >("updated_desc");
//   const [q, setQ] = useState("");
//   const [busy, setBusy] = useState(false);
//   const [err, setErr] = useState<string | null>(null);

//   // Profile popover state
//   const [profileOpen, setProfileOpen] = useState(false);
//   const profileBtnRef = useRef<HTMLButtonElement | null>(null);
//   const profilePopoverRef = useRef<HTMLDivElement | null>(null);

//   // Org profile state (mirrors dashboard info)
//   const [org, setOrg] = useState<OrgProfile | null>(null);
//   const [orgInfoOpen, setOrgInfoOpen] = useState(false);
//   const [checkingOrg, setCheckingOrg] = useState(true);

//   // Load org profile (same approach as Dashboard)
//   useEffect(() => {
//     async function loadOrg() {
//       if (loading) return;
//       if (!user) {
//         setCheckingOrg(false);
//         return;
//       }

//       setCheckingOrg(true);
//       try {
//         const userRef = doc(db, "users", user.uid);
//         const snap = await getDoc(userRef);
//         const data = snap.exists() ? snap.data() : null;
//         const orgId = (data as any)?.orgId;

//         if (!orgId) {
//           setOrg(null);
//           return;
//         }

//         // Ensure membership exists
//         const memberRef = doc(db, "organizations", orgId, "members", user.uid);
//         const memberSnap = await getDoc(memberRef);
//         if (!memberSnap.exists()) {
//           setOrg(null);
//           return;
//         }

//         const orgRef = doc(db, "organizations", orgId);
//         const orgSnap = await getDoc(orgRef);
//         if (!orgSnap.exists()) {
//           setOrg(null);
//           return;
//         }

//         const o = orgSnap.data() as any;

//         const loaded: OrgProfile = {
//           id: orgId,
//           name: String(o?.name ?? "").trim() || "Your organization",
//           mission: typeof o?.mission === "string" ? o.mission : null,
//           homeState: typeof o?.homeState === "string" ? o.homeState : null,
//           taxStatus: typeof o?.taxStatus === "string" ? o.taxStatus : null,
//           fiscalYear: typeof o?.fiscalYear === "string" ? o.fiscalYear : null,
//           crm: typeof o?.crm === "string" ? o.crm : null,
//           address: typeof o?.address === "string" ? o.address : null,
//           numEmployees: typeof o?.numEmployees === "number" ? o.numEmployees : null,
//           foundedYear: typeof o?.foundedYear === "number" ? o.foundedYear : null,
//           websiteUrl: typeof o?.websiteUrl === "string" ? o.websiteUrl : null,
//           websiteConsent: typeof o?.websiteConsent === "boolean" ? o.websiteConsent : null,
//         };

//         setOrg(loaded);
//       } catch (e) {
//         console.error("Activity org load error:", e);
//         setOrg(null);
//       } finally {
//         setCheckingOrg(false);
//       }
//     }

//     loadOrg();
//   }, [user, loading]);

//   // Close profile popover on outside click / ESC
//   useEffect(() => {
//     if (!profileOpen) return;

//     function onKeyDown(e: KeyboardEvent) {
//       if (e.key === "Escape") setProfileOpen(false);
//     }

//     function onMouseDown(e: MouseEvent) {
//       const btn = profileBtnRef.current;
//       const pop = profilePopoverRef.current;
//       const target = e.target as Node | null;
//       if (!target) return;
//       if (btn && btn.contains(target)) return;
//       if (pop && pop.contains(target)) return;
//       setProfileOpen(false);
//     }

//     window.addEventListener("keydown", onKeyDown);
//     window.addEventListener("mousedown", onMouseDown);
//     return () => {
//       window.removeEventListener("keydown", onKeyDown);
//       window.removeEventListener("mousedown", onMouseDown);
//     };
//   }, [profileOpen]);

//   async function load() {
//     if (!user) return;
//     setBusy(true);
//     setErr(null);

//     try {
//       const idToken = await user.getIdToken();
//       const res = await fetch(
//         `/api/plans/list?templateType=fund_dev_handbook&status=all&sort=${encodeURIComponent(
//           sort
//         )}&limit=200`,
//         {
//           headers: { Authorization: `Bearer ${idToken}` },
//         }
//       );

//       const data = await res.json();
//       if (!res.ok) throw new Error(data?.error ?? "Failed to load plans");
//       setPlans(data?.plans ?? []);
//     } catch (e: any) {
//       setErr(e?.message ?? "Failed to load");
//     } finally {
//       setBusy(false);
//     }
//   }

//   useEffect(() => {
//     if (!loading && user) load();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [loading, user, sort]);

//   const filtered = useMemo(() => {
//     const needle = q.trim().toLowerCase();
//     return (plans ?? [])
//       .filter((p) => (p.status ?? "in_progress") === status)
//       .filter((p) => {
//         if (!needle) return true;
//         return (p.title ?? "").toLowerCase().includes(needle);
//       });
//   }, [plans, status, q]);

//   if (loading) {
//     return (
//       <main className="min-h-screen flex items-center justify-center">
//         <p>Loading...</p>
//       </main>
//     );
//   }

//   if (!user) {
//     return (
//       <main className="min-h-screen flex items-center justify-center">
//         <p>Please sign in.</p>
//       </main>
//     );
//   }

//   const orgDisplayName = (org?.name || "").trim() || "Your organization";
//   const avatarText = initialsFromName(orgDisplayName);

//   return (
//     <main className="min-h-screen bg-slate-50 p-6 relative">
//       {/* Profile icon in upper right */}
//       <div className="absolute top-6 right-6 z-10">
//         <div className="relative">
//           <button
//             ref={profileBtnRef}
//             type="button"
//             aria-label="Open profile"
//             className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white shadow-sm hover:bg-primary-700"
//             onClick={() => setProfileOpen((v) => !v)}
//           >
//             {avatarText}
//           </button>

//           {profileOpen ? (
//             <div
//               ref={profilePopoverRef}
//               className="absolute right-0 z-50 mt-2 w-[380px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
//             >
//               {/* Header */}
//               <div className="bg-gradient-to-br from-primary-600 via-primary-500 to-accent-400 p-4 text-white">
//                 <div className="flex items-start justify-between gap-3">
//                   <div className="flex items-center gap-3 min-w-0">
//                     <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold backdrop-blur-sm">
//                       {avatarText}
//                     </div>
//                     <div className="min-w-0">
//                       <div className="text-sm font-semibold truncate">
//                         {orgDisplayName}
//                       </div>
//                       <div className="mt-0.5 text-xs text-white/80 truncate">
//                         Signed in as{" "}
//                         <span className="font-medium">
//                           {user?.email ?? "Unknown"}
//                         </span>
//                       </div>
//                     </div>
//                   </div>

//                   <button
//                     type="button"
//                     className="rounded-md bg-white/15 px-2 py-1 text-xs text-white hover:bg-white/20 border border-white/20"
//                     onClick={() => setProfileOpen(false)}
//                   >
//                     Close
//                   </button>
//                 </div>

//                 {/* Mission preview */}
//                 <div className="mt-3 rounded-xl bg-white/15 backdrop-blur-sm p-3 border border-white/20">
//                   <div className="flex items-center gap-2 mb-1">
//                     <div className="h-2 w-2 rounded-full bg-success-300" />
//                     <div className="text-xs font-bold text-white/90">
//                       Mission
//                     </div>
//                   </div>
//                   <div className="text-sm leading-relaxed">
//                     {org?.mission?.trim() ? org.mission : "Not provided yet."}
//                   </div>
//                 </div>

//                 {/* Org info toggle */}
//                 <button
//                   type="button"
//                   className="mt-3 w-full rounded-xl bg-white/15 backdrop-blur-sm px-3 py-2.5 text-left hover:bg-white/20 transition border border-white/20"
//                   onClick={() => setOrgInfoOpen((v) => !v)}
//                 >
//                   <div className="flex items-center justify-between">
//                     <div className="flex items-center gap-2">
//                       <div className="h-2 w-2 rounded-full bg-accent-300" />
//                       <div className="text-sm font-bold">Organization info</div>
//                     </div>
//                     <div className="text-sm font-bold">{orgInfoOpen ? "−" : "+"}</div>
//                   </div>
//                 </button>
//               </div>

//               {/* Expanded org info */}
//               {orgInfoOpen ? (
//                 <div className="p-4 bg-white">
//                   <div className="space-y-2 text-sm">
//                     <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                       <div className="text-xs font-semibold text-slate-600">
//                         Home state
//                       </div>
//                       <div className="mt-1 font-medium text-slate-900">
//                         {org?.homeState?.trim() ? org.homeState : "—"}
//                       </div>
//                     </div>

//                     <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                       <div className="text-xs font-semibold text-slate-600">
//                         Tax status
//                       </div>
//                       <div className="mt-1 font-medium text-slate-900">
//                         {org?.taxStatus?.trim() ? org.taxStatus : "—"}
//                       </div>
//                     </div>

//                     <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                       <div className="text-xs font-semibold text-slate-600">
//                         Fiscal year
//                       </div>
//                       <div className="mt-1 font-medium text-slate-900">
//                         {org?.fiscalYear?.trim() ? org.fiscalYear : "—"}
//                       </div>
//                     </div>

//                     <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                       <div className="text-xs font-semibold text-slate-600">CRM</div>
//                       <div className="mt-1 font-medium text-slate-900">
//                         {org?.crm?.trim() ? org.crm : "—"}
//                       </div>
//                     </div>

//                     <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                       <div className="text-xs font-semibold text-slate-600">
//                         Address
//                       </div>
//                       <div className="mt-1 font-medium text-slate-900">
//                         {org?.address?.trim() ? org.address : "—"}
//                       </div>
//                     </div>

//                     <div className="grid grid-cols-2 gap-2">
//                       <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                         <div className="text-xs font-semibold text-slate-600">
//                           Employees
//                         </div>
//                         <div className="mt-1 font-medium text-slate-900">
//                           {typeof org?.numEmployees === "number"
//                             ? org.numEmployees
//                             : "—"}
//                         </div>
//                       </div>
//                       <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                         <div className="text-xs font-semibold text-slate-600">
//                           Founded
//                         </div>
//                         <div className="mt-1 font-medium text-slate-900">
//                           {typeof org?.foundedYear === "number"
//                             ? org.foundedYear
//                             : "—"}
//                         </div>
//                       </div>
//                     </div>

//                     <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
//                       <div className="text-xs font-semibold text-slate-600">
//                         Website
//                       </div>
//                       <div className="mt-1 font-medium text-slate-900 break-all">
//                         {org?.websiteConsent && org?.websiteUrl
//                           ? org.websiteUrl
//                           : "—"}
//                       </div>
//                       <div className="mt-2 text-xs text-slate-500">
//                         {org?.websiteUrl
//                           ? org?.websiteConsent
//                             ? "✓ Consent granted"
//                             : "Consent not granted"
//                           : "No website provided"}
//                       </div>
//                     </div>
//                   </div>
//                 </div>
//               ) : null}

//               {/* Footer actions */}
//               <div className="p-4 border-t border-slate-200 bg-white">
//                 <div className="flex flex-col gap-2">
//                   <button
//                     type="button"
//                     className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
//                     onClick={() => {
//                       setProfileOpen(false);
//                       router.push("/dashboard");
//                     }}
//                   >
//                     Return home
//                   </button>

//                   <button
//                     type="button"
//                     className="w-full rounded-xl bg-slate-900 px-3 py-2 text-left text-sm text-white hover:bg-slate-800"
//                     onClick={async () => {
//                       await signOut(auth);
//                       router.push("/login");
//                     }}
//                   >
//                     Sign out
//                   </button>

//                   {/* Optional subtle status line */}
//                   <div className="pt-1 text-xs text-slate-500">
//                     {checkingOrg ? "Loading organization..." : null}
//                   </div>
//                 </div>
//               </div>
//             </div>
//           ) : null}
//         </div>
//       </div>

//       <div className="mx-auto max-w-6xl">
//         <div className="flex items-center justify-between">
//           <div>
//             <h1 className="text-2xl font-semibold text-slate-900">Activity</h1>
//             <p className="mt-1 text-sm text-slate-600">
//               View and resume in-progress documents or review approved handbooks.
//             </p>
//           </div>
//           <div className="flex gap-2">
//             <button
//               className="border border-slate-200 bg-white rounded-md px-3 py-2 text-slate-800 hover:bg-slate-100"
//               onClick={() => router.push("/dashboard")}
//             >
//               Back
//             </button>
//             <button
//               className="rounded-md bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 disabled:opacity-60"
//               onClick={load}
//               disabled={busy}
//             >
//               {busy ? "Refreshing..." : "Refresh"}
//             </button>
//           </div>
//         </div>

//         <div className="mt-5 flex flex-wrap gap-3 items-center">
//           <div className="flex gap-2">
//             <button
//               className={
//                 status === "in_progress"
//                   ? "rounded-md bg-slate-900 px-3 py-2 text-white"
//                   : "rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 hover:bg-slate-100"
//               }
//               onClick={() => setStatus("in_progress")}
//               type="button"
//             >
//               In progress
//             </button>
//             <button
//               className={
//                 status === "approved"
//                   ? "rounded-md bg-slate-900 px-3 py-2 text-white"
//                   : "rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 hover:bg-slate-100"
//               }
//               onClick={() => setStatus("approved")}
//               type="button"
//             >
//               Approved
//             </button>
//           </div>

//           <input
//             className="flex-1 min-w-[260px] border border-slate-200 rounded-md p-2"
//             placeholder="Search documents..."
//             value={q}
//             onChange={(e) => setQ(e.target.value)}
//           />

//           <select
//             className="border border-slate-200 rounded-md p-2"
//             value={sort}
//             onChange={(e) => setSort(e.target.value as any)}
//           >
//             <option value="updated_desc">Most recently edited</option>
//             <option value="updated_asc">Least recently edited</option>
//             <option value="created_desc">Newest created</option>
//             <option value="created_asc">Oldest created</option>
//           </select>
//         </div>

//         {err && (
//           <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
//             {err}
//           </div>
//         )}

//         <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
//           {filtered.length === 0 ? (
//             <div className="p-5 text-sm text-slate-600">No documents found.</div>
//           ) : (
//             filtered.map((p, idx) => {
//               const prog =
//                 p.progress && typeof p.progress.completedSections === "number"
//                   ? `${p.progress.completedSections}/${p.progress.totalSections ?? 0}`
//                   : null;

//               const actionLabel = p.status === "approved" ? "View" : "Resume";
//               const actionHref =
//                 p.status === "approved"
//                   ? `/plans/${encodeURIComponent(p.id)}`
//                   : `/handbook/crafter/template?planId=${encodeURIComponent(p.id)}`;

//               return (
//                 <div
//                   key={p.id}
//                   className={
//                     idx === 0
//                       ? "flex items-center justify-between gap-4 p-5"
//                       : "flex items-center justify-between gap-4 border-t border-slate-200 p-5"
//                   }
//                 >
//                   <div>
//                     <div className="font-semibold text-slate-900">{p.title}</div>
//                     <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
//                       {p.status === "approved" ? (
//                         <span className="inline-flex items-center rounded-full bg-success-400 px-2 py-0.5 font-semibold text-white">
//                           Approved
//                         </span>
//                       ) : (
//                         <span>In progress</span>
//                       )}

//                       {prog ? <span>• Progress {prog}</span> : null}

//                       {p.status === "approved" ? (
//                         <span>
//                           • Approved by{" "}
//                           <span className="font-medium text-slate-700">
//                             {p.approvedBy?.email ?? "Unknown"}
//                           </span>
//                           {p.approvedAt ? ` on ${formatDate(p.approvedAt)}` : ""}
//                         </span>
//                       ) : p.updatedAt ? (
//                         <span>• Updated {formatDate(p.updatedAt)}</span>
//                       ) : null}
//                     </div>
//                   </div>

//                   <button
//                     className="rounded-md bg-slate-900 px-3 py-2 text-white hover:bg-slate-800"
//                     onClick={() => router.push(actionHref)}
//                     type="button"
//                   >
//                     {actionLabel}
//                   </button>
//                 </div>
//               );
//             })
//           )}
//         </div>

//         <p className="mt-3 text-xs text-slate-500">
//           Tip: once you add an "Approve" action, approved handbooks will appear under the Approved tab.
//         </p>
//       </div>
//     </main>
//   );
// }





// "use client";

// import { useEffect, useMemo, useState } from "react";
// import { useRouter } from "next/navigation";
// import { useAuth } from "@/lib/AuthContext";

// type PlanRow = {
//   id: string;
//   title: string;
//   templateType: string | null;
//   status: "in_progress" | "approved" | string;
//   progress: { completedSections: number; totalSections: number } | null;
//   createdAt: any;
//   updatedAt: any;

//   // NEW (populate from backend)
//   approvedAt?: any;
//   approvedBy?: { uid?: string | null; email?: string | null } | null;
// };

// function formatDate(ts: any) {
//   try {
//     const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
//     if (!d) return "";
//     return d.toLocaleDateString(undefined, {
//       year: "numeric",
//       month: "short",
//       day: "numeric",
//     });
//   } catch {
//     return "";
//   }
// }

// export default function ActivityPage() {
//   const router = useRouter();
//   const { user, loading } = useAuth();

//   const [plans, setPlans] = useState<PlanRow[]>([]);
//   const [status, setStatus] = useState<"in_progress" | "approved">("in_progress");
//   const [sort, setSort] = useState<"updated_desc" | "updated_asc" | "created_desc" | "created_asc">(
//     "updated_desc"
//   );
//   const [q, setQ] = useState("");
//   const [busy, setBusy] = useState(false);
//   const [err, setErr] = useState<string | null>(null);

//   async function load() {
//     if (!user) return;
//     setBusy(true);
//     setErr(null);

//     try {
//       const idToken = await user.getIdToken();

//       // You can switch templateType=all later to show every document type.
//       const res = await fetch(
//         `/api/plans/list?templateType=fund_dev_handbook&status=all&sort=${encodeURIComponent(
//           sort
//         )}&limit=200`,
//         {
//           headers: { Authorization: `Bearer ${idToken}` },
//         }
//       );

//       const data = await res.json();
//       if (!res.ok) throw new Error(data?.error ?? "Failed to load plans");

//       setPlans(data?.plans ?? []);
//     } catch (e: any) {
//       setErr(e?.message ?? "Failed to load");
//     } finally {
//       setBusy(false);
//     }
//   }

//   useEffect(() => {
//     if (!loading && user) load();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [loading, user, sort]);

//   const filtered = useMemo(() => {
//     const needle = q.trim().toLowerCase();
//     return (plans ?? [])
//       .filter((p) => (p.status ?? "in_progress") === status)
//       .filter((p) => {
//         if (!needle) return true;
//         return (p.title ?? "").toLowerCase().includes(needle);
//       });
//   }, [plans, status, q]);

//   if (loading) {
//     return (
//       <main className="min-h-screen flex items-center justify-center">
//         <p>Loading...</p>
//       </main>
//     );
//   }

//   if (!user) {
//     return (
//       <main className="min-h-screen flex items-center justify-center">
//         <p>Please sign in.</p>
//       </main>
//     );
//   }

//   return (
//     <main className="min-h-screen bg-slate-50 p-6">
//       <div className="mx-auto max-w-6xl">
//         <div className="flex items-center justify-between">
//           <div>
//             <h1 className="text-2xl font-semibold text-slate-900">Activity</h1>
//             <p className="mt-1 text-sm text-slate-600">
//               View and resume in-progress documents or review approved handbooks.
//             </p>
//           </div>

//           <div className="flex gap-2">
//             <button
//               className="border border-slate-200 bg-white rounded-md px-3 py-2 text-slate-800 hover:bg-slate-100"
//               onClick={() => router.push("/dashboard")}
//             >
//               Back
//             </button>
//             <button
//               className="rounded-md bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 disabled:opacity-60"
//               onClick={load}
//               disabled={busy}
//             >
//               {busy ? "Refreshing..." : "Refresh"}
//             </button>
//           </div>
//         </div>

//         <div className="mt-5 flex flex-wrap gap-3 items-center">
//           <div className="flex gap-2">
//             <button
//               className={
//                 status === "in_progress"
//                   ? "rounded-md bg-slate-900 px-3 py-2 text-white"
//                   : "rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 hover:bg-slate-100"
//               }
//               onClick={() => setStatus("in_progress")}
//               type="button"
//             >
//               In progress
//             </button>
//             <button
//               className={
//                 status === "approved"
//                   ? "rounded-md bg-slate-900 px-3 py-2 text-white"
//                   : "rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 hover:bg-slate-100"
//               }
//               onClick={() => setStatus("approved")}
//               type="button"
//             >
//               Approved
//             </button>
//           </div>

//           <input
//             className="flex-1 min-w-[260px] border border-slate-200 rounded-md p-2"
//             placeholder="Search documents..."
//             value={q}
//             onChange={(e) => setQ(e.target.value)}
//           />

//           <select
//             className="border border-slate-200 rounded-md p-2"
//             value={sort}
//             onChange={(e) => setSort(e.target.value as any)}
//           >
//             <option value="updated_desc">Most recently edited</option>
//             <option value="updated_asc">Least recently edited</option>
//             <option value="created_desc">Newest created</option>
//             <option value="created_asc">Oldest created</option>
//           </select>
//         </div>

//         {err && (
//           <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
//             {err}
//           </div>
//         )}

//         <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
//           {filtered.length === 0 ? (
//             <div className="p-5 text-sm text-slate-600">No documents found.</div>
//           ) : (
//             filtered.map((p, idx) => {
//               const prog =
//                 p.progress && typeof p.progress.completedSections === "number"
//                   ? `${p.progress.completedSections}/${p.progress.totalSections ?? 0}`
//                   : null;

//               const actionLabel = p.status === "approved" ? "View" : "Resume";
//               const actionHref =
//                 p.status === "approved"
//                   ? `/plans/${encodeURIComponent(p.id)}`
//                   : `/handbook/crafter/template?planId=${encodeURIComponent(p.id)}`;

//               return (
//                 <div
//                   key={p.id}
//                   className={
//                     idx === 0
//                       ? "flex items-center justify-between gap-4 p-5"
//                       : "flex items-center justify-between gap-4 border-t border-slate-200 p-5"
//                   }
//                 >
//                   <div>
//                     <div className="font-semibold text-slate-900">{p.title}</div>
//                     <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
//                       {p.status === "approved" ? (
//                         <span className="inline-flex items-center rounded-full bg-success-400 px-2 py-0.5 font-semibold text-white">
//                           Approved
//                         </span>
//                       ) : (
//                         <span>In progress</span>
//                       )}

//                       {prog ? <span>• Progress {prog}</span> : null}

//                       {p.status === "approved" ? (
//                         <span>
//                           • Approved by{" "}
//                           <span className="font-medium text-slate-700">
//                             {p.approvedBy?.email ?? "Unknown"}
//                           </span>
//                           {p.approvedAt ? ` on ${formatDate(p.approvedAt)}` : ""}
//                         </span>
//                       ) : (
//                         p.updatedAt ? <span>• Updated {formatDate(p.updatedAt)}</span> : null
//                       )}
//                     </div>

//                   </div>

//                   <button
//                     className="rounded-md bg-slate-900 px-3 py-2 text-white hover:bg-slate-800"
//                     onClick={() => router.push(actionHref)}
//                     type="button"
//                   >
//                     {actionLabel}
//                   </button>
//                 </div>
//               );
//             })
//           )}
//         </div>

//         <p className="mt-3 text-xs text-slate-500">
//           Tip: once you add an “Approve” action, approved handbooks will appear under the Approved tab.
//         </p>
//       </div>
//     </main>
//   );
// }
