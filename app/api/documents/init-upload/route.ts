import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import { CHUNKER_VERSION } from "@/lib/documentChunking";

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
};

type VersionMetadata = {
  version: number;
  storagePath: string;
  filename: string;
  originalFilename: string;
  fileType: string;
  size: number;
  status: "processing" | "ready" | "failed";
  createdAt: Date;
  createdBy: string;
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

export async function POST(req: Request) {
  try {
    const { orgId, uid, email } = await requireOrgContext(req);

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
      createdAt: now,
      createdBy: uid,
    };

    await docRef.set({
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
      originalFilename,
      filename: safeFilename,
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
