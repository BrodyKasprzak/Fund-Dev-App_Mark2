import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import { CHUNKER_VERSION } from "@/lib/documentChunking";
import {
  normalizeAllowedMemberUids,
  normalizeDocumentAccessMode,
} from "@/lib/documentPermissions";
import {
  DOCX_MIME,
  DOCX_IMPORT_PIPELINE_PHASE_A,
  buildPendingRenderAssets,
  emptyVersionEditorPayload,
} from "@/lib/documents/versionMetadata";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const INIT_UPLOAD_LIMIT_PER_10_MIN = 80;
const MAX_FILENAME_LENGTH = 180;
const MAX_TITLE_LENGTH = 180;

const SUPPORTED_FILE_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
]);

type InitUploadBody = {
  filename?: unknown;
  title?: unknown;
  fileType?: unknown;
  size?: unknown;
  folderId?: unknown;
  docPermissions?: unknown;
};

type VersionMetadata = {
  version: number;
  storagePath: string;
  filename: string;
  originalFilename: string;
  fileType: string;
  size: number;
  status: "processing" | "ready" | "failed";
  source: "upload" | "edit" | "conversion";
  changeSummary: string | null;
  editorFormat: string | null;
  editorState: Record<string, unknown> | null;
  plainText: string | null;
  docxImportPipeline: string | null;
  renderAssets: ReturnType<typeof buildPendingRenderAssets>;
  createdAt: Date;
  createdBy: string;
};

type DocPermissionsInput = {
  accessMode?: unknown;
  allowedMemberUids?: unknown;
  ragEnabled?: unknown;
};

function sanitizeFilename(input: string) {
  const stripped = input
    .trim()
    .replace(/[\/\\]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[^\w.\- ()]/g, "_");

  const normalized = stripped.replace(/_+/g, "_");
  const finalName = normalized.slice(0, MAX_FILENAME_LENGTH).trim();
  return finalName || "file";
}

function deriveTitle(filename: string) {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const cleaned = noExt.trim().replace(/\s+/g, " ");
  return cleaned.slice(0, MAX_TITLE_LENGTH) || "Untitled Document";
}

function validFileType(fileType: string) {
  return SUPPORTED_FILE_TYPES.has(fileType);
}

function safeOriginalFilename(input: string) {
  return input.trim().slice(0, MAX_FILENAME_LENGTH) || "file";
}

