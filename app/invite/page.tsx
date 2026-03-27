"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getAuthErrorCode(err: unknown) {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

function authErrorMessage(err: unknown) {
  const code = getAuthErrorCode(err);
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "This email already has an account. Use the existing account password, then continue.";
  }
  if (code === "auth/user-not-found") {
    return "No account exists for this email yet. Enter a new password to create one.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many auth attempts. Wait a few minutes and try again.";
  }
  if (code === "auth/network-request-failed") {
    return "Network error during authentication. Check your connection and retry.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized in Firebase Auth settings.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Authentication failed. Please try again.";
}

function normalizeInviteEmail(email: string) {
  const value = String(email ?? "").trim().toLowerCase();
  const [localRaw, domainRaw] = value.split("@");
  if (!localRaw || !domainRaw) return value;

  const localNoPlus = localRaw.split("+")[0];
  const domain = domainRaw.toLowerCase();
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${localNoPlus.replace(/\./g, "")}@gmail.com`;
  }
  return `${localNoPlus}@${domain}`;
}

type ExistingOrg = {
  orgId: string;
  name: string | null;
};

export default function InvitePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, refreshMe } = useAuth();

  const orgId = params.get("orgId") || "";
  const inviteId = params.get("inviteId") || "";
  const ready = useMemo(() => Boolean(orgId && inviteId), [orgId, inviteId]);

  const [inviteLoading, setInviteLoading] = useState(true);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  const [accountEmail, setAccountEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [existingOrgs, setExistingOrgs] = useState<ExistingOrg[] | null>(null);

  useEffect(() => {
    if (!ready) {
      setMsg("Invalid invite link.");
      setInviteLoading(false);
      return;
    }

    (async () => {
      try {
        setInviteLoading(true);
        setMsg(null);

        const res = await fetch(
          `/api/invites/details?orgId=${encodeURIComponent(orgId)}&inviteId=${encodeURIComponent(inviteId)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load invite");

        setOrgName(data.orgName ?? null);
        setInviteStatus(typeof data.status === "string" ? data.status : null);
        setInviteEmail(typeof data.inviteEmail === "string" ? data.inviteEmail.toLowerCase() : null);

        if (data.status !== "pending") {
          setMsg(`Invite is ${data.status}. Ask an admin for a new invite.`);
        }
      } catch (e: unknown) {
        if (e instanceof Error) setMsg(`Error: ${e.message}`);
        else setMsg("Failed to load invite.");
      } finally {
        setInviteLoading(false);
      }
    })();
  }, [ready, orgId, inviteId]);

  async function acceptInviteWithToken(idToken: string) {
    const res = await fetch("/api/invites/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        orgId,
        inviteId,
        code: code.trim(),
        name: name.trim(),
        position: position.trim(),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to join organization");
    return data as { ok?: boolean; orgId?: string };
  }

  async function getExistingOrgs(idToken: string): Promise<ExistingOrg[]> {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return [];

    const orgRows = Array.isArray(data?.orgs) ? data.orgs : [];
    return orgRows
      .map((row: unknown) => {
        if (typeof row !== "object" || row === null) return null;
        const rec = row as Record<string, unknown>;
        const orgIdValue = typeof rec.orgId === "string" ? rec.orgId.trim() : "";
        if (!orgIdValue) return null;
        return {
          orgId: orgIdValue,
          name: typeof rec.name === "string" ? rec.name : null,
        } as ExistingOrg;
      })
      .filter((row: ExistingOrg | null): row is ExistingOrg => Boolean(row));
  }

  async function completeInviteJoin(idToken: string) {
    await acceptInviteWithToken(idToken);
    await refreshMe();

    setMsg("Invite accepted. Redirecting...");
    setTimeout(() => router.push(`/org-picker?next=${encodeURIComponent("/dashboard")}`), 600);
  }

  async function createAccountAndJoin() {
    if (!ready) return;
    if (inviteStatus !== "pending") return;

    const normalizedEmail = accountEmail.trim().toLowerCase();
    const normalizedInviteEmail = inviteEmail ? normalizeInviteEmail(inviteEmail) : "";

    if (!isValidEmail(normalizedEmail)) {
      setMsg("Please enter a valid email address.");
      return;
    }
    if (normalizedInviteEmail && normalizeInviteEmail(normalizedEmail) !== normalizedInviteEmail) {
      setMsg(
        inviteEmail
          ? `Wrong email. Sign in with the email this invite was sent to: ${inviteEmail}.`
          : "Wrong email. Sign in with the email this invite was sent to.",
      );
      return;
    }
    if (!code.trim()) {
      setMsg("Please paste the access code from your email.");
      return;
    }
    if (!name.trim()) {
      setMsg("Please enter your name.");
      return;
    }
    if (!position.trim()) {
      setMsg("Please enter your position.");
      return;
    }

    if (
      auth.currentUser?.email &&
      normalizeInviteEmail(auth.currentUser.email) !== normalizeInviteEmail(normalizedEmail)
    ) {
      setMsg(`You are signed in as ${auth.currentUser.email}. Use the same invited email or sign out first.`);
      return;
    }

    if (!auth.currentUser && password.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }

    if (
      !loading &&
      user?.email &&
      normalizeInviteEmail(user.email) !== normalizeInviteEmail(normalizedEmail)
    ) {
      setMsg(`You are signed in as ${user.email}. Use the same invited email or sign out first.`);
      return;
    }

    setSubmitting(true);
    setMsg(null);
    setExistingOrgs(null);
    setPendingToken(null);

    try {
      let idToken: string;

      if (auth.currentUser) {
        idToken = await auth.currentUser.getIdToken(true);
      } else {
        try {
          const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
          idToken = await cred.user.getIdToken();
        } catch (e: unknown) {
          const code = getAuthErrorCode(e);
          if (code === "auth/email-already-in-use") {
            try {
              const cred = await signInWithEmailAndPassword(auth, normalizedEmail, password);
              idToken = await cred.user.getIdToken();
            } catch (signInErr: unknown) {
              throw new Error(authErrorMessage(signInErr));
            }
          } else {
            throw new Error(authErrorMessage(e));
          }
        }
      }

      const priorOrgs = await getExistingOrgs(idToken);
      const orgsBeforeInvite = priorOrgs.filter((o) => o.orgId !== orgId);

      if (orgsBeforeInvite.length > 0) {
        setExistingOrgs(orgsBeforeInvite);
        setPendingToken(idToken);
        return;
      }

      await completeInviteJoin(idToken);
    } catch (e: unknown) {
      if (e instanceof Error) setMsg(`Error: ${authErrorMessage(e)}`);
      else setMsg("Failed to create account and accept invite.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmJoinInvitedOrg() {
    if (!pendingToken) {
      setMsg("Authentication expired. Please continue again.");
      return;
    }

    setSubmitting(true);
    setMsg(null);
    try {
      await completeInviteJoin(pendingToken);
    } catch (e: unknown) {
      if (e instanceof Error) setMsg(`Error: ${authErrorMessage(e)}`);
      else setMsg("Failed to join organization.");
    } finally {
      setSubmitting(false);
    }
  }

  const messageClass = msg && msg.startsWith("Error:") ? "status-box status-box-error" : "status-box";

  if (!ready) {
    return (
      <main className="public-shell p-6">
        <div className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center">
          <section className="auth-card w-full p-8">
            <span className="auth-brand-chip">PurposeFramework</span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Invalid invite link</h1>
            <p className="mt-2 text-sm text-slate-600">
              This link is missing required invite information. Ask your admin to send a new invite.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="public-shell p-6 md:p-8">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center">
        <section className="auth-card w-full p-7 md:p-8">
          <span className="auth-brand-chip">PurposeFramework</span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
            Join {orgName ?? "organization"}
          </h1>

          {inviteLoading ? (
            <div className="status-box mt-5">Loading invite...</div>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-600">Enter the same email address that received this invite.</p>
              {inviteEmail ? (
                <p className="mt-1 text-xs text-slate-500">
                  Invite recipient: <span className="font-medium text-slate-700">{inviteEmail}</span>
                </p>
              ) : null}

              <div className="mt-5 space-y-4">
                {existingOrgs && existingOrgs.length > 0 ? (
                  <div className="auth-section-card space-y-4 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      You are already a member of these organizations:
                    </p>
                    <ul className="space-y-2 text-sm">
                      {existingOrgs.map((o) => (
                        <li key={o.orgId} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">
                          {o.name?.trim() || "Unnamed organization"}
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm text-slate-700">
                      Do you also want to become a member of {orgName ?? "this organization"}?
                    </p>

                    {msg ? <div className={messageClass}>{msg}</div> : null}

                    <button
                      className="btn-primary w-full px-4 py-2.5 text-sm"
                      disabled={submitting}
                      onClick={confirmJoinInvitedOrg}
                      type="button"
                    >
                      {submitting ? "Joining..." : `Join ${orgName ?? "organization"}`}
                    </button>

                    <button
                      className="btn-secondary w-full px-4 py-2.5 text-sm"
                      disabled={submitting}
                      onClick={() => {
                        setExistingOrgs(null);
                        setPendingToken(null);
                        setMsg(null);
                      }}
                      type="button"
                    >
                      Go back
                    </button>
                  </div>
                ) : null}

                {!existingOrgs ? (
                  <>
                    <div>
                      <label className="field-label">Invite email</label>
                      <input
                        className="field-input"
                        value={accountEmail}
                        onChange={(e) => setAccountEmail(e.target.value)}
                        placeholder="you@example.org"
                        type="email"
                      />
                    </div>

                    <div>
                      <label className="field-label">Access code</label>
                      <input
                        className="field-input"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Paste access code"
                      />
                    </div>

                    <div>
                      <label className="field-label">Your name</label>
                      <input
                        className="field-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Full name"
                      />
                    </div>

                    <div>
                      <label className="field-label">Position</label>
                      <input
                        className="field-input"
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        placeholder="e.g., Development Director"
                      />
                    </div>

                    {!auth.currentUser ? (
                      <div>
                        <label className="field-label">Password</label>
                        <input
                          className="field-input"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          type="password"
                          placeholder="Use your existing password, or create one"
                        />
                        <p className="field-help">
                          If this email already has an account, we sign you in and then join this org.
                        </p>
                      </div>
                    ) : null}

                    {msg ? <div className={messageClass}>{msg}</div> : null}

                    <button
                      className="btn-primary w-full px-4 py-2.5 text-sm"
                      disabled={submitting || inviteLoading || inviteStatus !== "pending"}
                      onClick={createAccountAndJoin}
                      type="button"
                    >
                      {submitting ? "Processing..." : "Continue and join organization"}
                    </button>
                  </>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
