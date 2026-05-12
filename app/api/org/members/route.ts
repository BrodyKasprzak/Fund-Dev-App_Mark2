import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  errorToResponse,
  requireMemberManageAccess,
  requireMemberReadAccess,
} from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { ORG_ROLES, normalizeOrgRole } from "@/lib/permissions";

export const runtime = "nodejs";
const MEMBERS_LIST_LIMIT_PER_10_MIN = 120;
const MEMBERS_LIST_IP_LIMIT_PER_10_MIN = 300;
const MEMBERS_UPDATE_LIMIT_PER_10_MIN = 90;
const MEMBERS_UPDATE_IP_LIMIT_PER_10_MIN = 180;
const VALID_MEMBER_STATUSES = new Set(["active", "inactive"]);

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

type UpdateMemberBody = {
  memberUid?: unknown;
  role?: unknown;
  status?: unknown;
};

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const dt = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  return null;
}

function parseMemberRoleForUpdate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const roleRaw = asString(value)?.toLowerCase();
  if (!roleRaw) return null;
  if (roleRaw === "member") return "editor";
  if ((ORG_ROLES as readonly string[]).includes(roleRaw)) return roleRaw;
  return null;
}

function parseMemberStatusForUpdate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const statusRaw = asString(value);
  if (!statusRaw) return null;
  const normalized = statusRaw.toLowerCase();
  if (!VALID_MEMBER_STATUSES.has(normalized)) return null;
  return normalized;
}

function serializeMemberRow(doc: FirebaseFirestore.QueryDocumentSnapshot): MemberRow {
  const m = doc.data() as Record<string, unknown>;
  return {
    uid: doc.id,
    email: asString(m.email),
    name: asString(m.name),
    position: asString(m.position),
    role: normalizeOrgRole(m.role),
    status: asString(m.status)?.toLowerCase() ?? "active",
    createdAt: toIsoDate(m.createdAt),
    updatedAt: toIsoDate(m.updatedAt),
  };
}