function normalizeFolderId(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
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

export async function POST(req: Request) {
  try {
    const { orgId, uid, email } = await requireDocumentWriteAccess(req);

    await enforceRateLimit({
      scope: "documents_init_upload_user",
      key: `${orgId}:${uid}`,
      limit: INIT_UPLOAD_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_init_upload_ip",
      key: getRequestIp(req),
      limit: INIT_UPLOAD_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as InitUploadBody;

    const rawFilename =
      typeof body.filename === "string" ? body.filename : "";
    const rawFileType =
      typeof body.fileType === "string" ? body.fileType.trim() : "";
    const rawSize = Number(body.size);
    const rawTitle = typeof body.title === "string" ? body.title : "";

    if (
      typeof body.folderId !== "undefined" &&
      body.folderId !== null &&
      typeof body.folderId !== "string"
    ) {
      return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
    }
    if (
      typeof body.docPermissions !== "undefined" &&
      (body.docPermissions === null ||
        typeof body.docPermissions !== "object" ||
        Array.isArray(body.docPermissions))
    ) {
      return NextResponse.json({ error: "Invalid docPermissions" }, { status: 400 });
    }
    const folderId = normalizeFolderId(body.folderId);
    const requestedDocPermissions = (body.docPermissions || {}) as DocPermissionsInput;

    if (!rawFilename.trim()) {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }

    if (!Number.isFinite(rawSize) || rawSize <= 0 || rawSize > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `size must be between 1 and ${MAX_FILE_SIZE_BYTES} bytes` },
        { status: 400 },
      );
    }

    if (!rawFileType || !validFileType(rawFileType)) {
      return NextResponse.json(
        { error: "Unsupported file type" },
        { status: 400 },
      );
    }

    const originalFilename = safeOriginalFilename(rawFilename);
    const safeFilename = sanitizeFilename(rawFilename);
    const title = rawTitle.trim()
      ? rawTitle.trim().slice(0, MAX_TITLE_LENGTH)
      : deriveTitle(safeFilename);

    if (typeof body.folderId === "string" && body.folderId.trim() && !folderId) {
      return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
    }

    if (folderId) {
      const folderSnap = await adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documentFolders")
        .doc(folderId)
        .get();
      if (!folderSnap.exists) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
    }

    const accessMode = normalizeDocumentAccessMode(requestedDocPermissions.accessMode);
    const ragEnabled = requestedDocPermissions.ragEnabled !== false;
    const requestedAllowedMemberUids =
      accessMode === "restricted"
        ? normalizeAllowedMemberUids(requestedDocPermissions.allowedMemberUids)
        : [];
    const resolvedAllowedResult = await resolveActiveMemberUidsForAccess({
      orgId,
      requestedUids: requestedAllowedMemberUids,
    });
    if (!resolvedAllowedResult.ok) {
      return NextResponse.json({ error: resolvedAllowedResult.error }, { status: 400 });
    }
    const resolvedAllowedMemberUids = resolvedAllowedResult.uids || [];
    const allowedMemberUids = [...resolvedAllowedMemberUids];
    if (accessMode === "restricted" && !allowedMemberUids.includes(uid)) {
      allowedMemberUids.unshift(uid);
    }

    const docRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc();

    const docId = docRef.id;
    const storagePath = `organizations/${orgId}/documents/${docId}/v1/${safeFilename}`;
    const now = new Date();
    const currentVersion = 1;
    const versionMetadata: VersionMetadata = {
      version: currentVersion,
      storagePath,
      filename: safeFilename,
      originalFilename,
      fileType: rawFileType,
      size: rawSize,
      status: "processing",
      source: "upload",
      changeSummary: "Initial upload",
      ...emptyVersionEditorPayload(),
      docxImportPipeline: rawFileType === DOCX_MIME ? DOCX_IMPORT_PIPELINE_PHASE_A : null,
      renderAssets: buildPendingRenderAssets({
        storagePath,
        fileType: rawFileType,
      }),
      createdAt: now,
      createdBy: uid,
    };

    const versionRef = docRef.collection("versions").doc(`v${currentVersion}`);
    const batch = adminDb.batch();
    batch.set(docRef, {
      title,
      storagePath,
      fileType: rawFileType,
      size: rawSize,
      status: "processing",
      extractedText: null,
      textStatus: "pending",
      chunkStatus: "pending",
      chunkCount: 0,
      chunkVersion: CHUNKER_VERSION,
      textUpdatedAt: now,
      version: currentVersion,
      currentVersion,
      currentVersionNumber: currentVersion,
      originalStoragePath: storagePath,
      originalFileType: rawFileType,
      originalFilename,
      filename: safeFilename,
      folderId,
      docAccessMode: accessMode,
      docAllowedMemberUids: allowedMemberUids,
      docRagEnabled: ragEnabled,
      docPermissionsUpdatedAt: now,
      docPermissionsUpdatedBy: uid,
      editStatus: "processing",
      pendingVersion: null,
      lastVersionChangeAt: now,
      versionMeta: {
        current: currentVersion,
        items: {
          v1: versionMetadata,
        },
      },
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });
    batch.set(versionRef, {
      ...versionMetadata,
      promotedAt: null,
      promotedBy: null,
      updatedAt: now,
      updatedBy: uid,
    });
    await batch.commit();

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.init_upload",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        fileType: rawFileType,
        size: rawSize,
        version: currentVersion,
        filename: safeFilename,
        docAccessMode: accessMode,
        docRagEnabled: ragEnabled,
      },
    });

    return NextResponse.json({
      ok: true,
      docId,
      storagePath,
      document: {
        id: docId,
        title,
        storagePath,
        fileType: rawFileType,
        size: rawSize,
        status: "processing",
        textStatus: "pending",
        chunkStatus: "pending",
        chunkCount: 0,
        chunkVersion: CHUNKER_VERSION,
        version: currentVersion,
        folderId,
        docPermissions: {
          accessMode,
          allowedMemberUids,
          ragEnabled,
        },
        createdAt: now.toISOString(),
        createdBy: uid,
        textUpdatedAt: now.toISOString(),
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
