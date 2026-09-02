"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebaseClient";

type LinkState = "checking" | "valid" | "invalid";

function getResetErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (code === "auth/expired-action-code") {
    return "This reset link has expired. Request a new one to continue.";
  }
  if (code === "auth/invalid-action-code") {
    return "This reset link is invalid or has already been used. Request a new one to continue.";
  }
  if (code === "auth/weak-password") {
    return "Choose a stronger password with at least 6 characters.";
  }
  return "We couldn’t reset your password. Please request a new link and try again.";
}

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const resetCode = params.get("oobCode")?.trim() ?? "";
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [accountEmail, setAccountEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function verifyLink() {
      if (!resetCode) {
        setError("This reset link is incomplete. Request a new one to continue.");
        setLinkState("invalid");
        return;
      }

      try {
        const email = await verifyPasswordResetCode(auth, resetCode);
        if (!cancelled) {
          setAccountEmail(email);
          setLinkState("valid");
        }
      } catch (verifyError: unknown) {
        if (!cancelled) {
          setError(getResetErrorMessage(verifyError));
          setLinkState("invalid");
        }
      }
    }

    void verifyLink();
    return () => {
      cancelled = true;
    };
  }, [resetCode]);

  async function handleReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(auth, resetCode, password);
      setComplete(true);
      setPassword("");
      setConfirmPassword("");
    } catch (resetError: unknown) {
      setError(getResetErrorMessage(resetError));
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
            {complete ? "Password reset" : "Choose a new password"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {complete
              ? "Your new password is ready to use."
              : "Create a secure password for your account."}
          </p>
        </div>

        <section className="auth-card p-7">
          {complete ? (
            <div className="text-center" aria-live="polite">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-success-600">
                <CheckCircle2 aria-hidden="true" className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-slate-900">Password reset successfully</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                You can now sign in with your new password.
              </p>
              <a className="btn-primary mt-6 inline-flex w-full items-center justify-center px-4 py-2.5 text-sm" href="/login">
                Sign in
              </a>
            </div>
          ) : linkState === "checking" ? (
            <div className="flex items-center justify-center gap-3 py-8 text-sm font-medium text-slate-600" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
              Checking reset link...
            </div>
          ) : linkState === "invalid" ? (
            <div className="text-center">
              <div className="status-box status-box-error" role="alert">
                {error}
              </div>
              <a className="btn-primary mt-5 inline-flex w-full items-center justify-center px-4 py-2.5 text-sm" href="/forgot-password">
                Request a new link
              </a>
              <a className="mt-4 inline-block text-sm font-semibold text-slate-600 hover:text-slate-900" href="/login">
                Back to sign in
              </a>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleReset}>
              <div className="auth-section-card flex items-center gap-3 px-4 py-3">
                <KeyRound aria-hidden="true" className="h-5 w-5 shrink-0 text-primary-600" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">Resetting password for</p>
                  <p className="truncate text-sm font-semibold text-slate-900">{accountEmail}</p>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="new-password">
                  New password
                </label>
                <input
                  autoComplete="new-password"
                  autoFocus
                  className="field-input"
                  id="new-password"
                  minLength={6}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  required
                  type="password"
                  value={password}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="confirm-password">
                  Confirm new password
                </label>
                <input
                  autoComplete="new-password"
                  className="field-input"
                  id="confirm-password"
                  minLength={6}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Enter your new password again"
                  required
                  type="password"
                  value={confirmPassword}
                />
              </div>

              {error ? (
                <div className="status-box status-box-error" role="alert">
                  {error}
                </div>
              ) : null}

              <button className="btn-primary w-full px-4 py-2.5 text-sm" disabled={loading} type="submit">
                {loading ? "Resetting password..." : "Reset password"}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
