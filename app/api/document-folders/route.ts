import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  requireDocumentReadAccess,
  requireDocumentWriteAccess,
  errorToResponse,
} from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";

const LIST_LIMIT = 250;
const SIBLING_SCAN_LIMIT = 1000;
const FOLDER_LIST_LIMIT_PER_5_MIN = 300;
const FOLDER_CREATE_LIMIT_PER_10_MIN = 120;
const MAX_FOLDER_NAME_LENGTH = 120;

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type CreateFolderBody = {
  name?: unknown;
  parentFolderId?: unknown;
};

function toIso(value: FirestoreDateLike) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

function normalizeFolderName(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FOLDER_NAME_LENGTH);
}

function normalizeFolderId(raw: unknown) {
  if (raw === null || typeof raw === "undefined") return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
}

export async function GET(req: Request) {
  try {
    const { orgId, uid } = await requireDocumentReadAccess(req);

    await enforceRateLimit({
      scope: "document_folders_list_user",
      key: `${orgId}:${uid}`,
      limit: FOLDER_LIST_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "document_folders_list_ip",
      key: getRequestIp(req),
      limit: FOLDER_LIST_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const snap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documentFolders")
      .orderBy("createdAt", "desc")
      .limit(LIST_LIMIT)
      .get();

    const folders = snap.docs.map((folderDoc) => {
      const data = folderDoc.data() as {
        name?: unknown;
        parentFolderId?: unknown;
        createdAt?: FirestoreDateLike;
        createdBy?: unknown;
        updatedAt?: FirestoreDateLike;
        updatedBy?: unknown;
      };

      return {
        id: folderDoc.id,
        name: typeof data.name === "string" ? data.name : "Untitled Folder",
        parentFolderId: typeof data.parentFolderId === "string" ? data.parentFolderId : null,
        createdAt: toIso(data.createdAt),
        createdBy: typeof data.createdBy === "string" ? data.createdBy : null,
        updatedAt: toIso(data.updatedAt),
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
      };
    });

    return NextResponse.json({ ok: true, folders });
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

export async function POST(req: Request) {
  try {
    const { orgId, uid, email } = await requireDocumentWriteAccess(req);

    await enforceRateLimit({
      scope: "document_folders_create_user",
      key: `${orgId}:${uid}`,
      limit: FOLDER_CREATE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "document_folders_create_ip",
      key: getRequestIp(req),
      limit: FOLDER_CREATE_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as CreateFolderBody;
    const folderName = normalizeFolderName(body?.name);
    if (!folderName) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const parentFolderId = normalizeFolderId(body?.parentFolderId);
    if (
      body?.parentFolderId !== null &&
      typeof body?.parentFolderId !== "undefined" &&
      !parentFolderId
    ) {
      return NextResponse.json({ error: "Invalid parentFolderId" }, { status: 400 });
    }

    if (parentFolderId) {
      const parentSnap = await adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documentFolders")
        .doc(parentFolderId)
        .get();
      if (!parentSnap.exists) {
        return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
      }
    }

    const folderNameLower = folderName.toLowerCase();
    const siblingSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documentFolders")
      .where("parentFolderId", "==", parentFolderId)
      .limit(SIBLING_SCAN_LIMIT)
      .get();
    const duplicateSibling = siblingSnap.docs.some((docSnap) => {
      const data = docSnap.data() as { nameLower?: unknown };
      return typeof data.nameLower === "string" && data.nameLower === folderNameLower;
    });
    let duplicateRootFromLegacyRecord = false;
    if (!parentFolderId && !duplicateSibling) {
      const legacyRootSnap = await adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documentFolders")
        .where("nameLower", "==", folderNameLower)
        .limit(25)
        .get();
      duplicateRootFromLegacyRecord = legacyRootSnap.docs.some((docSnap) => {
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
    const folderRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documentFolders")
      .doc();
    await folderRef.set({
      name: folderName,
      nameLower: folderNameLower,
      parentFolderId,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.folder_created",
      actorUid: uid,
      actorEmail: email,
      metadata: {
        folderId: folderRef.id,
        folderName,
        parentFolderId,
      },
    });

    return NextResponse.json({
      ok: true,
      folder: {
        id: folderRef.id,
        name: folderName,
        parentFolderId,
        createdAt: now.toISOString(),
        createdBy: uid,
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
