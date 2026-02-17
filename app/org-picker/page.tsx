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
  const nextPath = useMemo(
    () => normalizeNextPath(searchParams.get("next")),
    [searchParams],
  );

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
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-slate-50 to-primary-50 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-sm font-medium text-slate-700">Loading organizations...</p>
        </div>
      </main>
    );
  }

  if (!user) return null;

  if (orgs.length === 0) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-primary-50 via-slate-50 to-primary-50 p-6 md:p-8">
        <div className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center">
          <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
            <div className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 px-5 py-3 shadow-lg">
              <span className="text-lg font-bold text-white">PurposeFramework</span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">No organization access</h1>
          <p className="mt-2 text-sm text-slate-600">
            This account is authenticated but is not currently a member of any organization.
          </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl bg-gradient-to-r from-primary-500 to-accent-400 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/30 transition hover:from-primary-600 hover:to-primary-500"
              onClick={() => router.replace("/onboarding/org")}
            >
              Create organization
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
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
    <main className="min-h-screen bg-gradient-to-br from-primary-50 via-slate-50 to-primary-50 p-6 md:p-8">
      <div className="mx-auto mt-6 w-full max-w-3xl">
        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60">
          <div className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 px-5 py-3 shadow-lg">
            <span className="text-lg font-bold text-white">PurposeFramework</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Choose an organization</h1>
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
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-primary-300 hover:bg-primary-50/30 hover:shadow-md"
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
              className="rounded-xl bg-gradient-to-r from-primary-500 to-accent-400 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/30 transition hover:from-primary-600 hover:to-primary-500"
              onClick={() => router.replace("/onboarding/org")}
            >
              Create organization
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
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

