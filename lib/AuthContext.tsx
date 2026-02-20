"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

  // Org context (client-side “active org”)
  activeOrgId: string | null;
  setActiveOrgId: (orgId: string | null) => void;
  clearActiveOrgId: () => void;

  // “me” (discovered without requiring x-org-id)
  me: Me | null;
  meLoading: boolean;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Active org selection (persisted)
  const [activeOrgId, _setActiveOrgId] = useState<string | null>(null);

  // “me” discovery
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);

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
      if (u) setMeLoading(true);
      setUser(u);
      setLoading(false);

      if (!u) {
        clearActiveOrgId();
        setMe(null);
        setOrgs([]);
        setMeLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMe = useCallback(async (): Promise<Me | null> => {
    if (!user) return null;

    setMeLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        setMe(null);
        setOrgs([]);
        setActiveOrgId(null);
        return null;
      }

      const next: Me = {
        uid: String(json.me?.uid ?? user.uid),
        email: (typeof json.me?.email === "string" ? json.me.email : null) ?? null,
        orgId: cleanOrgId(json.me?.orgId),
        role: cleanOrgId(json.me?.role),
        name: typeof json.me?.name === "string" ? json.me.name : null,
        position: typeof json.me?.position === "string" ? json.me.position : null,
        org: json.me?.org && typeof json.me.org === "object"
          ? { id: String(json.me.org.id ?? ""), name: typeof json.me.org.name === "string" ? json.me.org.name : null }
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
                role: cleanOrgId(rec?.role) ?? "member",
                status: cleanOrgId(rec?.status) ?? "active",
                name: typeof rec?.name === "string" ? rec.name : null,
              } as OrgMembership;
            })
            .filter((item: OrgMembership | null): item is OrgMembership => Boolean(item))
        : [];

      setMe(next);
      setOrgs(nextOrgs);

      // Org selection rule:
      // - exactly 1 org -> auto-select
      // - 0 orgs or >1 orgs -> require explicit state (null)
      if (nextOrgs.length === 1) {
        setActiveOrgId(nextOrgs[0].orgId);
      } else {
        setActiveOrgId(null);
      }

      return next;
    } catch {
      setMe(null);
      setOrgs([]);
      setActiveOrgId(null);
      return null;
    } finally {
      setMeLoading(false);
    }
  }, [setActiveOrgId, user]);

  // Load “me” after sign-in (and keep activeOrgId valid)
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

      // ✅ Attach org context: activeOrgId first, fallback to me.orgId
      const orgIdToUse = activeOrgId || null;
      if (orgIdToUse) headers.set("x-org-id", orgIdToUse);

      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const res = await fetch(input, { ...init, headers });

      // If org context is stale (e.g., user removed from org), refreshMe can correct
      if (res.status === 400) {
        // sometimes "Missing org context" — try to recover once
        // (don’t loop forever; just refresh me and return original response)
        // You can refine later by checking json.error.
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