export async function GET(req: Request) {
  try {
    const { orgId, uid } = await requireMemberReadAccess(req);

    await enforceRateLimit({
      scope: "org_members_list_user",
      key: `${orgId}:${uid}`,
      limit: MEMBERS_LIST_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "org_members_list_ip",
      key: getRequestIp(req),
      limit: MEMBERS_LIST_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200;

    const membersSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("members")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const members: MemberRow[] = membersSnap.docs.map((d) => serializeMemberRow(d));

    return NextResponse.json({ ok: true, members });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }

    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const { orgId, uid } = await requireMemberManageAccess(req);

    await enforceRateLimit({
      scope: "org_members_update_user",
      key: `${orgId}:${uid}`,
      limit: MEMBERS_UPDATE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "org_members_update_ip",
      key: getRequestIp(req),
      limit: MEMBERS_UPDATE_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as UpdateMemberBody;
    const memberUid = asString(body.memberUid);
    if (!memberUid) {
      return NextResponse.json({ error: "memberUid is required" }, { status: 400 });
    }

    const nextRole = parseMemberRoleForUpdate(body.role);
    const nextStatus = parseMemberStatusForUpdate(body.status);
    if (nextRole === null) {
      return NextResponse.json(
        { error: `role must be one of: ${ORG_ROLES.join(", ")}` },
        { status: 400 },
      );
    }
    if (nextStatus === null) {
      return NextResponse.json(
        { error: "status must be one of: active, inactive" },
        { status: 400 },
      );
    }
    if (nextRole === undefined && nextStatus === undefined) {
      return NextResponse.json(
        { error: "At least one of role or status must be provided" },
        { status: 400 },
      );
    }

    const membersRef = adminDb.collection("organizations").doc(orgId).collection("members");
    const targetRef = membersRef.doc(memberUid);
    const actorRef = membersRef.doc(uid);
    const now = new Date();

    const updated = await adminDb.runTransaction(async (tx) => {
      const [actorSnap, targetSnap] = await Promise.all([tx.get(actorRef), tx.get(targetRef)]);
      if (!actorSnap.exists) throw new Error("Actor membership not found");
      if (!targetSnap.exists) throw new Error("Target member not found");

      const actorRole = normalizeOrgRole(actorSnap.data()?.role);
      if (actorRole !== "admin") {
        throw new Error("Admin only");
      }

      const targetData = targetSnap.data() ?? {};
      const currentRole = normalizeOrgRole(targetData.role);
      const currentStatus = asString(targetData.status)?.toLowerCase() ?? "active";
      const resolvedRole = nextRole ?? currentRole;
      const resolvedStatus = nextStatus ?? currentStatus;

      const roleChanging = resolvedRole !== currentRole;
      const statusChanging = resolvedStatus !== currentStatus;
      if (!roleChanging && !statusChanging) {
        return {
          uid: targetSnap.id,
          email: asString(targetData.email),
          name: asString(targetData.name),
          position: asString(targetData.position),
          role: currentRole,
          status: currentStatus,
          createdAt: toIsoDate(targetData.createdAt),
          updatedAt: toIsoDate(targetData.updatedAt),
        } satisfies MemberRow;
      }

      const demotingActiveAdmin =
        currentRole === "admin" &&
        currentStatus === "active" &&
        (resolvedRole !== "admin" || resolvedStatus !== "active");

      if (demotingActiveAdmin) {
        const adminsSnap = await tx.get(membersRef.where("role", "==", "admin"));
        const activeAdminCount = adminsSnap.docs.filter((doc) => {
          const data = doc.data();
          const status = asString(data.status)?.toLowerCase() ?? "active";
          return status === "active";
        }).length;

        if (activeAdminCount <= 1) {
          throw new Error("Cannot remove or demote the last active admin");
        }
      }

      const patch: Record<string, unknown> = {
        updatedAt: now,
        updatedBy: uid,
      };
      if (roleChanging) patch.role = resolvedRole;
      if (statusChanging) patch.status = resolvedStatus;
      tx.set(targetRef, patch, { merge: true });

      const userMembershipRef = adminDb
        .collection("users")
        .doc(memberUid)
        .collection("memberships")
        .doc(orgId);

      const userMembershipPatch: Record<string, unknown> = {
        updatedAt: now,
      };
      if (roleChanging) userMembershipPatch.role = resolvedRole;
      if (statusChanging) userMembershipPatch.status = resolvedStatus;
      tx.set(userMembershipRef, userMembershipPatch, { merge: true });

      return {
        uid: targetSnap.id,
        email: asString(targetData.email),
        name: asString(targetData.name),
        position: asString(targetData.position),
        role: resolvedRole,
        status: resolvedStatus,
        createdAt: toIsoDate(targetData.createdAt),
        updatedAt: now.toISOString(),
      } satisfies MemberRow;
    });

    return NextResponse.json({ ok: true, member: updated });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }

    const message = err instanceof Error ? err.message : null;
    if (message === "Target member not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (
      message === "Admin only" ||
      message === "Cannot remove or demote the last active admin"
    ) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    const { status, message: fallbackMessage } = errorToResponse(err);
    return NextResponse.json({ error: fallbackMessage }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const { orgId, uid } = await requireMemberManageAccess(req);

    await enforceRateLimit({
      scope: "org_members_remove_user",
      key: `${orgId}:${uid}`,
      limit: MEMBERS_UPDATE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "org_members_remove_ip",
      key: getRequestIp(req),
      limit: MEMBERS_UPDATE_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as UpdateMemberBody;
    const memberUid = asString(body.memberUid);
    if (!memberUid) {
      return NextResponse.json({ error: "memberUid is required" }, { status: 400 });
    }

    const membersRef = adminDb.collection("organizations").doc(orgId).collection("members");
    const targetRef = membersRef.doc(memberUid);
    const actorRef = membersRef.doc(uid);

    await adminDb.runTransaction(async (tx) => {
      const [actorSnap, targetSnap] = await Promise.all([tx.get(actorRef), tx.get(targetRef)]);
      if (!actorSnap.exists) throw new Error("Actor membership not found");
      if (!targetSnap.exists) throw new Error("Target member not found");

      const actorRole = normalizeOrgRole(actorSnap.data()?.role);
      if (actorRole !== "admin") {
        throw new Error("Admin only");
      }

      const targetData = targetSnap.data() ?? {};
      const currentRole = normalizeOrgRole(targetData.role);
      const currentStatus = asString(targetData.status)?.toLowerCase() ?? "active";
      const removingActiveAdmin = currentRole === "admin" && currentStatus === "active";

      if (removingActiveAdmin) {
        const adminsSnap = await tx.get(membersRef.where("role", "==", "admin"));
        const activeAdminCount = adminsSnap.docs.filter((doc) => {
          const data = doc.data();
          const status = asString(data.status)?.toLowerCase() ?? "active";
          return status === "active";
        }).length;
        if (activeAdminCount <= 1) {
          throw new Error("Cannot remove or demote the last active admin");
        }
      }

      tx.delete(targetRef);
      const userMembershipRef = adminDb
        .collection("users")
        .doc(memberUid)
        .collection("memberships")
        .doc(orgId);
      tx.delete(userMembershipRef);
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }

    const message = err instanceof Error ? err.message : null;
    if (message === "Target member not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (
      message === "Admin only" ||
      message === "Cannot remove or demote the last active admin"
    ) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    const { status, message: fallbackMessage } = errorToResponse(err);
    return NextResponse.json({ error: fallbackMessage }, { status });
  }
}
