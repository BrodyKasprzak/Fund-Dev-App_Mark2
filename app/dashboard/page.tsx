"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getCountFromServer, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";
import { KnowledgeAssetPanel } from "@/components/workspace/KnowledgeAssetPanel";

type OrgProfile = {
  id: string;
  name: string;
  mission?: string | null;
};

type DocumentSummary = {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type ActivityRow = {
  id: string;
  type: "document";
  label: string;
  title: string;
  when: string | null;
};

type QuickAction = {
  label: string;
  description: string;
  href: string;
  style: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Upload Document",
    description: "Add new files to your organization workspace",
    href: "/documents",
    style:
      "border-primary-200 bg-white text-slate-900 hover:border-primary-300 hover:shadow-primary-100",
  },
  {
    label: "Ask a Question",
    description: "Open grounded org chat over your documents",
    href: "/documents?mode=chat-private",
    style:
      "border-sky-200 bg-white text-slate-900 hover:border-sky-300 hover:shadow-sky-100",
  },
  {
    label: "Create Grant",
    description: "Start from the existing grant strategy flow",
    href: "/products",
    style:
      "border-accent-200 bg-white text-slate-900 hover:border-accent-300 hover:shadow-accent-100",
  },
  {
    label: "Invite Member",
    description: "Invite teammates with secure access codes",
    href: "/dashboard?invite=1",
    style:
      "border-amber-200 bg-white text-slate-900 hover:border-amber-300 hover:shadow-amber-100",
  },
];

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteQueryHandledRef = useRef(false);

  const { user, loading, activeOrgId, orgs, me, authedFetch } = useAuth();

  const [checkingOrg, setCheckingOrg] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [org, setOrg] = useState<OrgProfile | null>(null);

  const [documentsCount, setDocumentsCount] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [teamMembersCount, setTeamMembersCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const canSendInvites = useMemo(() => {
    const cleaned = inviteEmails.map((e) => e.trim()).filter(Boolean);
    return cleaned.length > 0 && !inviteSending;
  }, [inviteEmails, inviteSending]);

  const fallbackOrgName =
    !activeOrgId
      ? "Your organization"
      : orgs.find((orgRow) => orgRow.orgId === activeOrgId)?.name?.trim() ||
        (me?.org?.id === activeOrgId ? me.org?.name?.trim() || "" : "") ||
        "Your organization";

  useEffect(() => {
    let cancelled = false;

    async function loadOrgProfile() {
      if (loading) return;

      if (!user) {
        router.push("/login");
        return;
      }

      if (!activeOrgId) {
        router.push("/org-picker");
        return;
      }

      if (!cancelled) {
        setOrg((prev) => {
          if (prev?.id === activeOrgId) return prev;
          return {
            id: activeOrgId,
            name: fallbackOrgName,
            mission: null,
          };
        });
        setCheckingOrg(false);
      }

      try {
        const orgRef = doc(db, "organizations", activeOrgId);
        const orgSnap = await getDoc(orgRef);
        if (!orgSnap.exists()) {
          router.push("/org-picker");
          return;
        }

        const raw = orgSnap.data() as Record<string, unknown>;
        if (cancelled) return;
        setOrg({
          id: activeOrgId,
          name: String(raw?.name ?? "").trim() || fallbackOrgName,
          mission: typeof raw?.mission === "string" ? raw.mission : null,
        });
      } catch (err) {
        console.error("Dashboard org check error:", err);
      }
    }

    void loadOrgProfile();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, fallbackOrgName, loading, router, user]);

  useEffect(() => {
    async function loadWorkspaceData() {
      if (!user || !activeOrgId) {
        setWorkspaceLoading(false);
        return;
      }

      setWorkspaceLoading(true);

      try {
        const [documentsRes, membersCountSnap] = await Promise.all([
          authedFetch("/api/documents"),
          getCountFromServer(collection(db, "organizations", activeOrgId, "members")),
        ]);

        const documentPayload = await documentsRes.json().catch(() => ({}));
        const documents: DocumentSummary[] = Array.isArray(documentPayload?.documents)
          ? documentPayload.documents
          : [];

        const sortedDocuments = [...documents].sort((a, b) => {
          const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return bTs - aTs;
        });

        setDocumentsCount(sortedDocuments.length);
        setLastUpdatedAt(sortedDocuments[0]?.updatedAt || sortedDocuments[0]?.createdAt || null);

        // TODO(ui-only): Add "answers saved" and "grants created" events when existing UI data is available.
        const documentActivity: ActivityRow[] = sortedDocuments.slice(0, 8).map((d) => ({
          id: d.id,
          type: "document",
          label: "Document uploaded",
          title: d.title || "Untitled document",
          when: d.createdAt || d.updatedAt || null,
        }));
        setActivity(documentActivity);

        setTeamMembersCount(membersCountSnap.data().count);
      } catch {
        setDocumentsCount(null);
        setLastUpdatedAt(null);
        setTeamMembersCount(null);
        setActivity([]);
      } finally {
        setWorkspaceLoading(false);
      }
    }

    void loadWorkspaceData();
  }, [activeOrgId, authedFetch, user]);

  function openInviteModal() {
    setInviteMsg(null);
    setInviteEmails([""]);
    setInviteOpen(true);
  }

  function closeInviteModal() {
    setInviteOpen(false);
  }

  useEffect(() => {
    const shouldOpenInvite = searchParams.get("invite") === "1";
    if (shouldOpenInvite && !inviteQueryHandledRef.current) {
      inviteQueryHandledRef.current = true;
      openInviteModal();
      router.replace("/dashboard");
    }
    if (!shouldOpenInvite) {
      inviteQueryHandledRef.current = false;
    }
  }, [router, searchParams]);

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

      const res = await authedFetch("/api/invites/create", {
        method: "POST",
        body: JSON.stringify({ emails: cleaned }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send invites");

      setInviteMsg(`Created ${data.created?.length ?? 0} invite(s).`);
    } catch (err: unknown) {
      if (err instanceof Error) setInviteMsg(err.message);
      else setInviteMsg("Failed to send invites");
    } finally {
      setInviteSending(false);
    }
  }

  if (loading || checkingOrg) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary-600 to-accent-400 px-6 py-4 shadow-lg">
            <span className="whitespace-nowrap text-xl font-bold text-white">PurposeFramework</span>
          </div>
          <p className="mt-4 text-slate-600">Loading your workspace...</p>
        </div>
      </main>
    );
  }

  if (!user) return null;

  const orgName = org?.name ?? "Your organization";
  const mission = org?.mission?.trim()
    ? org.mission
    : "Add a mission statement during onboarding to strengthen workspace context.";

  return (
    <main className="min-h-screen overflow-y-auto p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                PurposeFramework Workspace
              </p>
              <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
                {orgName}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                {mission}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documents</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {typeof documentsCount === "number" ? documentsCount : "--"}
              </p>
            </article>
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last updated</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{formatDateTime(lastUpdatedAt)}</p>
            </article>
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team members</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {typeof teamMembersCount === "number" ? teamMembersCount : "--"}
              </p>
            </article>
          </div>
          {workspaceLoading ? (
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">
              Updating workspace metrics...
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Quick Actions</h2>
            <p className="text-xs text-slate-500">Fast paths into your core org workflows</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => router.push(action.href)}
                className={`rounded-xl border p-4 text-left shadow-sm transition hover:shadow-md ${action.style}`}
              >
                <p className="text-sm font-semibold">{action.label}</p>
                <p className="mt-1 text-xs text-slate-600">{action.description}</p>
              </button>
            ))}
          </div>
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
              <button
                type="button"
                onClick={() => router.push("/activity")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Open full activity
              </button>
            </div>

            {activity.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {activity.map((item) => (
                  <li key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                        <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                      </div>
                      <p className="text-xs text-slate-500">{formatDateTime(item.when)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                <p className="text-sm text-slate-600">
                  {workspaceLoading
                    ? "Loading recent activity..."
                    : "Recent activity will appear here as your team uploads documents, saves answers, and creates grants."}
                </p>
              </div>
            )}
          </section>

          <KnowledgeAssetPanel className="xl:sticky xl:top-6" />
        </div>
      </div>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeInviteModal} />

          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-accent-300 to-primary-500" />
                  <h2 className="text-xl font-semibold text-slate-900">Invite team members</h2>
                </div>
                <p className="text-sm text-slate-600">
                  Each invite includes a secure sign-up link and access code.
                </p>
              </div>

              <button
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
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
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={email}
                    onChange={(e) => updateEmail(idx, e.target.value)}
                    placeholder="name@example.org"
                    type="email"
                  />
                  {inviteEmails.length > 1 ? (
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 px-3 text-slate-800 transition hover:bg-slate-50"
                      onClick={() => removeEmail(idx)}
                      aria-label="Remove email"
                    >
                      x
                    </button>
                  ) : null}
                </div>
              ))}

              {inviteMsg ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {inviteMsg}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                  onClick={addAnotherEmail}
                  disabled={inviteSending}
                >
                  Add another
                </button>

                <button
                  type="button"
                  className="rounded-xl bg-gradient-to-r from-primary-600 to-accent-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition hover:from-primary-700 hover:to-primary-600 hover:shadow-primary-500/40 disabled:opacity-60"
                  onClick={handleSendInvites}
                  disabled={!canSendInvites}
                >
                  {inviteSending ? "Sending..." : "Send invites"}
                </button>
              </div>

              <p className="pt-2 text-xs text-slate-500">
                Invites are scoped to your organization and require a one-time access code during signup.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
