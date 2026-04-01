import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminStorage } from "@/lib/firebaseAdmin";
import { requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  DOCX_MIME,
  buildRenderAssetsFromStoredFile,
  emptyVersionEditorPayload,
} from "@/lib/documents/versionMetadata";

export const runtime = "nodejs";

const FINALIZE_VERSION_LIMIT_PER_10_MIN = 120;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_DOC_ID_LENGTH = 128;
type FinalizeVersionBody = {
  versionNumber?: unknown;
  expectedCurrentVersion?: unknown;
};

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type PendingVersionRecord = {
  version?: unknown;
  storagePath?: unknown;
  filename?: unknown;
  originalFilename?: unknown;
  fileType?: unknown;
  size?: unknown;
  status?: unknown;
  source?: unknown;
  changeSummary?: unknown;
  createdAt?: unknown;
  createdBy?: unknown;
};

type CurrentDocument = {
  title?: unknown;
  storagePath?: unknown;
  status?: unknown;
  fileType?: unknown;
  size?: unknown;
  version?: unknown;
  currentVersionNumber?: unknown;
  pendingVersion?: unknown;
  versionMeta?: unknown;
  originalStoragePath?: unknown;
  originalFileType?: unknown;
  originalFilename?: unknown;
  updatedAt?: FirestoreDateLike;
};

class HttpLikeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isValidDocId(docId: string) {
  const trimmed = docId.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DOC_ID_LENGTH) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return true;
}

function normalizeVersion(value: unknown, fallback = 1) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function toIso(value: FirestoreDateLike) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

