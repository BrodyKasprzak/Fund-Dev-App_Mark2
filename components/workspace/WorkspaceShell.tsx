"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebaseClient";

const WORKSPACE_ROUTE_PREFIXES = [
  "/dashboard",
  "/documents",
  "/products",
  "/activity",
  "/members",
  "/fund-development",
  "/handbook",
  "/plans",
];

function isWorkspaceRoute(pathname: string) {
  return WORKSPACE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function pageTitleFromPath(pathname: string) {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "Workspace Overview";
  if (pathname === "/documents" || pathname.startsWith("/documents/")) return "Document Workspace";
  if (pathname === "/products" || pathname.startsWith("/products/")) return "Strategic Builders";
  if (pathname === "/activity" || pathname.startsWith("/activity/")) return "Activity";
  if (pathname === "/members" || pathname.startsWith("/members/")) return "Team Members";
  if (pathname === "/fund-development" || pathname.startsWith("/fund-development/")) {
    return "Fund Development";
  }
  if (pathname === "/handbook" || pathname.startsWith("/handbook/")) return "Handbook Builder";
  if (pathname === "/plans" || pathname.startsWith("/plans/")) return "Plans";
  return "Workspace";
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, meLoading, orgs, activeOrgId, setActiveOrgId, authedFetch } = useAuth();
  const workspaceRoute = Boolean(pathname && isWorkspaceRoute(pathname));
  const isDashboardRoute = Boolean(pathname && (pathname === "/dashboard" || pathname.startsWith("/dashboard/")));
  const pageTitle = useMemo(() => pageTitleFromPath(pathname ?? ""), [pathname]);
  const inviteQueryHandledRef = useRef(false);

  const [headerOrgName, setHeaderOrgName] = useState("Your organization");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const fallbackOrgName = useMemo(() => {
    if (!activeOrgId) return "Your organization";
    return orgs.find((org) => org.orgId === activeOrgId)?.name?.trim() || "Your organization";
  }, [activeOrgId, orgs]);

  useEffect(() => {
    if (!pathname || !workspaceRoute) return;
    if (loading || meLoading) return;

    const query = searchParams.toString();
    const here = query ? `${pathname}?${query}` : pathname;

    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }

    if (orgs.length > 1 && !activeOrgId) {
      router.replace(`/org-picker?next=${encodeURIComponent(here)}`);
      return;
    }

    if (orgs.length === 1 && !activeOrgId) {
      setActiveOrgId(orgs[0].orgId);
      return;
    }

    if (activeOrgId && orgs.length > 0 && !orgs.some((org) => org.orgId === activeOrgId)) {
      setActiveOrgId(null);
      router.replace(`/org-picker?next=${encodeURIComponent(here)}`);
      return;
    }

    if (orgs.length === 0 && !activeOrgId) {
      router.replace("/org-picker");
      return;
    }
  }, [activeOrgId, loading, meLoading, orgs, pathname, router, searchParams, setActiveOrgId, user, workspaceRoute]);

  useEffect(() => {
    let cancelled = false;

    async function loadHeaderOrgName() {
      if (!activeOrgId) {
        if (!cancelled) setHeaderOrgName("Your organization");
        return;
      }

      if (!cancelled) setHeaderOrgName(fallbackOrgName);

      try {
        const orgRef = doc(db, "organizations", activeOrgId);
        const orgSnap = await getDoc(orgRef);
        if (!orgSnap.exists()) return;

        const raw = orgSnap.data() as Record<string, unknown>;
        const name = typeof raw?.name === "string" ? raw.name.trim() : "";
        if (!cancelled && name) setHeaderOrgName(name);
      } catch {
        if (!cancelled) setHeaderOrgName(fallbackOrgName);
      }
    }

    void loadHeaderOrgName();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, fallbackOrgName]);

  useEffect(() => {
    if (!pathname) return;
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return;
    const shouldOpenInvite = searchParams.get("invite") === "1";
    if (shouldOpenInvite && !inviteQueryHandledRef.current) {
      inviteQueryHandledRef.current = true;
      openInviteModal();

      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("invite");
      const next = nextParams.toString();
      router.replace(next ? `${pathname}?${next}` : pathname);
    }
    if (!shouldOpenInvite) {
      inviteQueryHandledRef.current = false;
    }
  }, [pathname, router, searchParams]);

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

  if (!pathname || !workspaceRoute) {
    return <>{children}</>;
  }

  if (
    loading ||
    meLoading ||
    !user ||
    !activeOrgId
  ) {
    return (
      <main className="workspace-shell min-h-screen flex items-center justify-center">
        <div className="rounded-2xl border border-slate-300 bg-white/95 px-6 py-4 shadow-sm">
          <p className="text-sm font-medium text-slate-700">Loading workspace...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="workspace-shell min-h-screen">
      <div className="flex min-h-screen">
        <WorkspaceSidebar onInviteClick={openInviteModal} />
        <section className="workspace-main min-w-0 flex-1 overflow-y-auto">
          <div
            className={`workspace-brand-strip border-b border-slate-300/80 bg-white/75 px-5 backdrop-blur md:px-7 ${
              isDashboardRoute ? "py-3" : "py-1.5"
            }`}
          >
            <p
              className={`font-semibold uppercase tracking-[0.16em] text-primary-700 ${
                isDashboardRoute ? "text-[11px]" : "text-[10px]"
              }`}
            >
              PurposeFramework
            </p>
            <p
              className={`font-medium text-slate-600 ${
                isDashboardRoute ? "mt-0.5 text-xs" : "mt-0 text-[11px]"
              }`}
            >
              {headerOrgName}
            </p>
            <h1
              className={`workspace-page-title font-semibold tracking-tight ${
                isDashboardRoute ? "mt-1 text-2xl md:text-3xl" : "mt-0 text-sm md:text-base"
              }`}
            >
              {pageTitle}
            </h1>
          </div>

          <div className="workspace-page">{children}</div>
        </section>
      </div>

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeInviteModal} />

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
                  disabled={inviteSending || inviteEmails.every((e) => !e.trim())}
                >
                  {inviteSending ? "Sending..." : "Send invites"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
