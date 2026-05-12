import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  normalizeDocumentPermissions,
  userCanReadDocument,
} from "@/lib/documentPermissions";

export const runtime = "nodejs";

const DOC_MOVE_LIMIT_PER_10_MIN = 240;
const MAX_DOC_ID_LENGTH = 128;

type MoveDocumentBody = {
  folderId?: unknown;
};

function isValidDocId(docId: string) {
  const trimmed = docId.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DOC_ID_LENGTH) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return true;
}

function normalizeFolderId(raw: unknown) {
  if (raw === null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid, email, role } = await requireDocumentWriteAccess(req);
    const { docId } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_move_user",
      key: `${orgId}:${uid}`,
      limit: DOC_MOVE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_move_ip",
      key: getRequestIp(req),
      limit: DOC_MOVE_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as MoveDocumentBody;
    const targetFolderId = normalizeFolderId(body.folderId);
    if (body.folderId !== null && typeof body.folderId !== "undefined" && !targetFolderId) {
      return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
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
    if (
      !userCanReadDocument({
        permissions: normalizeDocumentPermissions(
          docSnap.data() as {
            docAccessMode?: unknown;
            docAllowedMemberUids?: unknown;
            docRagEnabled?: unknown;
            docPermissionsUpdatedBy?: unknown;
          },
        ),
        uid,
        role,
      })
    ) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const currentData = docSnap.data() as { folderId?: unknown } | undefined;
    const currentFolderId =
      typeof currentData?.folderId === "string" ? currentData.folderId : null;

    if (targetFolderId) {
      const folderSnap = await adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documentFolders")
        .doc(targetFolderId)
        .get();
      if (!folderSnap.exists) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
    }

    if (currentFolderId === targetFolderId) {
      return NextResponse.json({ ok: true, docId, folderId: targetFolderId });
    }

    await docRef.set(
      {
        folderId: targetFolderId,
        updatedAt: new Date(),
        updatedBy: uid,
      },
      { merge: true },
    );

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.moved_to_folder",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        fromFolderId: currentFolderId,
        toFolderId: targetFolderId,
      },
    });

    return NextResponse.json({ ok: true, docId, folderId: targetFolderId });
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
