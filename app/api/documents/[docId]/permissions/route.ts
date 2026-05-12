import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentReadAccess, requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  normalizeAllowedMemberUids,
  normalizeDocumentAccessMode,
  normalizeDocumentPermissions,
  userCanReadDocument,
} from "@/lib/documentPermissions";

export const runtime = "nodejs";

const DOC_PERMISSION_READ_LIMIT_PER_5_MIN = 240;
const DOC_PERMISSION_UPDATE_LIMIT_PER_10_MIN = 120;
const MAX_DOC_ID_LENGTH = 128;

type UpdateDocPermissionsBody = {
  accessMode?: unknown;
  allowedMemberUids?: unknown;
  ragEnabled?: unknown;
};

type DocumentRecord = {
  title?: unknown;
  docAccessMode?: unknown;
  docAllowedMemberUids?: unknown;
  docRagEnabled?: unknown;
  docPermissionsUpdatedAt?: unknown;
  docPermissionsUpdatedBy?: unknown;
};

function isValidDocId(docId: string) {
  const trimmed = docId.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DOC_ID_LENGTH) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return true;
}

async function resolveActiveMemberUidsForAccess(args: {
  orgId: string;
  requestedUids: string[];
}) {
  const { orgId, requestedUids } = args;
  if (requestedUids.length === 0) return { ok: true, uids: [] as string[] };

  const membersRef = adminDb.collection("organizations").doc(orgId).collection("members");
  const refs = requestedUids.map((memberUid) => membersRef.doc(memberUid));
  const snaps = await adminDb.getAll(...refs);

  const allowed: string[] = [];
  for (let idx = 0; idx < snaps.length; idx += 1) {
    const snap = snaps[idx];
    const requestedUid = requestedUids[idx];
    if (!snap.exists) {
      return { ok: false, error: "allowedMemberUids must only include valid org members" };
    }
    const data = snap.data() as { status?: unknown } | undefined;
    const status =
      typeof data?.status === "string" ? data.status.trim().toLowerCase() : "active";
    if (status !== "active") {
      return { ok: false, error: "allowedMemberUids must only include active org members" };
    }
    allowed.push(requestedUid);
  }

  return { ok: true, uids: allowed };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid, role } = await requireDocumentReadAccess(req);
    const { docId } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_permissions_get_user",
      key: `${orgId}:${uid}`,
      limit: DOC_PERMISSION_READ_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_permissions_get_ip",
      key: getRequestIp(req),
      limit: DOC_PERMISSION_READ_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const docRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const data = (docSnap.data() ?? {}) as DocumentRecord;
    const docPermissions = normalizeDocumentPermissions(data);
    if (!userCanReadDocument({ permissions: docPermissions, uid, role })) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      docId,
      title: typeof data.title === "string" ? data.title : "Untitled",
      docPermissions: {
        accessMode: docPermissions.accessMode,
        allowedMemberUids: docPermissions.allowedMemberUids,
        ragEnabled: docPermissions.ragEnabled,
      },
    });
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

export async function PATCH(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid, email, role } = await requireDocumentWriteAccess(req);
    const { docId } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }
    if (role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    await enforceRateLimit({
      scope: "documents_permissions_patch_user",
      key: `${orgId}:${uid}`,
      limit: DOC_PERMISSION_UPDATE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_permissions_patch_ip",
      key: getRequestIp(req),
      limit: DOC_PERMISSION_UPDATE_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as UpdateDocPermissionsBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const docRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const current = (docSnap.data() ?? {}) as DocumentRecord;
    const currentPermissions = normalizeDocumentPermissions(current);

    const nextAccessMode =
      typeof body.accessMode === "undefined"
        ? currentPermissions.accessMode
        : normalizeDocumentAccessMode(body.accessMode);

    if (typeof body.ragEnabled !== "undefined" && typeof body.ragEnabled !== "boolean") {
      return NextResponse.json({ error: "ragEnabled must be boolean" }, { status: 400 });
    }
    const nextRagEnabled =
      typeof body.ragEnabled === "boolean" ? body.ragEnabled : currentPermissions.ragEnabled;

    if (
      typeof body.allowedMemberUids !== "undefined" &&
      !Array.isArray(body.allowedMemberUids)
    ) {
      return NextResponse.json({ error: "allowedMemberUids must be an array" }, { status: 400 });
    }

    const requestedAllowed =
      typeof body.allowedMemberUids === "undefined"
        ? currentPermissions.allowedMemberUids
        : normalizeAllowedMemberUids(body.allowedMemberUids);

    const resolvedAllowedResult = await resolveActiveMemberUidsForAccess({
      orgId,
      requestedUids: requestedAllowed,
    });
    if (!resolvedAllowedResult.ok) {
      return NextResponse.json({ error: resolvedAllowedResult.error }, { status: 400 });
    }
    const resolvedAllowedMemberUids = resolvedAllowedResult.uids || [];

    const nextAllowedMemberUids =
      nextAccessMode === "restricted" ? resolvedAllowedMemberUids : [];
    const now = new Date();

    await docRef.set(
      {
        docAccessMode: nextAccessMode,
        docAllowedMemberUids: nextAllowedMemberUids,
        docRagEnabled: nextRagEnabled,
        docPermissionsUpdatedAt: now,
        docPermissionsUpdatedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.permissions_updated",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        accessMode: nextAccessMode,
        ragEnabled: nextRagEnabled,
        allowedMemberCount: nextAllowedMemberUids.length,
      },
    });

    return NextResponse.json({
      ok: true,
      docId,
      docPermissions: {
        accessMode: nextAccessMode,
        allowedMemberUids: nextAllowedMemberUids,
        ragEnabled: nextRagEnabled,
      },
    });
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
