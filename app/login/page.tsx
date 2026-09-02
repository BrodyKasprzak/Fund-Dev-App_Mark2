"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      const next = (params.get("next") || "").trim();
      const pickerHref = next ? `/org-picker?next=${encodeURIComponent(next)}` : "/org-picker";
      router.push(pickerHref);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="public-shell flex items-center justify-center p-6">
      <div className="auth-layout">
        <div className="mb-6 text-center">
          <span className="auth-brand-chip">PurposeFramework</span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in to continue to your workspace.</p>
        </div>

        <div className="auth-card p-7">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="field-label">
                Email address
              </label>
              <input
                id="email"
                className="field-input"
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="password" className="field-label mb-0">
                  Password
                </label>
                <a
                  className="text-xs font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-600"
                  href="/forgot-password"
                >
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                className="field-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
              />
            </div>

            {error ? <div className="status-box status-box-error">{error}</div> : null}

            <button className="btn-primary w-full px-4 py-2.5 text-sm" disabled={loading} type="submit">
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-5 text-center">
            <p className="text-sm text-slate-600">
              New here?{" "}
              <a className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-600" href="/register">
                Create an account
              </a>
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">
          Secure nonprofit document management and builder platform
        </p>
      </div>
    </main>
  );
}
