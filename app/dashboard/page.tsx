"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";
import { doc, getDoc } from "firebase/firestore";

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

function initialsFromName(name?: string) {
  const n = String(name ?? "").trim();
  if (!n) return "O";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "O";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

export default function DashboardPage() {
  const router = useRouter();

  // ✅ NEW: use activeOrgId + setter + authedFetch from AuthContext
  const { user, loading, activeOrgId, setActiveOrgId, clearActiveOrgId, authedFetch } =
    useAuth();

  const [checkingOrg, setCheckingOrg] = useState(true);
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [orgInfoOpen, setOrgInfoOpen] = useState(false);

  // Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const [activityNote] = useState(
    "Recent activity will appear here once plans are created and edited."
  );

  const canSendInvites = useMemo(() => {
    const cleaned = inviteEmails.map((e) => e.trim()).filter(Boolean);
    return cleaned.length > 0 && !inviteSending;
  }, [inviteEmails, inviteSending]);

  useEffect(() => {
    async function checkOrg() {
      if (loading) return;

      if (!user) {
        router.push("/login");
        return;
      }

      try {
        // 1) Determine org context:
        //    - primary: activeOrgId (context)
        //    - fallback: users/{uid}.lastOrgId (hint only)
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? snap.data() : null;

        const orgId =
          activeOrgId || (typeof data?.lastOrgId === "string" ? data.lastOrgId : null);

        if (!orgId) {
          router.push("/onboarding/org");
          return;
        }

        // 2) Verify membership (authorization gate)
        const memberRef = doc(db, "organizations", orgId, "members", user.uid);
        const memberSnap = await getDoc(memberRef);

        if (!memberSnap.exists()) {
          // stale org context -> clear to prevent redirect loops
          clearActiveOrgId();
          router.push("/onboarding/org");
          return;
        }

        // 3) Persist org context (now "known good")
        if (orgId !== activeOrgId) setActiveOrgId(orgId);

        // 4) Load org profile
        const orgRef = doc(db, "organizations", orgId);
        const orgSnap = await getDoc(orgRef);

        if (!orgSnap.exists()) {
          router.push("/onboarding/org");
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
          websiteConsent:
            typeof o?.websiteConsent === "boolean" ? o.websiteConsent : null,
        };

        setOrg(loaded);
      } catch (err) {
        console.error("Dashboard org check error:", err);
        router.push("/onboarding/org");
        return;
      } finally {
        setCheckingOrg(false);
      }
    }

    checkOrg();
  }, [
    user,
    loading,
    router,
    activeOrgId,
    setActiveOrgId,
    clearActiveOrgId,
  ]);

  function openInviteModal() {
    setInviteMsg(null);
    setInviteEmails([""]);
    setInviteOpen(true);
  }

  function closeInviteModal() {
    setInviteOpen(false);
  }

  function updateEmail(idx: number, value: string) {
    setInviteEmails((prev) => prev.map((e, i) => (i === idx ? value : e)));
  }

  function addAnotherEmail() {
    setInviteEmails((prev) => [...prev, ""]);
  }

  function removeEmail(idx: number) {
    setInviteEmails((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSendInvites() {
    if (!user) return;

    setInviteSending(true);
    setInviteMsg(null);

    try {
      const cleaned = inviteEmails.map((e) => e.trim()).filter(Boolean);

      // ✅ NEW: use authedFetch so x-org-id + Authorization are attached consistently
      const res = await authedFetch("/api/invites/create", {
        method: "POST",
        body: JSON.stringify({ emails: cleaned }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send invites");

      setInviteMsg(`✅ Created ${data.created?.length ?? 0} invite(s).`);
    } catch (err: any) {
      setInviteMsg(`❌ ${err.message ?? "Failed to send invites"}`);
    } finally {
      setInviteSending(false);
    }
  }

  if (loading || checkingOrg) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-50">
        <div className="text-center">
          <div className="inline-flex px-6 py-4 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-4 shadow-lg">
            <span className="text-xl font-bold text-white whitespace-nowrap">
              PurposeFramework
            </span>
          </div>
          <p className="text-slate-600">Loading your workspace...</p>
        </div>
      </main>
    );
  }

  const orgName = org?.name ?? "Your organization";
  const avatarText = initialsFromName(orgName);

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-50 via-slate-50 to-primary-50">
      <div className="flex min-h-screen">
        {/* LEFT COLLAPSIBLE ORG PROFILE SIDEBAR */}
        <aside
          className={`bg-gradient-to-br from-primary-600 via-primary-500 to-accent-400 text-white transition-all duration-300 ease-in-out ${
            sidebarCollapsed ? "w-16" : "w-[320px]"
          } relative shadow-xl`}
        >
          {/* Toggle button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-lg hover:shadow-xl transition-all"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              className={`h-4 w-4 text-primary-500 transition-transform duration-300 ${
                sidebarCollapsed ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <div className={`h-full overflow-hidden ${sidebarCollapsed ? "p-3" : "p-6"}`}>
            {!sidebarCollapsed ? (
              <>
                {/* Expanded view */}
                <div className="border-b border-white/20 pb-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-base font-bold backdrop-blur-sm">
                      {avatarText}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold truncate">{orgName}</div>
                      <div className="text-xs text-white/80 truncate">
                        {user?.email ?? "Unknown"}
                      </div>
                    </div>
                  </div>

                  {/* Mission preview */}
                  <div className="rounded-xl bg-white/15 backdrop-blur-sm p-4 border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-2 w-2 rounded-full bg-success-300"></div>
                      <div className="text-xs font-bold text-white/90">Mission</div>
                    </div>
                    <div className="text-sm leading-relaxed">
                      {org?.mission?.trim() ? org.mission : "Not provided yet."}
                    </div>
                  </div>

                  {/* Company info toggle */}
                  <button
                    type="button"
                    className="mt-4 w-full rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-left hover:bg-white/20 transition border border-white/20"
                    onClick={() => setOrgInfoOpen((v) => !v)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-accent-300"></div>
                        <div className="text-sm font-bold">Organization info</div>
                      </div>
                      <div className="text-sm font-bold">{orgInfoOpen ? "−" : "+"}</div>
                    </div>
                  </button>

                  {orgInfoOpen ? (
                    <div className="mt-4 space-y-2 text-sm">
                      <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                        <div className="text-xs font-semibold text-white/80">Home state</div>
                        <div className="mt-1 font-medium">
                          {org?.homeState?.trim() ? org.homeState : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                        <div className="text-xs font-semibold text-white/80">Tax status</div>
                        <div className="mt-1 font-medium">
                          {org?.taxStatus?.trim() ? org.taxStatus : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                        <div className="text-xs font-semibold text-white/80">Fiscal year</div>
                        <div className="mt-1 font-medium">
                          {org?.fiscalYear?.trim() ? org.fiscalYear : "—"}
                        </div>
                      </div>

                      <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                        <div className="text-xs font-semibold text-white/80">CRM</div>
                        <div className="mt-1 font-medium">{org?.crm?.trim() ? org.crm : "—"}</div>
                      </div>

                      <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                        <div className="text-xs font-semibold text-white/80">Address</div>
                        <div className="mt-1 font-medium">
                          {org?.address?.trim() ? org.address : "—"}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                          <div className="text-xs font-semibold text-white/80">Employees</div>
                          <div className="mt-1 font-medium">
                            {typeof org?.numEmployees === "number" ? org.numEmployees : "—"}
                          </div>
                        </div>
                        <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                          <div className="text-xs font-semibold text-white/80">Founded</div>
                          <div className="mt-1 font-medium">
                            {typeof org?.foundedYear === "number" ? org.foundedYear : "—"}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3 border border-white/20">
                        <div className="text-xs font-semibold text-white/80">Website</div>
                        <div className="mt-1 font-medium break-all">
                          {org?.websiteConsent && org?.websiteUrl ? org.websiteUrl : "—"}
                        </div>
                        <div className="mt-2 text-xs text-white/70">
                          {org?.websiteUrl
                            ? org?.websiteConsent
                              ? "✓ Consent granted"
                              : "Consent not granted"
                            : "No website provided"}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Sidebar nav actions */}
                <div className="pt-6 space-y-2">
                  <button
                    type="button"
                    className="w-full rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-left hover:bg-white/20 transition border border-white/20"
                    onClick={() => router.push("/products")}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-2 w-2 rounded-full bg-success-300"></div>
                      <div className="text-sm font-bold">Products</div>
                    </div>
                    <div className="text-xs text-white/80">Create and manage documents</div>
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-left hover:bg-white/20 transition border border-white/20"
                    onClick={openInviteModal}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-2 w-2 rounded-full bg-accent-300"></div>
                      <div className="text-sm font-bold">Invites</div>
                    </div>
                    <div className="text-xs text-white/80">Invite teammates securely</div>
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-left hover:bg-white/20 transition border border-white/20"
                    onClick={() => router.push("/activity")}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-2 w-2 rounded-full bg-purple-400"></div>
                      <div className="text-sm font-bold">Activity</div>
                    </div>
                    <div className="text-xs text-white/80">Recently edited documents</div>
                  </button>

                  <button
                    type="button"
                    className="w-full rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-left hover:bg-white/20 transition border border-white/20"
                    onClick={async () => {
                      await signOut(auth);
                      router.push("/login");
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-2 w-2 rounded-full bg-slate-300"></div>
                      <div className="text-sm font-bold">Sign out</div>
                    </div>
                    <div className="text-xs text-white/80">Log out of this account</div>
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Collapsed view - icons only */}
                <div className="flex flex-col items-center gap-4 pt-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold backdrop-blur-sm">
                    {avatarText}
                  </div>

                  <div className="w-full border-t border-white/20"></div>

                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/20 transition border border-white/20"
                    onClick={() => router.push("/products")}
                    title="Products"
                  >
                    <div className="h-2 w-2 rounded-full bg-success-300"></div>
                  </button>

                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/20 transition border border-white/20"
                    onClick={openInviteModal}
                    title="Invites"
                  >
                    <div className="h-2 w-2 rounded-full bg-accent-300"></div>
                  </button>

                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/20 transition border border-white/20"
                    onClick={() => router.push("/activity")}
                    title="Activity"
                  >
                    <div className="h-2 w-2 rounded-full bg-purple-400"></div>
                  </button>

                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/20 transition border border-white/20"
                    onClick={async () => {
                      await signOut(auth);
                      router.push("/login");
                    }}
                    title="Sign out"
                  >
                    <div className="h-2 w-2 rounded-full bg-slate-300"></div>
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <section className="flex-1 p-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-slate-900">{orgName}</h1>
              <p className="mt-2 text-slate-600">
                Build and manage professional fundraising documents for your organization
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                className="group text-left border-2 border-slate-200 bg-white rounded-2xl p-6 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-100 transition-all"
                onClick={() => router.push("/products")}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-accent-300 to-primary-500"></div>
                  <h2 className="font-bold text-slate-900 text-lg">Create</h2>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Create strategic fundraising documents for your organization
                </p>
                <p className="text-sm font-semibold text-accent-500 mt-4 group-hover:text-primary-500 transition">
                  View Crafters →
                </p>
              </button>

              <button
                type="button"
                className="group text-left border-2 border-slate-200 bg-white rounded-2xl p-6 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-100 transition-all"
                onClick={openInviteModal}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-accent-300 to-primary-500"></div>
                  <h2 className="font-bold text-slate-900 text-lg">Invites</h2>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Invite teammates to join your organization and collaborate securely
                </p>
                <p className="text-sm font-semibold text-accent-500 mt-4 group-hover:text-primary-500 transition">
                  Invite members →
                </p>
              </button>

              <button
                type="button"
                className="group text-left border-2 border-slate-200 bg-white rounded-2xl p-6 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-100 transition-all"
                onClick={() => router.push("/activity")}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-success-300 to-success-400"></div>
                  <h2 className="font-bold text-slate-900 text-lg">Activity</h2>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Recently edited documents and updates across your team
                </p>
                <p className="text-sm text-slate-500 mt-4 italic">{activityNote}</p>
                <p className="text-sm font-semibold text-accent-500 mt-4 group-hover:text-primary-500 transition">
                  View Activity →
                </p>
              </button>
            </div>

            {/* Quick stats or additional content area */}
            <div className="mt-8 rounded-2xl border-2 border-slate-200 bg-white p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-3 w-3 rounded-full bg-gradient-to-r from-purple-400 to-accent-300"></div>
                <h3 className="text-lg font-bold text-slate-900">Getting Started</h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Welcome to PurposeFramework! Start by creating your first fundraising document in Products,
                or invite team members to collaborate on your organization's strategic planning.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Invite Modal */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeInviteModal} />

          <div className="relative w-full max-w-lg rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-accent-300 to-primary-500"></div>
                  <h2 className="text-xl font-bold text-slate-900">Invite team members</h2>
                </div>
                <p className="text-sm text-slate-600">
                  Each invite includes a secure sign-up link and access code
                </p>
              </div>

              <button
                className="border-2 border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition"
                onClick={closeInviteModal}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-900">Email addresses</p>

              {inviteEmails.map((email, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    className="flex-1 border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                    value={email}
                    onChange={(e) => updateEmail(idx, e.target.value)}
                    placeholder="name@example.org"
                    type="email"
                  />
                  {inviteEmails.length > 1 && (
                    <button
                      type="button"
                      className="border-2 border-slate-200 rounded-xl px-3 text-slate-800 hover:bg-slate-50 transition"
                      onClick={() => removeEmail(idx)}
                      aria-label="Remove email"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              {inviteMsg && (
                <div className="rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {inviteMsg}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  className="border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition"
                  onClick={addAnotherEmail}
                  disabled={inviteSending}
                >
                  Add another
                </button>

                <button
                  type="button"
                  className="bg-gradient-to-r from-primary-500 to-accent-400 hover:from-primary-600 hover:to-primary-500 text-white font-semibold rounded-xl px-6 py-2.5 text-sm transition shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 disabled:opacity-60"
                  onClick={handleSendInvites}
                  disabled={!canSendInvites}
                >
                  {inviteSending ? "Sending..." : "Send invites"}
                </button>
              </div>

              <p className="text-xs text-slate-500 pt-2">
                Invites are scoped to your organization and require a one-time access code during signup
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}


