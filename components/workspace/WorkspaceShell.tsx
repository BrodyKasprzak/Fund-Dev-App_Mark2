"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { signOut } from "firebase/auth";
import { useAuth } from "@/lib/AuthContext";
import { auth } from "@/lib/firebaseClient";

const WORKSPACE_ROUTE_PREFIXES = [
  "/dashboard",
  "/documents",
  "/chat",
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

type TopNavItem = {
  href: string;
  label: string;
  shortLabel: string;
  matchPathPrefix: string;
  icon: (className?: string) => ReactNode;
};

const TOP_NAV_ITEMS: TopNavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    shortLabel: "Home",
    matchPathPrefix: "/dashboard",
    icon: (className = "h-4 w-4") => (
      <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
        <path
          d="M3.75 8.75 10 3.75l6.25 5v7a.5.5 0 0 1-.5.5h-3.5a.5.5 0 0 1-.5-.5v-3.5h-3.5v3.5a.5.5 0 0 1-.5.5h-3.5a.5.5 0 0 1-.5-.5v-7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/documents",
    label: "Documents",
    shortLabel: "Docs",
    matchPathPrefix: "/documents",
    icon: (className = "h-4 w-4") => (
      <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
        <path
          d="M6 3.5h5l3 3v10H6v-13Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M11 3.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Ask AI",
    shortLabel: "Ask",
    matchPathPrefix: "/chat",
    icon: (className = "h-4 w-4") => (
      <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
        <path
          d="M4 4.5h12v8H9l-3.5 3v-3H4v-8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/products",
    label: "Create",
    shortLabel: "Create",
    matchPathPrefix: "/products",
    icon: (className = "h-4 w-4") => (
      <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
        <path
          d="M10 3.75 4.75 6.5v7L10 16.25l5.25-2.75v-7L10 3.75Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M10 9v7.25M4.75 6.5 10 9l5.25-2.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    shortLabel: "Activity",
    matchPathPrefix: "/activity",
    icon: (className = "h-4 w-4") => (
      <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
        <path
          d="M3.5 10h3l1.5-3 2.5 6 2-4h3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/members",
    label: "Members",
    shortLabel: "Members",
    matchPathPrefix: "/members",
    icon: (className = "h-4 w-4") => (
      <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
        <path
          d="M13.75 15.5a3.75 3.75 0 1 0-7.5 0M12.25 7a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0ZM15.5 14.75a2.75 2.75 0 0 0-2.39-2.73M14.25 7.75a2 2 0 1 0 0-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, meLoading, orgs, me, activeOrgId, setActiveOrgId, authedFetch } = useAuth();
  const workspaceRoute = Boolean(pathname && isWorkspaceRoute(pathname));
  const signedInIdentity = useMemo(() => {
    const signedInEmail = user?.email ?? "Unknown";
    const signedInName = typeof me?.name === "string" ? me.name.trim() : "";
    if (signedInName && signedInName.toLowerCase() !== signedInEmail.toLowerCase()) {
      return `${signedInName} (${signedInEmail})`;
    }
    return signedInName || signedInEmail;
  }, [me?.name, user?.email]);
  const inviteQueryHandledRef = useRef(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mutedAccent, setMutedAccent] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);

  const headerOrgName =
    !activeOrgId
      ? "Your organization"
      : orgs.find((org) => org.orgId === activeOrgId)?.name?.trim() ||
        (me?.org?.id === activeOrgId ? me.org?.name?.trim() || "" : "") ||
        "Your organization";

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

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("workspace-compact", compactNav);
    root.classList.toggle("workspace-reduced-motion", reducedMotion);
    root.classList.toggle("workspace-muted", mutedAccent);

    return () => {
      root.classList.remove("workspace-compact");
      root.classList.remove("workspace-reduced-motion");
      root.classList.remove("workspace-muted");
    };
  }, [compactNav, reducedMotion, mutedAccent]);

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

  function closeSettingsPanel() {
    setSettingsOpen(false);
  }

  async function handleConfirmLogout() {
    setLogoutPending(true);
    try {
      await signOut(auth);
      setLogoutConfirmOpen(false);
      window.location.replace("/");
    } finally {
      setLogoutPending(false);
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
        <div className="auth-card px-6 py-4">
          <p className="text-sm font-medium text-slate-700">Loading workspace...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="workspace-shell min-h-screen">
      <section className="workspace-main min-w-0 overflow-visible">
        <div
          className="workspace-brand-strip sticky top-0 z-50 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm md:px-6"
        >
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
            <div className="flex items-center">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 overflow-hidden rounded border border-slate-200 bg-white">
                  <Image
                    src="/favicon.ico?v=20260325"
                    alt="PurposeFramework logo"
                    width={32}
                    height={32}
                    unoptimized
                    priority
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold tracking-tight text-slate-900">
                    {headerOrgName}
                  </p>
                  <p className="truncate text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                    Organization
                  </p>
                </div>
              </div>
            </div>

            <nav className="flex items-center justify-center" aria-label="Workspace">
              <ul className="flex items-center gap-1.5">
                {TOP_NAV_ITEMS.map((item) => {
                  const isActive =
                    pathname === item.matchPathPrefix ||
                    pathname?.startsWith(`${item.matchPathPrefix}/`);
                  return (
                    <li key={item.href}>
                      <button
                        type="button"
                        onClick={() => router.push(item.href)}
                        aria-current={isActive ? "page" : undefined}
                        className={`group relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                          isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm"
                            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                        }`}
                      >
                        <span className={isActive ? "text-emerald-700" : "text-slate-600"}>
                          {item.icon("h-3.5 w-3.5")}
                        </span>
                        <span className="hidden md:inline">{item.shortLabel}</span>
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm font-semibold tracking-tight whitespace-nowrap text-slate-900 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="flex min-w-0 flex-col items-end gap-1">
              <div className="max-w-[300px] truncate text-[11px] font-semibold text-emerald-700">
                {signedInIdentity}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={openInviteModal}
                  className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-800"
                >
                  Invite
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => setLogoutConfirmOpen(true)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="workspace-page">{children}</div>
      </section>

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={closeInviteModal} />

          <div className="auth-card relative w-full max-w-lg p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-accent-300 to-primary-500" />
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
                      className="btn-secondary px-3 text-slate-800"
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
                  disabled={inviteSending || inviteEmails.every((e) => !e.trim())}
                >
                  {inviteSending ? "Sending..." : "Send invites"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={closeSettingsPanel} />

          <div className="auth-card relative w-full max-w-lg p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-sky-300 to-primary-500" />
                  <h2 className="text-xl font-semibold text-slate-900">Workspace settings</h2>
                </div>
                <p className="text-sm text-slate-600">Customize workspace appearance and motion.</p>
              </div>

              <button
                className="btn-secondary px-3 py-1.5 text-sm"
                onClick={closeSettingsPanel}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
                Compact navigation density
                <input
                  type="checkbox"
                  checked={compactNav}
                  onChange={(event) => setCompactNav(event.target.checked)}
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
                Reduce motion
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(event) => setReducedMotion(event.target.checked)}
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
                Muted accent style
                <input
                  type="checkbox"
                  checked={mutedAccent}
                  onChange={(event) => setMutedAccent(event.target.checked)}
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Active org</p>
                <p className="mt-1">{headerOrgName}</p>
                <p className="mt-3 font-semibold text-slate-900">Org ID</p>
                <p className="mt-1 break-all">{activeOrgId}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {logoutConfirmOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            aria-label="Close logout confirmation"
            onClick={() => {
              if (!logoutPending) setLogoutConfirmOpen(false);
            }}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-slate-900 shadow-2xl">
            <h3 className="text-xl font-semibold">Are you sure you want to log out?</h3>
            <p className="mt-2 text-sm text-slate-600">
              You will be signed out and returned to the main page.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                disabled={logoutPending}
                className="btn-secondary px-4 py-2 text-sm disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmLogout()}
                disabled={logoutPending}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
              >
                {logoutPending ? "Logging out..." : "Yes - log out"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

