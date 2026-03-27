"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function FundDevelopmentPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) {
    return (
      <main className="min-h-screen p-6 md:p-8">
        <div className="auth-card mx-auto max-w-4xl p-6">
          <p className="text-sm text-slate-600">Loading fund development workspace...</p>
        </div>
      </main>
    );
  }
  if (!user) return null;

  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
            In Progress
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Fund Development Plan</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This area is being prepared for guided questions, autosave, and plan-building workflows.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm font-medium text-slate-700">
            The foundation is in place and ready for the next implementation pass.
          </p>
        </section>
      </div>
    </main>
  );
}
