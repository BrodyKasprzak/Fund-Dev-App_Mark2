import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";

const MAX_FOLDER_NAME_LENGTH = 120;
const MAX_FOLDER_ID_LENGTH = 128;
const RENAME_FOLDER_LIMIT_PER_10_MIN = 180;
const SIBLING_SCAN_LIMIT = 1000;
const LEGACY_ROOT_DUPLICATE_SCAN_LIMIT = 25;

type RenameFolderBody = {
  name?: unknown;
};

function normalizeFolderId(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_FOLDER_ID_LENGTH) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
}

function normalizeFolderName(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FOLDER_NAME_LENGTH);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ folderId: string }> },
) {
  try {
    const { orgId, uid, email } = await requireDocumentWriteAccess(req);
    const { folderId: rawFolderId } = await context.params;
    const folderId = normalizeFolderId(rawFolderId);
    if (!folderId) {
      return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "document_folders_rename_user",
      key: `${orgId}:${uid}`,
      limit: RENAME_FOLDER_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "document_folders_rename_ip",
      key: getRequestIp(req),
      limit: RENAME_FOLDER_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as RenameFolderBody;
    const nextName = normalizeFolderName(body?.name);
    if (!nextName) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
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

    const folderData = folderSnap.data() as { name?: unknown; parentFolderId?: unknown } | undefined;
    const currentName = typeof folderData?.name === "string" ? folderData.name : "Untitled Folder";
    const parentFolderId =
      typeof folderData?.parentFolderId === "string" && folderData.parentFolderId.trim()
        ? folderData.parentFolderId.trim()
        : null;
    const nextNameLower = nextName.toLowerCase();
    const currentNameLower = currentName.trim().toLowerCase();

    if (nextNameLower === currentNameLower) {
      return NextResponse.json({
        ok: true,
        folder: {
          id: folderId,
          name: currentName,
          parentFolderId,
        },
      });
    }

    const siblingSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documentFolders")
      .where("parentFolderId", "==", parentFolderId)
      .limit(SIBLING_SCAN_LIMIT)
      .get();
    const duplicateSibling = siblingSnap.docs.some((docSnap) => {
      if (docSnap.id === folderId) return false;
      const data = docSnap.data() as { nameLower?: unknown };
      return typeof data.nameLower === "string" && data.nameLower === nextNameLower;
    });
    let duplicateRootFromLegacyRecord = false;
    if (!parentFolderId && !duplicateSibling) {
      const legacyRootSnap = await adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documentFolders")
        .where("nameLower", "==", nextNameLower)
        .limit(LEGACY_ROOT_DUPLICATE_SCAN_LIMIT)
        .get();
      duplicateRootFromLegacyRecord = legacyRootSnap.docs.some((docSnap) => {
        if (docSnap.id === folderId) return false;
        const data = docSnap.data() as { parentFolderId?: unknown };
        return (
          typeof data.parentFolderId === "undefined" ||
          data.parentFolderId === null ||
          (typeof data.parentFolderId === "string" && !data.parentFolderId.trim())
        );
      });
    }

    if (duplicateSibling || duplicateRootFromLegacyRecord) {
      return NextResponse.json(
        { error: "A folder with this name already exists in this location" },
        { status: 409 },
      );
    }

    const now = new Date();
    await folderRef.set(
      {
        name: nextName,
        nameLower: nextNameLower,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.folder_renamed",
      actorUid: uid,
      actorEmail: email,
      metadata: {
        folderId,
        previousName: currentName,
        nextName,
        parentFolderId,
      },
    });

    return NextResponse.json({
      ok: true,
      folder: {
        id: folderId,
        name: nextName,
        parentFolderId,
        updatedAt: now.toISOString(),
        updatedBy: uid,
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
