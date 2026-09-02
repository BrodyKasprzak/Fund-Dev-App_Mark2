"use client";

import { useState } from "react";
import { ArrowLeft, Mail, Send } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Unable to send a reset link.",
        );
      }

      setSubmittedEmail(normalizedEmail);
      setSent(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to send a reset link. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="public-shell flex items-center justify-center p-6">
      <div className="auth-layout">
        <div className="mb-6 text-center">
          <span className="auth-brand-chip">PurposeFramework</span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
            {sent ? "Check your email" : "Forgot your password?"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {sent
              ? "If that email is linked to an account, a reset link is on its way."
              : "Enter your account email and we’ll send you a secure reset link."}
          </p>
        </div>

        <section className="auth-card p-7">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                <Mail aria-hidden="true" className="h-6 w-6" />
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-600">
                We sent instructions to <span className="font-semibold text-slate-900">{submittedEmail}</span> if
                an account exists for that address. Check your spam folder if you don’t see the message.
              </p>
              <button
                className="btn-secondary mt-6 w-full px-4 py-2.5 text-sm"
                onClick={() => {
                  setSent(false);
                  setError(null);
                }}
                type="button"
              >
                Try another email
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="field-label" htmlFor="email">
                  Email address
                </label>
                <input
                  autoComplete="email"
                  autoFocus
                  className="field-input"
                  id="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@organization.org"
                  required
                  type="email"
                  value={email}
                />
              </div>

              {error ? (
                <div className="status-box status-box-error" role="alert">
                  {error}
                </div>
              ) : null}

              <button className="btn-primary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm" disabled={loading} type="submit">
                <Send aria-hidden="true" className="h-4 w-4" />
                {loading ? "Sending reset link..." : "Send reset link"}
              </button>
            </form>
          )}

          <div className="mt-6 border-t border-slate-200 pt-5 text-center">
            <a
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 transition hover:text-slate-950"
              href="/login"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to sign in
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
