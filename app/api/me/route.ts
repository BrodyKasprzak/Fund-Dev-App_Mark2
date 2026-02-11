import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

type OrgSummary = {
  orgId: string;
  role: string;
  status: string;
  name: string | null;
};

export async function GET(req: Request) {
  try {
    const { uid, email } = await requireAuth(req);

    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const user = (userSnap.data() as any) ?? {};

    const lastOrgId = asNonEmptyString(user?.lastOrgId);

    // membership index (recommended)
    const membershipsSnap = await userRef.collection("memberships").get();

    let orgs: OrgSummary[] = membershipsSnap.docs
      .map((d) => {
        const m = d.data() as any;
        const orgId = asNonEmptyString(m.orgId) ?? d.id;
        if (!orgId) return null;

        return {
          orgId,
          role: asNonEmptyString(m.role) ?? "member",
          status: asNonEmptyString(m.status) ?? "active",
          name: asNonEmptyString(m.orgName),
        } as OrgSummary;
      })
      .filter(Boolean) as OrgSummary[];

    // ✅ Fallback for existing users not yet backfilled into users/{uid}/memberships/*
    // If lastOrgId exists, verify canonical membership and add it to orgs list.
    if (orgs.length === 0 && lastOrgId) {
      const memberSnap = await adminDb
        .collection("organizations")
        .doc(lastOrgId)
        .collection("members")
        .doc(uid)
        .get();

      if (memberSnap.exists) {
        orgs = [
          {
            orgId: lastOrgId,
            role: asNonEmptyString(memberSnap.data()?.role) ?? "member",
            status: asNonEmptyString(memberSnap.data()?.status) ?? "active",
            name: null,
          },
        ];
      }
    }

    // Choose a default org:
    // 1) lastOrgId if it’s in orgs
    // 2) if only one org, use it
    // 3) else null
    const defaultOrgId =
      (lastOrgId && orgs.some((o) => o.orgId === lastOrgId) ? lastOrgId : null) ??
      (orgs.length === 1 ? orgs[0].orgId : null);

    // For backward compatibility with your AuthContext.Me shape:
    const primary = defaultOrgId ? orgs.find((o) => o.orgId === defaultOrgId) : null;

    // Authoritative org name (primary org only)
    let org: { id: string; name: string | null } | null = null;
    if (defaultOrgId) {
      const orgSnap = await adminDb.collection("organizations").doc(defaultOrgId).get();
      const o = orgSnap.exists ? ((orgSnap.data() as any) ?? {}) : {};
      org = { id: defaultOrgId, name: asNonEmptyString(o?.name) };
    }

    return NextResponse.json({
      ok: true,
      me: {
        uid,
        email,
        orgId: org?.id ?? null,
        role: primary?.role ?? null,
        org,
        name: user?.name ?? null,
        position: user?.position ?? null,
      },
      orgs,
      defaultOrgId,
    });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}



