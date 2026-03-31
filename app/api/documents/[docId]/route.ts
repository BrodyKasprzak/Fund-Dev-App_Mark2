import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";

const UPDATE_LIMIT_PER_10_MIN = 120;
const DETAIL_LIMIT_PER_5_MIN = 240;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_TITLE_LENGTH = 180;
const MAX_DOC_ID_LENGTH = 128;
const DEFAULT_TEXT_LIMIT = 40_000;
const MAX_TEXT_LIMIT = 100_000;
const MAX_ANCHOR_QUERY_LENGTH = 120;
const ALLOWED_CLIENT_STATUSES = new Set(["ready", "failed"]);

const VALID_STATUSES = new Set(["ready", "processing", "failed"]);
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

type PatchBody = {
  title?: unknown;
  fileType?: unknown;
  size?: unknown;
  status?: unknown;
};

type DocumentRecord = {
  title?: unknown;
  storagePath?: unknown;
  fileType?: unknown;
  size?: unknown;
  status?: unknown;
  editStatus?: unknown;
  textStatus?: unknown;
  chunkStatus?: unknown;
  chunkCount?: unknown;
  chunkVersion?: unknown;
  extractedText?: unknown;
  version?: unknown;
  currentVersionNumber?: unknown;
  originalFilename?: unknown;
  filename?: unknown;
  createdAt?: FirestoreDateLike;
  createdBy?: unknown;
  textUpdatedAt?: FirestoreDateLike;
  chunkUpdatedAt?: FirestoreDateLike;
  updatedAt?: FirestoreDateLike;
  updatedBy?: unknown;
};

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type TextWindow = {
  offset: number;
  limit: number;
  returnedChars: number;
  totalChars: number;
  hasMore: boolean;
  nextOffset: number | null;
  anchoredQuery: string | null;
  matchOffset: number | null;
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

function isValidDocId(docId: string) {
  const trimmed = docId.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DOC_ID_LENGTH) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return true;
}

function parseOffset(raw: string | null) {
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function parseLimit(raw: string | null) {
  if (raw === null) return DEFAULT_TEXT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.max(1, Math.min(MAX_TEXT_LIMIT, Math.floor(parsed)));
}

function normalizeAnchorQuery(raw: string | null) {
  const q = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!q) return null;
  return q.slice(0, MAX_ANCHOR_QUERY_LENGTH);
}

async function getStorageObjectMetadata(storagePath: string) {
  const file = adminStorage.bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;

  const [metadata] = await file.getMetadata();
  return {
    size: Number(metadata.size),
    contentType: metadata.contentType || null,
  };
}

function buildTextChunk(args: {
  extractedText: string;
  offsetParam: number | null;
  limit: number;
  anchorQuery: string | null;
}): { extractedText: string | null; textWindow: TextWindow } {
  const { extractedText, offsetParam, limit, anchorQuery } = args;
  const totalChars = extractedText.length;
  if (totalChars === 0) {
    return {
      extractedText: null,
      textWindow: {
        offset: 0,
        limit,
        returnedChars: 0,
        totalChars: 0,
        hasMore: false,
        nextOffset: null,
        anchoredQuery: anchorQuery,
        matchOffset: null,
      },
    };
  }

  let matchOffset: number | null = null;
  let offset = Math.max(0, Math.min(offsetParam ?? 0, Math.max(totalChars - 1, 0)));

  if (anchorQuery) {
    const foundAt = extractedText.toLowerCase().indexOf(anchorQuery);
    if (foundAt >= 0) {
      matchOffset = foundAt;
      if (offsetParam === null) {
        offset = Math.max(0, foundAt - Math.floor(limit / 4));
      }
    }
  }

  const end = Math.min(totalChars, offset + limit);
  const chunk = extractedText.slice(offset, end);
  const hasMore = end < totalChars;

  return {
    extractedText: chunk || null,
    textWindow: {
      offset,
      limit,
      returnedChars: chunk.length,
      totalChars,
      hasMore,
      nextOffset: hasMore ? end : null,
      anchoredQuery: anchorQuery,
      matchOffset,
    },
  };
}

