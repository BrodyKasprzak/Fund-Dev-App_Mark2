"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

export default function InvitePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  const orgId = params.get("orgId") || "";
  const inviteId = params.get("inviteId") || "";

  const ready = useMemo(() => Boolean(orgId && inviteId), [orgId, inviteId]);

  const [inviteLoading, setInviteLoading] = useState(true);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string>("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load invite metadata (public + safe)
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
          `/api/invites/details?orgId=${encodeURIComponent(orgId)}&inviteId=${encodeURIComponent(inviteId)}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load invite");

        if (data.status !== "pending") {
          setMsg(`Invite is ${data.status}.`);
        }

        setOrgName(data.orgName ?? null);
        setInvitedEmail(String(data.invitedEmail || "").trim().toLowerCase());
      } catch (e: any) {
        setMsg(`❌ ${e.message ?? "Failed to load invite"}`);
      } finally {
        setInviteLoading(false);
      }
    })();
  }, [ready, orgId, inviteId]);

  async function createAccountAndJoin() {
    if (!ready) return;

    if (!invitedEmail) {
      setMsg("Invite email not found. Ask the org admin to resend the invite.");
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
    if (password.length < 8) {
      setMsg("Password must be at least 8 characters.");
      return;
    }

    // If user is logged in as a different email, force them to switch accounts
    if (!loading && user?.email && user.email.toLowerCase() !== invitedEmail.toLowerCase()) {
      setMsg(
        `You are signed in as ${user.email}. This invite is for ${invitedEmail}. Please sign out and try again.`
      );
      return;
    }

    setSubmitting(true);
    setMsg(null);

    try {
      // Ensure we are signed out before creating an account (Firebase will error otherwise)
      if (auth.currentUser) {
        await signOut(auth);
      }

      // 1) Create Firebase Auth user using the INVITED email (locked)
      const cred = await createUserWithEmailAndPassword(auth, invitedEmail, password);

      // 2) Accept invite (server verifies code + email match + joins org)
      const idToken = await cred.user.getIdToken();

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

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to join organization");

      setMsg("✅ Account created and invite accepted! Redirecting...");
      setTimeout(() => router.push("/dashboard"), 600);
    } catch (e: any) {
      setMsg(`❌ ${e.message ?? "Failed to create account & join"}`);
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
              This invite is for: <span className="font-mono">{invitedEmail || "unknown"}</span>
            </p>

            <div className="mt-5 space-y-3">
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

              {msg && <p className="text-sm">{msg}</p>}

              <button
                className="w-full border rounded-md p-2 disabled:opacity-60"
                disabled={submitting || inviteLoading}
                onClick={createAccountAndJoin}
                type="button"
              >
                {submitting ? "Creating & joining..." : "Create account & join"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

