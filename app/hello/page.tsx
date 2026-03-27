"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function HelloPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) return <p className="p-6">Loading...</p>;
  if (!user) return null;

  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="auth-card mx-auto max-w-3xl p-8 text-center">
        <p className="inline-flex items-center rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-700">
          Sandbox
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">Hello World</h1>
        <p className="mt-2 text-sm text-slate-600">This route is connected and ready for future UI experiments.</p>
      </div>
    </main>
  );
}
