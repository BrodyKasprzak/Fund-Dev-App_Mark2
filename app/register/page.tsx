"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

function getAuthErrorCode(err: unknown) {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function persistProfileName(idToken: string, name: string) {
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Failed to save profile name");
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError("Full name is required.");
      setLoading(false);
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const token = await cred.user.getIdToken();
      await persistProfileName(token, trimmedName);
      router.push("/onboarding/org");
    } catch (err: unknown) {
      const code = getAuthErrorCode(err);

      if (code === "auth/email-already-in-use") {
        try {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          const token = await cred.user.getIdToken();
          await persistProfileName(token, trimmedName);
          router.push("/org-picker?force=1");
          return;
        } catch (signInErr: unknown) {
          const signInCode = getAuthErrorCode(signInErr);
          if (signInCode === "auth/invalid-credential" || signInCode === "auth/wrong-password") {
            setError("Account already exists. Enter the existing password to continue.");
          } else if (signInErr instanceof Error) {
            setError(signInErr.message);
          } else {
            setError("Account exists, but sign-in failed.");
          }
          return;
        }
      }

      if (err instanceof Error) setError(err.message);
      else setError("Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="public-shell flex items-center justify-center p-6">
      <div className="auth-layout">
        <div className="mb-6 text-center">
          <span className="auth-brand-chip">PurposeFramework</span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Create your account</h1>
          <p className="mt-2 text-sm text-slate-600">
            Start building and managing professional fundraising documents.
          </p>
        </div>

        <div className="auth-card p-7">
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label htmlFor="full-name" className="field-label">
                Full name
              </label>
              <input
                id="full-name"
                className="field-input"
                placeholder="First and last name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                type="text"
                required
              />
            </div>

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
              <label htmlFor="password" className="field-label">
                Password
              </label>
              <input
                id="password"
                className="field-input"
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                minLength={6}
              />
              <p className="field-help">Must be at least 6 characters long.</p>
            </div>

            {error ? <div className="status-box status-box-error">{error}</div> : null}

            <button className="btn-primary w-full px-4 py-2.5 text-sm" disabled={loading} type="submit">
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-5 text-center">
            <p className="text-sm text-slate-600">
              Already have an account?{" "}
              <a className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-600" href="/login">
                Sign in
              </a>
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">
          Free to get started. Secure nonprofit document management.
        </p>
      </div>
    </main>
  );
}
