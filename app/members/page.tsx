"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

type MemberRole = "admin" | "editor" | "viewer" | "board_member";

type MemberRow = {
  uid: string;
  email: string | null;
  name: string | null;
  position: string | null;
  role: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMemberIdentity(name: string | null, email: string | null, uid: string) {
  const cleanedName = typeof name === "string" ? name.trim() : "";
  const cleanedEmail = typeof email === "string" ? email.trim() : "";
  if (cleanedName && cleanedEmail) return `${cleanedName} (${cleanedEmail})`;
  if (cleanedName) return cleanedName;
  if (cleanedEmail) return cleanedEmail;
  return uid;
}

function normalizeRoleLabel(roleRaw: string | null | undefined) {
  const role = String(roleRaw ?? "").trim().toLowerCase();
  if (role === "admin") return "Admin";
  if (role === "editor" || role === "member") return "Member with editor permissions";
  if (role === "viewer") return "Member with viewer permissions";
  if (role === "board_member") return "Board member with editor permissions";
  return role || "Member with editor permissions";
}

function normalizeRoleValue(roleRaw: string | null | undefined): MemberRole {
  const role = String(roleRaw ?? "").trim().toLowerCase();
  if (role === "admin") return "admin";
  if (role === "viewer") return "viewer";
  if (role === "board_member") return "board_member";
  return "editor";
}

export default function MembersPage() {
  const router = useRouter();
  const { user, loading, activeOrgId, me, orgs, authedFetch } = useAuth();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleDraftByUid, setRoleDraftByUid] = useState<Record<string, MemberRole>>({});
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, router, user]);

  useEffect(() => {
    async function loadMembers() {
      if (!user || !activeOrgId) {
        setBusy(false);
        return;
      }

      setBusy(true);
      setError(null);

      try {
        const res = await authedFetch("/api/org/members?limit=500");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Failed to load members");

        const parsed = Array.isArray(data?.members) ? (data.members as MemberRow[]) : [];
        setMembers(parsed);
        setRoleDraftByUid(() =>
          Object.fromEntries(parsed.map((member) => [member.uid, normalizeRoleValue(member.role)])),
        );
      } catch (e: unknown) {
        if (e instanceof Error) setError(e.message);
        else setError("Failed to load members");
      } finally {
        setBusy(false);
      }
    }

    void loadMembers();
  }, [activeOrgId, authedFetch, user]);

  const activeCount = useMemo(
    () => members.filter((m) => (m.status || "").toLowerCase() === "active").length,
    [members],
  );
  const activeOrgMembership = useMemo(
    () => orgs.find((org) => org.orgId === activeOrgId) ?? null,
    [activeOrgId, orgs],
  );
  const effectiveRole = activeOrgMembership?.role ?? me?.role ?? null;
  const canManageMembers = normalizeRoleValue(effectiveRole) === "admin";

  async function saveRole(uid: string) {
    const nextRole = roleDraftByUid[uid];
    if (!nextRole) return;

    setSavingUid(uid);
    setError(null);
    setMessage(null);
    try {
      const res = await authedFetch("/api/org/members", {
        method: "PATCH",
        body: JSON.stringify({ memberUid: uid, role: nextRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to update member role");
      }

      const updated = (data?.member ?? null) as MemberRow | null;
      if (updated && updated.uid) {
        setMembers((prev) => prev.map((member) => (member.uid === updated.uid ? updated : member)));
      }
      setMessage("Member role updated.");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to update member role");
    } finally {
      setSavingUid(null);
    }
  }

  if (loading || busy) {
    return (
      <main className="min-h-screen p-6 md:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="auth-card p-6">
            <p className="text-sm text-slate-600">Loading organization members...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!user) return null;

  if (!activeOrgId) {
    return (
      <main className="min-h-screen p-6 md:p-8">
        <div className="auth-card mx-auto max-w-3xl p-6">
          <h1 className="text-xl font-semibold text-slate-900">No organization selected</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign out and sign back in to load the correct organization context.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <p className="inline-flex items-center rounded-full border border-success-200 bg-success-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-success-700">
            Organization
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Team Members</h1>
          <p className="mt-1 text-sm text-slate-600">
            Organization roster with member roles and join timestamps.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {canManageMembers
              ? "You can update member roles from this page."
              : "You can view members here. Role updates are admin-only."}
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1">
                Total: <span className="font-semibold text-slate-800">{members.length}</span>
              </span>
              <span className="rounded-full border border-success-200 bg-success-50 px-3 py-1">
                Active: <span className="font-semibold text-slate-800">{activeCount}</span>
              </span>
            </div>
          </div>

          {error ? (
            <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}
          {message ? (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          {members.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-slate-600">No members found for this organization yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-semibold">Member</th>
                    <th className="px-4 py-3 font-semibold">Role</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.uid} className="border-b border-slate-100 text-sm last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {formatMemberIdentity(m.name, m.email, m.uid)}
                        </p>
                        {m.position ? <p className="text-xs text-slate-500">{m.position}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {canManageMembers ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={roleDraftByUid[m.uid] ?? normalizeRoleValue(m.role)}
                              onChange={(event) =>
                                setRoleDraftByUid((prev) => ({
                                  ...prev,
                                  [m.uid]: normalizeRoleValue(event.target.value),
                                }))
                              }
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                              aria-label={`Role for ${m.name || m.email || m.uid}`}
                            >
                              <option value="admin">Admin</option>
                              <option value="editor">Member with editor permissions</option>
                              <option value="board_member">Board member with editor permissions</option>
                              <option value="viewer">Member with viewer permissions</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => void saveRole(m.uid)}
                              disabled={savingUid === m.uid || (roleDraftByUid[m.uid] ?? normalizeRoleValue(m.role)) === normalizeRoleValue(m.role)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {savingUid === m.uid ? "Saving..." : "Save"}
                            </button>
                          </div>
                        ) : (
                          normalizeRoleLabel(m.role)
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{m.status || "active"}</td>
                      <td className="px-4 py-3 text-slate-700">{formatDateTime(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
