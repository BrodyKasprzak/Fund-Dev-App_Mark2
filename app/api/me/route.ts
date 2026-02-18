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

type UserRecord = {
  lastOrgId?: unknown;
  name?: unknown;
  position?: unknown;
};

type MembershipIndexRecord = {
  orgId?: unknown;
  role?: unknown;
  status?: unknown;
  orgName?: unknown;
};

type OrgMemberRecord = {
  role?: unknown;
  status?: unknown;
};

export async function GET(req: Request) {
  try {
    const { uid, email } = await requireAuth(req);

    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const user = (userSnap.data() as UserRecord | undefined) ?? {};

    const lastOrgId = asNonEmptyString(user.lastOrgId);

    // Membership index (fast path), re-validated against canonical org membership.
    const membershipsSnap = await userRef.collection("memberships").get();
    const indexedOrgs: OrgSummary[] = membershipsSnap.docs
      .map((d) => {
        const m = d.data() as MembershipIndexRecord;
        const orgId = asNonEmptyString(m.orgId) ?? d.id;
        if (!orgId) return null;
        return {
          orgId,
          role: asNonEmptyString(m.role) ?? "member",
          status: asNonEmptyString(m.status) ?? "active",
          name: asNonEmptyString(m.orgName),
        } satisfies OrgSummary;
      })
      .filter((item): item is OrgSummary => Boolean(item));

    const validated = await Promise.all(
      indexedOrgs.map(async (indexed) => {
        const memberSnap = await adminDb
          .collection("organizations")
          .doc(indexed.orgId)
          .collection("members")
          .doc(uid)
          .get();

        if (!memberSnap.exists) return null;
        const canonical = memberSnap.data() as OrgMemberRecord | undefined;
        return {
          orgId: indexed.orgId,
          role: asNonEmptyString(canonical?.role) ?? indexed.role,
          status: asNonEmptyString(canonical?.status) ?? indexed.status,
          name: indexed.name,
        } satisfies OrgSummary;
      }),
    );

    let orgs: OrgSummary[] = validated.filter((item): item is OrgSummary => Boolean(item));

    // Fallback for users not yet backfilled into users/{uid}/memberships/*
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

    const defaultOrgId =
      (lastOrgId && orgs.some((o) => o.orgId === lastOrgId) ? lastOrgId : null) ??
      (orgs.length === 1 ? orgs[0].orgId : null);

    const primary = defaultOrgId ? orgs.find((o) => o.orgId === defaultOrgId) : null;

    let org: { id: string; name: string | null } | null = null;
    if (defaultOrgId) {
      const orgSnap = await adminDb.collection("organizations").doc(defaultOrgId).get();
      const o = orgSnap.exists ? ((orgSnap.data() as { name?: unknown }) ?? {}) : {};
      org = { id: defaultOrgId, name: asNonEmptyString(o.name) };
    }

    return NextResponse.json({
      ok: true,
      me: {
        uid,
        email,
        orgId: org?.id ?? null,
        role: primary?.role ?? null,
        org,
        name: asNonEmptyString(user.name),
        position: asNonEmptyString(user.position),
      },
      orgs,
      defaultOrgId,
    });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
