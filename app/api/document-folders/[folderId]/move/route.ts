import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";

const MAX_FOLDER_ID_LENGTH = 128;
const MOVE_FOLDER_LIMIT_PER_10_MIN = 180;

type MoveFolderBody = {
  parentFolderId?: unknown;
};

function normalizeFolderId(raw: unknown) {
  if (raw === null || typeof raw === "undefined") return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_FOLDER_ID_LENGTH) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
}

function normalizeRequiredFolderId(raw: string) {
  return normalizeFolderId(raw);
}

async function isDescendantTarget(args: {
  orgId: string;
  folderId: string;
  targetParentFolderId: string;
}) {
  const { orgId, folderId, targetParentFolderId } = args;
  const seen = new Set<string>();
  let cursor: string | null = targetParentFolderId;

  while (cursor) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);

    const folderSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documentFolders")
      .doc(cursor)
      .get();
    if (!folderSnap.exists) return false;
    const data = folderSnap.data() as { parentFolderId?: unknown } | undefined;
    cursor =
      typeof data?.parentFolderId === "string" && data.parentFolderId.trim()
        ? data.parentFolderId.trim()
        : null;
  }

  return false;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ folderId: string }> },
) {
  try {
    const { orgId, uid, email } = await requireDocumentWriteAccess(req);
    const { folderId: rawFolderId } = await context.params;
    const folderId = normalizeRequiredFolderId(rawFolderId);
    if (!folderId) {
      return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "document_folders_move_user",
      key: `${orgId}:${uid}`,
      limit: MOVE_FOLDER_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "document_folders_move_ip",
      key: getRequestIp(req),
      limit: MOVE_FOLDER_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as MoveFolderBody;
    const targetParentFolderId = normalizeFolderId(body?.parentFolderId);
    if (
      body?.parentFolderId !== null &&
      typeof body?.parentFolderId !== "undefined" &&
      !targetParentFolderId
    ) {
      return NextResponse.json({ error: "Invalid parentFolderId" }, { status: 400 });
    }
    if (targetParentFolderId && targetParentFolderId === folderId) {
      return NextResponse.json({ error: "Cannot move a folder into itself" }, { status: 400 });
    }

    const folderRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documentFolders")
      .doc(folderId);
    const folderSnap = await folderRef.get();
    if (!folderSnap.exists) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const currentData = folderSnap.data() as { parentFolderId?: unknown } | undefined;
    const currentParentFolderId =
      typeof currentData?.parentFolderId === "string" && currentData.parentFolderId.trim()
        ? currentData.parentFolderId.trim()
        : null;

    if (targetParentFolderId) {
      const targetParentSnap = await adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documentFolders")
        .doc(targetParentFolderId)
        .get();
      if (!targetParentSnap.exists) {
        return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
      }
      const invalidTarget = await isDescendantTarget({
        orgId,
        folderId,
        targetParentFolderId,
      });
      if (invalidTarget) {
        return NextResponse.json(
          { error: "Cannot move a folder into itself or one of its descendants" },
          { status: 400 },
        );
      }
    }

    if (currentParentFolderId === targetParentFolderId) {
      return NextResponse.json({ ok: true, folderId, parentFolderId: targetParentFolderId });
    }

    const now = new Date();
    await folderRef.set(
      {
        parentFolderId: targetParentFolderId,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.folder_moved",
      actorUid: uid,
      actorEmail: email,
      metadata: {
        folderId,
        fromParentFolderId: currentParentFolderId,
        toParentFolderId: targetParentFolderId,
      },
    });

    return NextResponse.json({
      ok: true,
      folderId,
      parentFolderId: targetParentFolderId,
      updatedAt: now.toISOString(),
      updatedBy: uid,
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

