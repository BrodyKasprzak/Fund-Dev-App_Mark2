"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

const ACTIVE_ORG_KEY = "pf_active_org";

type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Active org selection (persisted)
  const [activeOrgId, _setActiveOrgId] = useState<string | null>(null);

  // “me” discovery
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(false);

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
  const setActiveOrgId = (orgId: string | null) => {
    const cleaned = (orgId ?? "").trim();
    const next = cleaned.length ? cleaned : null;
    _setActiveOrgId(next);

    try {
      if (next) localStorage.setItem(ACTIVE_ORG_KEY, next);
      else localStorage.removeItem(ACTIVE_ORG_KEY);
    } catch {
      // ignore storage failures
    }
  };

  const clearActiveOrgId = () => setActiveOrgId(null);

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);

      if (!u) {
        clearActiveOrgId();
        setMe(null);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshMe(): Promise<Me | null> {
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

      setMe(next);

      // ✅ AUTO-SET active org the first time we discover it
      if (!activeOrgId && next.orgId) {
        setActiveOrgId(next.orgId);
      }

      return next;
    } catch {
      setMe(null);
      return null;
    } finally {
      setMeLoading(false);
    }
  }

  // Load “me” after sign-in (and keep activeOrgId valid)
  useEffect(() => {
    if (!user) return;
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const authedFetch: AuthedFetch = useMemo(() => {
    return async (input, init = {}) => {
      if (!user) throw new Error("Not authenticated");

      const idToken = await user.getIdToken();

      // Merge headers safely
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${idToken}`);

      // ✅ Attach org context: activeOrgId first, fallback to me.orgId
      const orgIdToUse = activeOrgId || me?.orgId || null;
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
  }, [user, activeOrgId, me?.orgId]);

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