function parsePendingVersion(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return value as PendingVersionRecord;
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

export async function POST(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid, email } = await requireDocumentWriteAccess(req);
    const { docId } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_version_finalize_user",
      key: `${orgId}:${uid}`,
      limit: FINALIZE_VERSION_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_version_finalize_ip",
      key: getRequestIp(req),
      limit: FINALIZE_VERSION_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as FinalizeVersionBody;
    const requestedVersion = normalizeVersion(body.versionNumber, -1);
    const expectedCurrentVersion =
      body.expectedCurrentVersion === undefined
        ? null
        : normalizeVersion(body.expectedCurrentVersion, -1);

    if (requestedVersion < 1) {
      return NextResponse.json({ error: "versionNumber is required" }, { status: 400 });
    }
    if (expectedCurrentVersion !== null && expectedCurrentVersion < 1) {
      return NextResponse.json(
        { error: "expectedCurrentVersion must be a positive integer" },
        { status: 400 },
      );
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

    const current = (docSnap.data() ?? {}) as CurrentDocument;
    const currentVersion = normalizeVersion(
      current.currentVersionNumber,
      normalizeVersion(current.version, 1),
    );

    if (expectedCurrentVersion !== null && expectedCurrentVersion !== currentVersion) {
      return NextResponse.json(
        { error: "Document changed since you opened it. Refresh and try again." },
        { status: 409 },
      );
    }

    const pending = parsePendingVersion(current.pendingVersion);
    const pendingVersionNumber = normalizeVersion(pending?.version, -1);
    if (!pending || pendingVersionNumber !== requestedVersion) {
      return NextResponse.json(
        { error: "No matching pending version upload found" },
        { status: 409 },
      );
    }

    if (pending.createdBy && pending.createdBy !== uid) {
      return NextResponse.json(
        { error: "Only the uploader can finalize this pending version" },
        { status: 403 },
      );
    }

    const storagePath =
      typeof pending.storagePath === "string" ? pending.storagePath.trim() : "";
    if (!storagePath) {
      return NextResponse.json(
        { error: "Pending version is missing storagePath" },
        { status: 409 },
      );
    }
    if (!storagePath.startsWith(`organizations/${orgId}/documents/${docId}/`)) {
      return NextResponse.json(
        { error: "Pending version storagePath is invalid" },
        { status: 409 },
      );
    }

    const metadata = await getStorageObjectMetadata(storagePath);
    if (!metadata) {
      return NextResponse.json(
        { error: "Cannot finalize version: uploaded file not found in storage" },
        { status: 409 },
      );
    }
    if (!Number.isFinite(metadata.size) || metadata.size <= 0 || metadata.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `size must be between 1 and ${MAX_FILE_SIZE_BYTES} bytes` },
        { status: 409 },
      );
    }

    const contentType = metadata.contentType || DOCX_MIME;
    if (contentType !== DOCX_MIME) {
      return NextResponse.json(
        { error: "Only DOCX versions can be finalized in this phase" },
        { status: 409 },
      );
    }

    const filename =
      typeof pending.filename === "string" && pending.filename.trim()
        ? pending.filename
        : "document.docx";
    const originalFilename =
      typeof pending.originalFilename === "string" && pending.originalFilename.trim()
        ? pending.originalFilename
        : filename;
    const changeSummary =
      typeof pending.changeSummary === "string" ? pending.changeSummary : null;
    const source = typeof pending.source === "string" ? pending.source : "edit";
    const now = new Date();
    const renderAssets = buildRenderAssetsFromStoredFile({
      storagePath,
      fileType: DOCX_MIME,
      now,
    });

    await adminDb.runTransaction(async (tx) => {
      const freshSnap = await tx.get(docRef);
      if (!freshSnap.exists) {
        throw new HttpLikeError(404, "Document not found");
      }
      const fresh = (freshSnap.data() ?? {}) as CurrentDocument;
      const freshCurrentVersion = normalizeVersion(
        fresh.currentVersionNumber,
        normalizeVersion(fresh.version, 1),
      );
      const freshPending = parsePendingVersion(fresh.pendingVersion);
      const freshPendingVersion = normalizeVersion(freshPending?.version, -1);

      if (expectedCurrentVersion !== null && expectedCurrentVersion !== freshCurrentVersion) {
        throw new HttpLikeError(
          409,
          "Document changed since you opened it. Refresh and try again.",
        );
      }
      if (!freshPending || freshPendingVersion !== requestedVersion) {
        throw new HttpLikeError(409, "No matching pending version upload found");
      }

      const versionRef = docRef.collection("versions").doc(`v${requestedVersion}`);
      tx.set(
        versionRef,
        {
          version: requestedVersion,
          storagePath,
          filename,
          originalFilename,
          fileType: DOCX_MIME,
          size: metadata.size,
          status: "ready",
          source,
          changeSummary,
          ...emptyVersionEditorPayload(),
          renderAssets,
          promotedAt: now,
          promotedBy: uid,
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );

      const versionMetaPatch: Record<string, unknown> = {
        version: requestedVersion,
        storagePath,
        filename,
        originalFilename,
        fileType: DOCX_MIME,
        size: metadata.size,
        status: "ready",
        source,
        changeSummary,
        ...emptyVersionEditorPayload(),
        renderAssets,
        createdAt: now,
        createdBy: uid,
      };

      tx.set(
        docRef,
        {
          storagePath,
          fileType: DOCX_MIME,
          size: metadata.size,
          status: "ready",
          editStatus: "ready",
          extractedText: null,
          textStatus: "pending",
          chunkStatus: "pending",
          chunkCount: 0,
          version: requestedVersion,
          currentVersion: requestedVersion,
          currentVersionNumber: requestedVersion,
          filename,
          lastVersionChangeAt: now,
          pendingVersion: FieldValue.delete(),
          updatedAt: now,
          updatedBy: uid,
          "versionMeta.current": requestedVersion,
          [`versionMeta.items.v${requestedVersion}`]: versionMetaPatch,
        },
        { merge: true },
      );
    });

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.version_saved",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        previousVersion: currentVersion,
        version: requestedVersion,
        size: metadata.size,
        fileType: DOCX_MIME,
        changeSummary: changeSummary || null,
      },
    });

    const updatedSnap = await docRef.get();
    const updated = (updatedSnap.data() ?? {}) as CurrentDocument;

    return NextResponse.json({
      ok: true,
      versionNumber: requestedVersion,
      document: {
        id: updatedSnap.id,
        title: typeof updated.title === "string" ? updated.title : "Untitled",
        storagePath: typeof updated.storagePath === "string" ? updated.storagePath : "",
        fileType: typeof updated.fileType === "string" ? updated.fileType : DOCX_MIME,
        size: typeof updated.size === "number" ? updated.size : metadata.size,
        status: typeof updated.status === "string" ? updated.status : "ready",
        version: normalizeVersion(updated.currentVersionNumber, normalizeVersion(updated.version, 1)),
        updatedAt: toIso(updated.updatedAt),
      },
    });
  } catch (err: unknown) {
    if (err instanceof HttpLikeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
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
