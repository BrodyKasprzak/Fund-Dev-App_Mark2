"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

function normalizeNextPath(nextRaw: string | null) {
  const trimmed = (nextRaw || "").trim();
  if (!trimmed.startsWith("/")) return "/dashboard";
  if (trimmed.startsWith("/login") || trimmed.startsWith("/org-picker")) return "/dashboard";
  return trimmed;
}

export default function OrgPickerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, meLoading, orgs, activeOrgId, setActiveOrgId } = useAuth();

  const orgsLoading = meLoading;
  const forcePicker = searchParams.get("force") === "1";
  const nextPath = useMemo(() => normalizeNextPath(searchParams.get("next")), [searchParams]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
    }
  }, [loading, nextPath, router, user]);

  useEffect(() => {
    if (loading || orgsLoading || !user) return;

    if (orgs.length === 1 && !forcePicker) {
      const onlyOrgId = orgs[0].orgId;
      if (activeOrgId !== onlyOrgId) setActiveOrgId(onlyOrgId);
      router.replace(nextPath);
      return;
    }
  }, [activeOrgId, forcePicker, loading, nextPath, orgs, orgsLoading, router, setActiveOrgId, user]);

  if (loading || orgsLoading) {
    return (
      <main className="public-shell flex items-center justify-center p-6">
        <div className="auth-card px-6 py-5">
          <p className="text-sm font-medium text-slate-700">Loading organizations...</p>
        </div>
      </main>
    );
  }

  if (!user) return null;

  if (orgs.length === 0) {
    return (
      <main className="public-shell p-6 md:p-8">
        <div className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center">
          <section className="auth-card w-full p-8">
            <span className="auth-brand-chip">PurposeFramework</span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">No organization access</h1>
            <p className="mt-2 text-sm text-slate-600">
              This account is authenticated but is not currently a member of any organization.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary px-4 py-2.5 text-sm"
                onClick={() => router.replace("/onboarding/org")}
              >
                Create organization
              </button>
              <button
                type="button"
                className="btn-secondary px-4 py-2.5 text-sm"
                onClick={async () => {
                  await signOut(auth);
                  router.replace("/login");
                }}
              >
                Sign out
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="public-shell p-6 md:p-8">
      <div className="mx-auto mt-6 w-full max-w-3xl">
        <section className="auth-card p-7">
          <span className="auth-brand-chip">PurposeFramework</span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">Choose an organization</h1>
          <p className="mt-2 text-sm text-slate-600">
            Select which organization workspace to enter for this session, or create a new one.
          </p>

          <div className="mt-6 space-y-3">
            {orgs.map((org) => (
              <button
                key={org.orgId}
                type="button"
                onClick={() => {
                  setActiveOrgId(org.orgId);
                  router.replace(nextPath);
                }}
                className="option-card px-4 py-3"
              >
                <p className="text-base font-semibold text-slate-900">{org.name || "Unnamed organization"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Role: {org.role} | Status: {org.status} | ID: {org.orgId}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary px-4 py-2.5 text-sm"
              onClick={() => router.replace("/onboarding/org")}
            >
              Create organization
            </button>
            <button
              type="button"
              className="btn-secondary px-4 py-2.5 text-sm"
              onClick={async () => {
                await signOut(auth);
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
