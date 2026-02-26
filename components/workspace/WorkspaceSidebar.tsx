"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

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

type NavItem = {
  href: string;
  label: string;
  description: string;
  indicatorClass: string;
  matchPathPrefix: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    description: "Workspace overview and actions",
    indicatorClass: "bg-success-300",
    matchPathPrefix: "/dashboard",
  },
  {
    href: "/documents",
    label: "Documents",
    description: "Upload, organize, and search files",
    indicatorClass: "bg-white/80",
    matchPathPrefix: "/documents",
  },
  {
    href: "/documents?mode=chat",
    label: "Ask",
    description: "Grounded chat over org documents",
    indicatorClass: "bg-accent-300",
    matchPathPrefix: "/documents",
  },
  {
    href: "/products",
    label: "Create",
    description: "Create strategic grant documents",
    indicatorClass: "bg-indigo-300",
    matchPathPrefix: "/products",
  },
  {
    href: "/activity",
    label: "Activity",
    description: "Recent edits and document states",
    indicatorClass: "bg-purple-300",
    matchPathPrefix: "/activity",
  },
  {
    href: "/members",
    label: "Members",
    description: "View organization members and join dates",
    indicatorClass: "bg-emerald-300",
    matchPathPrefix: "/members",
  },
];

function initialsFromName(name?: string) {
  const n = String(name ?? "").trim();
  if (!n) return "O";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "O";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

export function WorkspaceSidebar({ onInviteClick }: { onInviteClick?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, activeOrgId, me } = useAuth();

  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [orgInfoOpen, setOrgInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const [compactNav, setCompactNav] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mutedAccent, setMutedAccent] = useState(false);
  const [showActiveOrg, setShowActiveOrg] = useState(false);

  const orgName = org?.name ?? "Your organization";
  const mission = org?.mission?.trim() ? org.mission : null;
  const avatarText = initialsFromName(orgName);
  const signedInEmail = user?.email ?? "Unknown";
  const signedInName = typeof me?.name === "string" ? me.name.trim() : "";
  const signedInIdentity =
    signedInName && signedInName.toLowerCase() !== signedInEmail.toLowerCase()
      ? `${signedInName} (${signedInEmail})`
      : signedInName || signedInEmail;

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
    for (const item of NAV_ITEMS) {
      router.prefetch(item.href);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function loadOrgForSidebar() {
      if (loading || !user || !activeOrgId) {
        if (!cancelled) setOrg(null);
        return;
      }

      try {
        const orgRef = doc(db, "organizations", activeOrgId);
        const orgSnap = await getDoc(orgRef);
        if (!orgSnap.exists()) {
          if (!cancelled) setOrg(null);
          return;
        }

        const raw = orgSnap.data() as Record<string, unknown>;

        if (cancelled) return;
        setOrg({
          id: activeOrgId,
          name: String(raw?.name ?? "").trim() || "Your organization",
          mission: typeof raw?.mission === "string" ? raw.mission : null,
          homeState: typeof raw?.homeState === "string" ? raw.homeState : null,
          taxStatus: typeof raw?.taxStatus === "string" ? raw.taxStatus : null,
          fiscalYear: typeof raw?.fiscalYear === "string" ? raw.fiscalYear : null,
          crm: typeof raw?.crm === "string" ? raw.crm : null,
          address: typeof raw?.address === "string" ? raw.address : null,
          numEmployees: typeof raw?.numEmployees === "number" ? raw.numEmployees : null,
          foundedYear: typeof raw?.foundedYear === "number" ? raw.foundedYear : null,
          websiteUrl: typeof raw?.websiteUrl === "string" ? raw.websiteUrl : null,
          websiteConsent: typeof raw?.websiteConsent === "boolean" ? raw.websiteConsent : null,
        });
      } catch {
        if (!cancelled) setOrg(null);
      }
    }

    void loadOrgForSidebar();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, loading, user]);

  const navPad = compactNav ? "px-3.5 py-1.5" : "px-4 py-2";
  const navDesc = compactNav ? "mt-0 text-[10px] leading-tight" : "mt-0.5 text-[11px] leading-tight";

  return (
    <aside
      className={`relative sticky top-0 self-start h-screen flex-shrink-0 border-r border-white/20 bg-gradient-to-br from-primary-800 via-primary-700 to-accent-600 text-white shadow-xl transition-all duration-300 ${
        collapsed ? "w-16" : "w-[312px]"
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="absolute -right-3 top-6 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-indigo-300/40 bg-indigo-950/50 shadow-[0_8px_20px_rgba(49,46,129,0.35)] backdrop-blur-md transition hover:bg-indigo-900/65 hover:shadow-[0_10px_24px_rgba(49,46,129,0.45)]"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg
          className={`h-4 w-4 text-indigo-100/95 transition-transform ${collapsed ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className={`h-full overflow-hidden ${collapsed ? "p-3" : "p-5"}`}>
        {!collapsed ? (
          <>
            <div className="border-b border-white/20 pb-5">
              <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/12 px-4 py-3 backdrop-blur-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/15 text-sm font-bold backdrop-blur-sm">
                  {avatarText}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-white">{orgName}</p>
                  <p className="truncate text-xs text-white/85">{signedInIdentity}</p>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/20 bg-white/12 p-4 backdrop-blur-sm">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success-300" />
                  <div className="text-xs font-semibold text-white/90">Mission</div>
                </div>
                <p className="text-sm leading-relaxed text-white/95">{mission ?? "Not provided yet."}</p>
              </div>

              <button
                type="button"
                className="mt-3 w-full rounded-xl border border-white/20 bg-white/12 px-4 py-2 text-left backdrop-blur-sm transition hover:bg-white/18"
                onClick={() => setOrgInfoOpen((v) => !v)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-accent-300" />
                    <div className="text-sm font-semibold">Organization info</div>
                  </div>
                  <div className="text-sm font-semibold">{orgInfoOpen ? "-" : "+"}</div>
                </div>
              </button>

              {orgInfoOpen ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="rounded-xl border border-white/15 bg-white/8 p-3 backdrop-blur-sm">
                    <div className="text-xs font-semibold text-white/80">Home state</div>
                    <div className="mt-1 font-medium">{org?.homeState?.trim() ? org.homeState : "--"}</div>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-3 backdrop-blur-sm">
                    <div className="text-xs font-semibold text-white/80">Tax status</div>
                    <div className="mt-1 font-medium">{org?.taxStatus?.trim() ? org.taxStatus : "--"}</div>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-3 backdrop-blur-sm">
                    <div className="text-xs font-semibold text-white/80">Fiscal year</div>
                    <div className="mt-1 font-medium">{org?.fiscalYear?.trim() ? org.fiscalYear : "--"}</div>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-3 backdrop-blur-sm">
                    <div className="text-xs font-semibold text-white/80">CRM</div>
                    <div className="mt-1 font-medium">{org?.crm?.trim() ? org.crm : "--"}</div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 pt-5">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.matchPathPrefix || pathname.startsWith(`${item.matchPathPrefix}/`);

                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => router.push(item.href)}
                    className={`w-full rounded-xl border ${navPad} text-left backdrop-blur-sm transition ${
                      isActive
                        ? "border-white/35 bg-white/20"
                        : "border-white/20 bg-white/12 hover:bg-white/18"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${item.indicatorClass}`} />
                      <div className="text-[13px] font-semibold">{item.label}</div>
                    </div>
                    <div className={`${navDesc} text-white/80`}>{item.description}</div>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  if (onInviteClick) onInviteClick();
                  else router.push("/dashboard?invite=1");
                }}
                className={`w-full rounded-xl border border-white/20 bg-white/12 ${navPad} text-left backdrop-blur-sm transition hover:bg-white/18`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-300" />
                  <div className="text-[13px] font-semibold">Invite Member</div>
                </div>
                <div className={`${navDesc} text-white/80`}>Invite teammates to this organization</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setSettingsOpen((v) => {
                    const next = !v;
                    if (!next) setShowActiveOrg(false);
                    return next;
                  })
                }
                className={`w-full rounded-xl border border-white/20 bg-white/12 ${navPad} text-left backdrop-blur-sm transition hover:bg-white/18`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-sky-300" />
                  <div className="text-[13px] font-semibold">Settings</div>
                </div>
                <div className={`${navDesc} text-white/80`}>
                  {settingsOpen ? "Close settings panel" : "Open quick workspace controls"}
                </div>
              </button>

              {settingsOpen ? (
                <div className="space-y-2 rounded-xl border border-white/20 bg-white/12 p-3 backdrop-blur-sm">
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white/90">
                    Compact nav density
                    <input
                      type="checkbox"
                      checked={compactNav}
                      onChange={(e) => setCompactNav(e.target.checked)}
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white/90">
                    Reduce motion
                    <input
                      type="checkbox"
                      checked={reducedMotion}
                      onChange={(e) => setReducedMotion(e.target.checked)}
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white/90">
                    Muted accent style
                    <input
                      type="checkbox"
                      checked={mutedAccent}
                      onChange={(e) => setMutedAccent(e.target.checked)}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowActiveOrg((v) => !v)}
                    className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-left text-xs font-semibold text-white/90 transition hover:bg-white/18"
                  >
                    View active org
                  </button>

                  {showActiveOrg ? (
                    <div className="rounded-lg border border-white/15 bg-white/8 px-3 py-2 text-xs text-white/85">
                      <p className="font-semibold text-white">Active org name</p>
                      <p className="mt-1 truncate">{orgName}</p>
                      <p className="mt-2 font-semibold text-white">Active org ID</p>
                      <p className="mt-1 truncate">{activeOrgId ?? "--"}</p>
                    </div>
                  ) : null}

                  <div className="grid gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setOrgInfoOpen((v) => !v)}
                      className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-left text-xs font-semibold text-white/90 transition hover:bg-white/18"
                    >
                      Toggle organization details
                    </button>
                    <button
                      type="button"
                      onClick={() => setCollapsed(true)}
                      className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-left text-xs font-semibold text-white/90 transition hover:bg-white/18"
                    >
                      Collapse sidebar
                    </button>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={async () => {
                  await signOut(auth);
                  router.push("/page.tsx");
                }}
                className={`w-full rounded-xl border border-white/20 bg-white/12 ${navPad} text-left backdrop-blur-sm transition hover:bg-white/18`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-slate-200" />
                  <div className="text-[13px] font-semibold">Sign out</div>
                </div>
                <div className={`${navDesc} text-white/80`}>Log out of this account</div>
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 pt-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/15 text-sm font-bold backdrop-blur-sm">
              {avatarText}
            </div>

            <div className="w-full border-t border-white/20" />

            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => router.push(item.href)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/12 backdrop-blur-sm transition hover:bg-white/18"
                title={item.label}
              >
                <div className={`h-2 w-2 rounded-full ${item.indicatorClass}`} />
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                if (onInviteClick) onInviteClick();
                else router.push("/dashboard?invite=1");
              }}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/12 backdrop-blur-sm transition hover:bg-white/18"
              title="Invite member"
            >
              <div className="h-2 w-2 rounded-full bg-amber-300" />
            </button>

            <button
              type="button"
              onClick={() => {
                setCollapsed(false);
                setSettingsOpen(true);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/12 backdrop-blur-sm transition hover:bg-white/18"
              title="Settings"
            >
              <div className="h-2 w-2 rounded-full bg-sky-300" />
            </button>

            <button
              type="button"
              onClick={async () => {
                await signOut(auth);
                router.push("/login");
              }}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/12 backdrop-blur-sm transition hover:bg-white/18"
              title="Sign out"
            >
              <div className="h-2 w-2 rounded-full bg-slate-200" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