function serializeDocument(id: string, data: DocumentRecord | undefined) {
  const resolvedVersion =
    typeof data?.currentVersionNumber === "number" &&
    Number.isFinite(data.currentVersionNumber) &&
    data.currentVersionNumber > 0
      ? Math.floor(data.currentVersionNumber)
      : typeof data?.version === "number" && Number.isFinite(data.version) && data.version > 0
        ? Math.floor(data.version)
        : 1;

  return {
    id,
    title: typeof data?.title === "string" ? data.title : "Untitled",
    storagePath: typeof data?.storagePath === "string" ? data.storagePath : "",
    fileType:
      typeof data?.fileType === "string" ? data.fileType : "application/octet-stream",
    size: typeof data?.size === "number" ? data.size : 0,
    status: typeof data?.status === "string" ? data.status : "processing",
    textStatus: typeof data?.textStatus === "string" ? data.textStatus : "pending",
    chunkStatus: typeof data?.chunkStatus === "string" ? data.chunkStatus : "pending",
    editStatus:
      typeof data?.editStatus === "string" ? data.editStatus : "not_editable",
    chunkCount: typeof data?.chunkCount === "number" ? data.chunkCount : 0,
    chunkVersion: typeof data?.chunkVersion === "string" ? data.chunkVersion : null,
    version: resolvedVersion,
    currentVersionNumber: resolvedVersion,
    createdAt: toIso(data?.createdAt),
    createdBy: typeof data?.createdBy === "string" ? data.createdBy : null,
    textUpdatedAt: toIso(data?.textUpdatedAt),
    chunkUpdatedAt: toIso(data?.chunkUpdatedAt),
    updatedAt: toIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid, email } = await requireOrgContext(req);
    const { docId } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_detail_user",
      key: `${orgId}:${uid}`,
      limit: DETAIL_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_detail_ip",
      key: getRequestIp(req),
      limit: DETAIL_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const rawOffset = searchParams.get("offset");
    const rawLimit = searchParams.get("limit");
    const offsetParam = parseOffset(rawOffset);
    const limit = parseLimit(rawLimit);
    const anchorQuery = normalizeAnchorQuery(searchParams.get("q"));

    if (rawOffset !== null && offsetParam === null) {
      return NextResponse.json({ error: "offset must be a non-negative integer" }, { status: 400 });
    }

    if (rawLimit !== null && limit === null) {
      return NextResponse.json(
        { error: `limit must be an integer between 1 and ${MAX_TEXT_LIMIT}` },
        { status: 400 },
      );
    }

    const ref = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const data = snap.data() as DocumentRecord | undefined;
    const extractedText = typeof data?.extractedText === "string" ? data.extractedText : "";
    const { extractedText: extractedTextChunk, textWindow } = buildTextChunk({
      extractedText,
      offsetParam,
      limit: limit ?? DEFAULT_TEXT_LIMIT,
      anchorQuery,
    });

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.opened",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        offset: textWindow.offset,
        limit: textWindow.limit,
        returnedChars: textWindow.returnedChars,
      },
    });

    return NextResponse.json({
      ok: true,
      document: {
        ...serializeDocument(snap.id, data),
        extractedText: extractedTextChunk,
        textWindow,
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
    const { orgId, uid, email } = await requireOrgContext(req);
    const { docId } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_patch_user",
      key: `${orgId}:${uid}`,
      limit: UPDATE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_patch_ip",
      key: getRequestIp(req),
      limit: UPDATE_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as PatchBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const allowedKeys = new Set(["title", "fileType", "size", "status"]);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        return NextResponse.json({ error: `Field "${key}" is not allowed` }, { status: 400 });
      }
    }

    const ref = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const current = snap.data() as
      | {
          storagePath?: unknown;
          fileType?: unknown;
          size?: unknown;
          filename?: unknown;
          originalFilename?: unknown;
          status?: unknown;
          version?: unknown;
          currentVersionNumber?: unknown;
        }
      | undefined;

    const currentVersion =
      typeof current?.currentVersionNumber === "number" &&
      Number.isFinite(current.currentVersionNumber) &&
      current.currentVersionNumber > 0
        ? Math.floor(current.currentVersionNumber)
        : typeof current?.version === "number" && Number.isFinite(current.version) && current.version > 0
          ? Math.floor(current.version)
          : 1;

    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: uid,
      version: currentVersion,
      currentVersion,
      currentVersionNumber: currentVersion,
      "versionMeta.current": currentVersion,
    };

    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return NextResponse.json(
          { error: "title must be a non-empty string" },
          { status: 400 },
        );
      }
      patch.title = body.title.trim().slice(0, MAX_TITLE_LENGTH);
    }

    if ("status" in body) {
      if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
        return NextResponse.json(
          { error: "status must be one of: ready, processing, failed" },
          { status: 400 },
        );
      }

      if (!ALLOWED_CLIENT_STATUSES.has(body.status)) {
        return NextResponse.json(
          { error: "status can only be updated to ready or failed by client" },
          { status: 403 },
        );
      }

      if (body.status === "ready") {
        const storagePath =
          typeof current?.storagePath === "string" ? current.storagePath.trim() : "";
        if (!storagePath) {
          return NextResponse.json(
            { error: "Document is missing storagePath" },
            { status: 409 },
          );
        }

        const metadata = await getStorageObjectMetadata(storagePath);
        if (!metadata) {
          return NextResponse.json(
            { error: "Cannot mark ready: uploaded file not found in storage" },
            { status: 409 },
          );
        }

        if (!Number.isFinite(metadata.size) || metadata.size <= 0) {
          return NextResponse.json(
            { error: "Invalid storage object size" },
            { status: 409 },
          );
        }

        if (metadata.size > MAX_FILE_SIZE_BYTES) {
          return NextResponse.json(
            { error: `size must be between 1 and ${MAX_FILE_SIZE_BYTES} bytes` },
            { status: 409 },
          );
        }

        if (metadata.contentType && SUPPORTED_FILE_TYPES.has(metadata.contentType)) {
          patch.fileType = metadata.contentType;
          patch[`versionMeta.items.v${currentVersion}.fileType`] = metadata.contentType;
        }
        patch.size = metadata.size;
        patch[`versionMeta.items.v${currentVersion}.size`] = metadata.size;
        patch.lastVersionChangeAt = new Date();
        patch.originalStoragePath = storagePath;
        patch.originalFileType =
          typeof patch.fileType === "string"
            ? patch.fileType
            : typeof current?.fileType === "string"
              ? current.fileType
              : null;
        patch.editStatus =
          (typeof patch.fileType === "string" ? patch.fileType : current?.fileType) ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ? "ready"
            : "not_editable";
      }

      patch.status = body.status;
      patch[`versionMeta.items.v${currentVersion}.status`] = body.status;
    }

    if ("fileType" in body) {
      if (typeof body.fileType !== "string" || !SUPPORTED_FILE_TYPES.has(body.fileType)) {
        return NextResponse.json({ error: "Unsupported fileType" }, { status: 400 });
      }
      patch.fileType = body.fileType;
      patch[`versionMeta.items.v${currentVersion}.fileType`] = body.fileType;
    }

    if ("size" in body) {
      const size = Number(body.size);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `size must be between 1 and ${MAX_FILE_SIZE_BYTES} bytes` },
          { status: 400 },
        );
      }
      patch.size = size;
      patch[`versionMeta.items.v${currentVersion}.size`] = size;
    }

    await ref.set(patch, { merge: true });

    if (body.status === "ready") {
      const versionRef = ref.collection("versions").doc(`v${currentVersion}`);
      await versionRef.set(
        {
          version: currentVersion,
          status: "ready",
          fileType:
            typeof patch.fileType === "string"
              ? patch.fileType
              : typeof current?.fileType === "string"
                ? current.fileType
                : null,
          size:
            typeof patch.size === "number"
              ? patch.size
              : typeof current?.size === "number"
                ? current.size
                : null,
          filename:
            typeof current?.filename === "string" ? current.filename : null,
          originalFilename:
            typeof current?.originalFilename === "string"
              ? current.originalFilename
              : null,
          source: "upload",
          changeSummary: "Initial upload",
          promotedAt: new Date(),
          promotedBy: uid,
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );

      await writeOrgAuditLog({
        orgId,
        eventType: "documents.upload_finalized",
        actorUid: uid,
        actorEmail: email,
        docId,
        metadata: {
          version: currentVersion,
          size: typeof patch.size === "number" ? patch.size : null,
          fileType: typeof patch.fileType === "string" ? patch.fileType : null,
        },
      });
    }

    const updated = await ref.get();
    const data = updated.data() as DocumentRecord | undefined;

    return NextResponse.json({
      ok: true,
      document: serializeDocument(updated.id, data),
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
