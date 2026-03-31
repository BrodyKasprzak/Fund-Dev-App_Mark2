"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getCountFromServer, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

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
  size: number | null;
};

type ActivityRow = {
  id: string;
  type: "document";
  label: string;
  title: string;
  when: string | null;
  changeSummary: string | null;
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
      "border-slate-200 bg-white text-slate-900 hover:border-primary-300",
  },
  {
    label: "Ask a Question",
    description: "Open grounded org chat over your documents",
    href: "/chat",
    style:
      "border-slate-200 bg-white text-slate-900 hover:border-success-300",
  },
  {
    label: "Create Grant",
    description: "Start from the existing grant strategy flow",
    href: "/products",
    style:
      "border-slate-200 bg-white text-slate-900 hover:border-accent-300",
  },
  {
    label: "Invite Member",
    description: "Invite teammates with secure access codes",
    href: "/dashboard?invite=1",
    style:
      "border-slate-200 bg-white text-slate-900 hover:border-slate-300",
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

function formatStorage(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIndex]}`;
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
  const [usageDocs, setUsageDocs] = useState<DocumentSummary[]>([]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);

  const canSendInvites = useMemo(() => {
    const cleaned = inviteEmails.map((e) => e.trim()).filter(Boolean);
    return cleaned.length > 0 && !inviteSending;
  }, [inviteEmails, inviteSending]);

  const usageTotals = useMemo(() => {
    const docTotal = usageDocs.length;
    const bytesTotal = usageDocs.reduce((sum, docRow) => {
      const size = typeof docRow.size === "number" && Number.isFinite(docRow.size) ? docRow.size : 0;
      return sum + Math.max(0, size);
    }, 0);
    return { docTotal, bytesTotal };
  }, [usageDocs]);

  const usageBuckets = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }).map((_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      return {
        key,
        label: d.toLocaleDateString(undefined, { month: "short" }),
        docs: 0,
        bytes: 0,
      };
    });

    const monthIndex = new Map(months.map((m, idx) => [m.key, idx] as const));
    for (const docRow of usageDocs) {
      const refDateRaw = docRow.createdAt || docRow.updatedAt || null;
      if (!refDateRaw) continue;
      const refDate = new Date(refDateRaw);
      if (Number.isNaN(refDate.getTime())) continue;
      const key = `${refDate.getFullYear()}-${refDate.getMonth()}`;
      const idx = monthIndex.get(key);
      if (idx === undefined) continue;
      months[idx].docs += 1;
      const size = typeof docRow.size === "number" && Number.isFinite(docRow.size) ? docRow.size : 0;
      months[idx].bytes += Math.max(0, size);
    }

    const maxDocs = Math.max(1, ...months.map((m) => m.docs));
    const maxBytes = Math.max(1, ...months.map((m) => m.bytes));

    return { months, maxDocs, maxBytes };
  }, [usageDocs]);

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
        const [documentsRes, activityRes, membersCountSnap] = await Promise.all([
          authedFetch("/api/documents"),
          authedFetch("/api/activity/recent?limit=20"),
          getCountFromServer(collection(db, "organizations", activeOrgId, "members")),
        ]);

        const documentPayload = await documentsRes.json().catch(() => ({}));
        const activityPayload = await activityRes.json().catch(() => ({}));
        const rawDocuments: unknown[] = Array.isArray(documentPayload?.documents) ? documentPayload.documents : [];
        const documents: DocumentSummary[] = rawDocuments
          .map((item) => {
            if (typeof item !== "object" || item === null) return null;
            const rec = item as Record<string, unknown>;
            if (typeof rec.id !== "string") return null;
            return {
              id: rec.id,
              title: typeof rec.title === "string" ? rec.title : "Untitled document",
              createdAt: typeof rec.createdAt === "string" ? rec.createdAt : null,
              updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : null,
              size: typeof rec.size === "number" ? rec.size : null,
            } satisfies DocumentSummary;
          })
          .filter((docRow): docRow is DocumentSummary => Boolean(docRow));

        const sortedDocuments = [...documents].sort((a, b) => {
          const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return bTs - aTs;
        });

        setUsageDocs(sortedDocuments);
        setDocumentsCount(sortedDocuments.length);
        setLastUpdatedAt(sortedDocuments[0]?.updatedAt || sortedDocuments[0]?.createdAt || null);

        const activityRows = Array.isArray(activityPayload?.items)
          ? (activityPayload.items as Array<Record<string, unknown>>)
              .map((item) => {
                const id = typeof item.id === "string" ? item.id : null;
                if (!id) return null;
                return {
                  id,
                  type: "document" as const,
                  label:
                    typeof item.label === "string" && item.label.trim()
                      ? item.label
                      : "Document activity",
                  title:
                    typeof item.docTitle === "string" && item.docTitle.trim()
                      ? item.docTitle
                      : "Untitled document",
                  when: typeof item.when === "string" ? item.when : null,
                  changeSummary:
                    typeof item.changeSummary === "string" && item.changeSummary.trim()
                      ? item.changeSummary
                      : null,
                } as ActivityRow;
              })
              .filter((row): row is ActivityRow => row !== null)
              .slice(0, 8)
          : ([] as ActivityRow[]);

        if (activityRows.length > 0) {
          setActivity(activityRows);
        } else {
          const fallbackActivity: ActivityRow[] = sortedDocuments.slice(0, 8).map((d) => ({
            id: d.id,
            type: "document",
            label: "Document uploaded",
            title: d.title || "Untitled document",
            when: d.createdAt || d.updatedAt || null,
            changeSummary: null,
          }));
          setActivity(fallbackActivity);
        }

        setTeamMembersCount(membersCountSnap.data().count);
      } catch {
        setDocumentsCount(null);
        setLastUpdatedAt(null);
        setTeamMembersCount(null);
        setActivity([]);
        setUsageDocs([]);
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

  useEffect(() => {
    if (!inviteOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInviteOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inviteOpen]);

  useEffect(() => {
    if (!usageOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUsageOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [usageOpen]);

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
        <div className="auth-card text-center px-8 py-7">
          <span className="auth-brand-chip">PurposeFramework</span>
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
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">
                Workspace Overview
              </p>
              <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
                {orgName}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                {mission}
              </p>
            </div>

            <div className="w-full max-w-xs border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Workspace Status
              </p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {workspaceLoading ? "Updating metrics..." : "Metrics current"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 border-t border-slate-200 pt-5 sm:grid-cols-3">
            <article className="border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Documents</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                {typeof documentsCount === "number" ? documentsCount : "--"}
              </p>
            </article>
            <article className="border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last Updated</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">{formatDateTime(lastUpdatedAt)}</p>
            </article>
            <article className="border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Team Members</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                {typeof teamMembersCount === "number" ? teamMembersCount : "--"}
              </p>
            </article>
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Quick Actions</h2>
            <p className="text-xs text-slate-500">Fast paths into your core org workflows</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action, idx) => (
              <button
                key={action.label}
                type="button"
                onClick={() => router.push(action.href)}
                className={`border p-4 text-left shadow-sm transition hover:shadow-md ${action.style}`}
              >
                <div
                  className={`mb-3 h-[2px] w-10 ${
                    idx === 0
                      ? "bg-primary-400"
                      : idx === 1
                        ? "bg-success-400"
                        : idx === 2
                          ? "bg-accent-400"
                          : "bg-slate-400"
                  }`}
                />
                <p className="text-sm font-semibold">{action.label}</p>
                <p className="mt-1 text-xs text-slate-600">{action.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
            <button type="button" onClick={() => setUsageOpen(true)} className="btn-secondary px-3 py-1.5 text-xs">
              View usage
            </button>
          </div>

          {activity.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {activity.map((item) => (
                <li key={item.id} className="border border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                      <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                      {item.changeSummary ? (
                        <p className="truncate text-xs text-slate-500">{item.changeSummary}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">{formatDateTime(item.when)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm text-slate-600">
                {workspaceLoading
                  ? "Loading recent activity..."
                  : "Recent activity will appear here as your team uploads documents, saves answers, and creates grants."}
              </p>
            </div>
          )}
        </section>
      </div>

      {usageOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={() => setUsageOpen(false)} />
          <section className="auth-card relative w-full max-w-3xl p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Workspace Usage</p>
                <h3 className="mt-1 text-2xl font-semibold text-slate-900">Document Storage Overview</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Total documents uploaded and storage usage across the last 6 months.
                </p>
              </div>
              <button type="button" onClick={() => setUsageOpen(false)} className="btn-secondary px-3 py-1.5 text-sm">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <article className="border border-slate-200 bg-slate-50/80 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Documents Uploaded</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{usageTotals.docTotal}</p>
              </article>
              <article className="border border-slate-200 bg-slate-50/80 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Data Stored</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{formatStorage(usageTotals.bytesTotal)}</p>
              </article>
            </div>

            <div className="mt-6 border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
                <span className="inline-flex items-center gap-2 text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 bg-slate-700" />
                  Documents uploaded
                </span>
                <span className="inline-flex items-center gap-2 text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 bg-primary-500" />
                  Data stored
                </span>
              </div>

              <div className="grid h-48 grid-cols-6 items-end gap-3">
                {usageBuckets.months.map((bucket) => {
                  const docHeight = Math.round((bucket.docs / usageBuckets.maxDocs) * 100);
                  const bytesHeight = Math.round((bucket.bytes / usageBuckets.maxBytes) * 100);
                  const safeDocHeight = bucket.docs > 0 ? Math.max(10, docHeight) : 0;
                  const safeBytesHeight = bucket.bytes > 0 ? Math.max(10, bytesHeight) : 0;

                  return (
                    <div key={bucket.key} className="flex h-full flex-col items-center justify-end gap-2">
                      <div className="flex h-full items-end gap-1">
                        <div
                          className="w-3 bg-slate-700"
                          style={{ height: `${safeDocHeight}%` }}
                          title={`${bucket.label}: ${bucket.docs} documents`}
                        />
                        <div
                          className="w-3 bg-primary-500"
                          style={{ height: `${safeBytesHeight}%` }}
                          title={`${bucket.label}: ${formatStorage(bucket.bytes)}`}
                        />
                      </div>
                      <div className="text-[11px] font-medium text-slate-500">{bucket.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={closeInviteModal} />

          <div className="auth-card relative w-full max-w-lg p-8">
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
                className="btn-secondary px-3 py-1.5 text-sm"
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
                    className="field-input flex-1 text-sm"
                    value={email}
                    onChange={(e) => updateEmail(idx, e.target.value)}
                    placeholder="name@example.org"
                    type="email"
                  />
                  {inviteEmails.length > 1 ? (
                    <button
                      type="button"
                      className="btn-secondary px-3"
                      onClick={() => removeEmail(idx)}
                      aria-label="Remove email"
                    >
                      x
                    </button>
                  ) : null}
                </div>
              ))}

              {inviteMsg ? (
                <div className="status-box" role="status" aria-live="polite">
                  {inviteMsg}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  className="btn-secondary px-4 py-2.5 text-sm"
                  onClick={addAnotherEmail}
                  disabled={inviteSending}
                >
                  Add another
                </button>

                <button
                  type="button"
                  className="btn-primary px-6 py-2.5 text-sm"
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

