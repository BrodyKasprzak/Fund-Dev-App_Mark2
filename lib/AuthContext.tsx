"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

const ACTIVE_ORG_KEY = "pf_active_org";

type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type OrgMembership = {
  orgId: string;
  role: string;
  status: string;
  name: string | null;
};

type Me = {
  uid: string;
  email: string | null;
  orgId: string | null;
  role: string | null;
  name?: string | null;
  position?: string | null;
  org?: { id: string; name: string | null } | null;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;

  // Org context (client-side active org)
  activeOrgId: string | null;
  setActiveOrgId: (orgId: string | null) => void;
  clearActiveOrgId: () => void;

  // me (discovered without requiring x-org-id)
  me: Me | null;
  meLoading: boolean;
  meResolved: boolean;
  meError: string | null;
  orgs: OrgMembership[];
  orgsLoading: boolean;
  refreshMe: () => Promise<Me | null>;

  // Helper for org-scoped API calls
  authedFetch: AuthedFetch;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,

  activeOrgId: null,
  setActiveOrgId: () => {},
  clearActiveOrgId: () => {},

  me: null,
  meLoading: false,
  meResolved: false,
  meError: null,
  orgs: [],
  orgsLoading: false,
  refreshMe: async () => null,

  authedFetch: async () => {
    throw new Error("AuthProvider not mounted");
  },
});

function cleanOrgId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Active org selection (persisted)
  const [activeOrgId, _setActiveOrgId] = useState<string | null>(null);

  // me discovery
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meResolved, setMeResolved] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const refreshSeqRef = useRef(0);

  // Load active org from localStorage (client-only)
  useEffect(() => {
    try {
      const v = localStorage.getItem(ACTIVE_ORG_KEY);
      _setActiveOrgId(v && v.trim() ? v.trim() : null);
    } catch {
      _setActiveOrgId(null);
    }
  }, []);

  // Keep localStorage in sync
  const setActiveOrgId = useCallback((orgId: string | null) => {
    const cleaned = (orgId ?? "").trim();
    const next = cleaned.length ? cleaned : null;
    _setActiveOrgId(next);

    try {
      if (next) localStorage.setItem(ACTIVE_ORG_KEY, next);
      else localStorage.removeItem(ACTIVE_ORG_KEY);
    } catch {
      // ignore storage failures
    }
  }, []);

  const clearActiveOrgId = useCallback(() => setActiveOrgId(null), [setActiveOrgId]);

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      refreshSeqRef.current += 1;

      if (u) {
        setMeLoading(true);
        setMeResolved(false);
        setMeError(null);
      }

      setUser(u);
      setLoading(false);

      if (!u) {
        clearActiveOrgId();
        setMe(null);
        setOrgs([]);
        setMeResolved(false);
        setMeError(null);
        setMeLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMe = useCallback(async (): Promise<Me | null> => {
    if (!user) return null;

    const requestSeq = ++refreshSeqRef.current;
    const isStale = () => requestSeq !== refreshSeqRef.current;
    const maxAttempts = 4;

    setMeLoading(true);
    setMeError(null);

    try {
      let json: Record<string, unknown> = {};
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const forceRefreshToken = attempt > 1;

        try {
          const idToken = await user.getIdToken(forceRefreshToken);
          const res = await fetch("/api/me", {
            headers: { Authorization: `Bearer ${idToken}` },
            cache: "no-store",
          });
          json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

          if (res.ok && json?.ok) {
            break;
          }

          const apiMessage =
            typeof json?.error === "string" && json.error.trim()
              ? json.error.trim()
              : `Failed to load workspace context (${res.status})`;
          lastError = new Error(apiMessage);

          const shouldRetry =
            attempt < maxAttempts &&
            (res.status === 401 || res.status === 429 || res.status >= 500);
          if (!shouldRetry) throw lastError;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error("Failed to load workspace context");
          if (attempt >= maxAttempts) throw lastError;
        }

        await sleep(180 * attempt);
      }

      if (!json?.ok) {
        throw lastError ?? new Error("Failed to load workspace context");
      }

      const meRaw = asRecord(json.me) ?? {};
      const meOrgRaw = asRecord(meRaw.org);

      const next: Me = {
        uid: String(meRaw.uid ?? user.uid),
        email: (typeof meRaw.email === "string" ? meRaw.email : null) ?? null,
        orgId: cleanOrgId(meRaw.orgId),
        role: cleanOrgId(meRaw.role),
        name: typeof meRaw.name === "string" ? meRaw.name : null,
        position: typeof meRaw.position === "string" ? meRaw.position : null,
        org: meOrgRaw
          ? {
              id: String(meOrgRaw.id ?? ""),
              name: typeof meOrgRaw.name === "string" ? meOrgRaw.name : null,
            }
          : null,
      };

      const nextOrgs: OrgMembership[] = Array.isArray(json.orgs)
        ? json.orgs
            .map((item: unknown) => {
              const rec = asRecord(item);
              const orgId = cleanOrgId(rec?.orgId);
              if (!orgId) return null;
              return {
                orgId,
                role: cleanOrgId(rec?.role) ?? "editor",
                status: cleanOrgId(rec?.status) ?? "active",
                name: typeof rec?.name === "string" ? rec.name : null,
              } as OrgMembership;
            })
            .filter((item: OrgMembership | null): item is OrgMembership => Boolean(item))
        : [];

      if (isStale()) return null;

      setMe(next);
      setOrgs(nextOrgs);
      setMeResolved(true);
      setMeError(null);

      // Org selection rule:
      // - exactly 1 org -> auto-select
      // - 0 orgs or >1 orgs -> require explicit state (null)
      if (nextOrgs.length === 1) {
        setActiveOrgId(nextOrgs[0].orgId);
      } else {
        setActiveOrgId(null);
      }

      return next;
    } catch (err: unknown) {
      if (!isStale()) {
        setMeResolved(true);
        setMeError(err instanceof Error ? err.message : "Failed to load workspace context");
      }
      return null;
    } finally {
      if (!isStale()) setMeLoading(false);
    }
  }, [setActiveOrgId, user]);

  // Load me after sign-in (and keep activeOrgId valid)
  useEffect(() => {
    if (!user) return;
    void refreshMe();
  }, [refreshMe, user]);

  const authedFetch: AuthedFetch = useMemo(() => {
    return async (input, init = {}) => {
      if (!user) throw new Error("Not authenticated");

      const idToken = await user.getIdToken();

      // Merge headers safely
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${idToken}`);

      // Attach org context from active org selection
      const orgIdToUse = activeOrgId || null;
      if (orgIdToUse) headers.set("x-org-id", orgIdToUse);

      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const res = await fetch(input, { ...init, headers });

      // If org context is stale (e.g., user removed from org), refreshMe can correct
      if (res.status === 400) {
        // sometimes "Missing org context" - try to recover once
        // (do not loop forever; just refresh me and return original response)
      }

      return res;
    };
  }, [user, activeOrgId]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        activeOrgId,
        setActiveOrgId,
        clearActiveOrgId,
        me,
        meLoading,
        meResolved,
        meError,
        orgs,
        orgsLoading: meLoading,
        refreshMe,
        authedFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
