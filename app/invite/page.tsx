"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function InvitePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  const orgId = params.get("orgId") || "";
  const inviteId = params.get("inviteId") || "";
  const ready = useMemo(() => Boolean(orgId && inviteId), [orgId, inviteId]);

  const [inviteLoading, setInviteLoading] = useState(true);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  const [accountEmail, setAccountEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  }

  async function createAccountAndJoin() {
    if (!ready) return;
    if (inviteStatus !== "pending") return;

    const normalizedEmail = accountEmail.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      setMsg("Please enter a valid email address.");
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

    if (auth.currentUser?.email && auth.currentUser.email.toLowerCase() !== normalizedEmail) {
      setMsg(
        `You are signed in as ${auth.currentUser.email}. Use the same invited email or sign out first.`,
      );
      return;
    }

    if (!auth.currentUser && password.length < 8) {
      setMsg("Password must be at least 8 characters.");
      return;
    }

    if (!loading && user?.email && user.email.toLowerCase() !== normalizedEmail) {
      setMsg(
        `You are signed in as ${user.email}. Use the same invited email or sign out first.`,
      );
      return;
    }

    setSubmitting(true);
    setMsg(null);

    try {
      let idToken: string;

      if (auth.currentUser) {
        idToken = await auth.currentUser.getIdToken(true);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        idToken = await cred.user.getIdToken();
      }

      await acceptInviteWithToken(idToken);

      setMsg("Account ready. Invite accepted. Redirecting...");
      setTimeout(() => router.push("/dashboard"), 600);
    } catch (e: unknown) {
      if (e instanceof Error) setMsg(`Error: ${e.message}`);
      else setMsg("Failed to create account and accept invite.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-lg border rounded-xl p-6">
          <p>Invalid invite link.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg border rounded-xl p-6">
        <h1 className="text-2xl font-semibold">Join {orgName ?? "organization"}</h1>

        {inviteLoading ? (
          <p className="text-sm opacity-80 mt-3">Loading invite...</p>
        ) : (
          <>
            <p className="text-sm opacity-80 mt-2">
              Enter the same email address that received this invite.
            </p>

            <div className="mt-5 space-y-3">
              <div className="space-y-1">
                <label className="text-sm">Invite email</label>
                <input
                  className="w-full border rounded-md p-2"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="you@example.org"
                  type="email"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm">Access code</label>
                <input
                  className="w-full border rounded-md p-2"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste access code"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm">Your name</label>
                <input
                  className="w-full border rounded-md p-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm">Position</label>
                <input
                  className="w-full border rounded-md p-2"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="e.g., Development Director"
                />
              </div>

              {!auth.currentUser ? (
                <div className="space-y-1">
                  <label className="text-sm">Create password</label>
                  <input
                    className="w-full border rounded-md p-2"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    placeholder="At least 8 characters"
                  />
                </div>
              ) : null}

              {msg && <p className="text-sm">{msg}</p>}

              <button
                className="w-full border rounded-md p-2 disabled:opacity-60"
                disabled={submitting || inviteLoading || inviteStatus !== "pending"}
                onClick={createAccountAndJoin}
                type="button"
              >
                {submitting ? "Processing..." : "Create account and join"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

