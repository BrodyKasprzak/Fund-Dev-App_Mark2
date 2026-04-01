import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import { ingestDocumentChunks } from "@/lib/documentChunkIngestion";
import {
  LEXICAL_EDITOR_FORMAT,
  buildPendingRenderAssets,
} from "@/lib/documents/versionMetadata";
import { generateAndStoreEditorExports } from "@/lib/documents/editorExports";

export const runtime = "nodejs";

const SAVE_EDITOR_LIMIT_PER_10_MIN = 120;
const MAX_DOC_ID_LENGTH = 128;
const MAX_CHANGE_SUMMARY_LENGTH = 500;
const MAX_EDITOR_STATE_BYTES = 700_000;
const MAX_PLAIN_TEXT_CHARS = 200_000;

type SaveEditorBody = {
  expectedCurrentVersion?: unknown;
  changeSummary?: unknown;
  editorFormat?: unknown;
  editorState?: unknown;
  plainText?: unknown;
};

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type PendingVersionRecord = {
  status?: unknown;
  version?: unknown;
};

type CurrentDocument = {
  title?: unknown;
  storagePath?: unknown;
  fileType?: unknown;
  size?: unknown;
  status?: unknown;
  filename?: unknown;
  originalFilename?: unknown;
  version?: unknown;
  currentVersionNumber?: unknown;
  pendingVersion?: unknown;
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

function normalizeChangeSummary(value: unknown) {
  if (typeof value !== "string") return null;
  const summary = value.trim().replace(/\s+/g, " ");
  if (!summary) return null;
  return summary.slice(0, MAX_CHANGE_SUMMARY_LENGTH);
}

function normalizePlainText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_PLAIN_TEXT_CHARS);
}

function parseEditorState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function POST(
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
      scope: "documents_version_save_editor_user",
      key: `${orgId}:${uid}`,
      limit: SAVE_EDITOR_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_version_save_editor_ip",
      key: getRequestIp(req),
      limit: SAVE_EDITOR_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as SaveEditorBody;
    const expectedCurrentVersion = normalizeVersion(body.expectedCurrentVersion, -1);
    if (expectedCurrentVersion < 1) {
      return NextResponse.json(
        { error: "expectedCurrentVersion is required and must be a positive integer" },
        { status: 400 },
      );
    }

    const changeSummary = normalizeChangeSummary(body.changeSummary);
    if (!changeSummary) {
      return NextResponse.json({ error: "changeSummary is required" }, { status: 400 });
    }

    const editorFormat =
      typeof body.editorFormat === "string" && body.editorFormat.trim()
        ? body.editorFormat.trim()
        : LEXICAL_EDITOR_FORMAT;
    if (editorFormat !== LEXICAL_EDITOR_FORMAT) {
      return NextResponse.json(
        { error: `editorFormat must be ${LEXICAL_EDITOR_FORMAT}` },
        { status: 400 },
      );
    }

    const editorState = parseEditorState(body.editorState);
    if (!editorState) {
      return NextResponse.json({ error: "editorState must be a JSON object" }, { status: 400 });
    }

    let editorStateJson = "";
    try {
      editorStateJson = JSON.stringify(editorState);
    } catch {
      return NextResponse.json(
        { error: "editorState must be JSON serializable" },
        { status: 400 },
      );
    }
    if (Buffer.byteLength(editorStateJson, "utf8") > MAX_EDITOR_STATE_BYTES) {
      return NextResponse.json(
        { error: `editorState exceeds ${MAX_EDITOR_STATE_BYTES} bytes` },
        { status: 400 },
      );
    }

    const plainText = normalizePlainText(body.plainText);
    const now = new Date();

    const docRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId);

    const transactionResult = await adminDb.runTransaction(async (tx) => {
      const docSnap = await tx.get(docRef);
      if (!docSnap.exists) {
        throw new HttpLikeError(404, "Document not found");
      }

      const data = (docSnap.data() ?? {}) as CurrentDocument;
      const currentVersion = normalizeVersion(
        data.currentVersionNumber,
        normalizeVersion(data.version, 1),
      );

      if (currentVersion !== expectedCurrentVersion) {
        throw new HttpLikeError(
          409,
          "Document changed since you opened it. Refresh and try again.",
        );
      }

      const docStatus = typeof data.status === "string" ? data.status : "processing";
      if (docStatus !== "ready") {
        throw new HttpLikeError(409, "Document is not ready for editing");
      }

      const pending =
        data.pendingVersion && typeof data.pendingVersion === "object"
          ? (data.pendingVersion as PendingVersionRecord)
          : null;
      if (pending && pending.status === "processing") {
        const pendingVersion = normalizeVersion(pending.version, currentVersion + 1);
        throw new HttpLikeError(
          409,
          `A version upload is already in progress (v${pendingVersion})`,
        );
      }

      const storagePath =
        typeof data.storagePath === "string" ? data.storagePath.trim() : "";
      if (!storagePath) {
        throw new HttpLikeError(409, "Document is missing storagePath");
      }
      if (!storagePath.startsWith(`organizations/${orgId}/documents/${docId}/`)) {
        throw new HttpLikeError(409, "Document storagePath is invalid");
      }

      const fileType =
        typeof data.fileType === "string" && data.fileType.trim()
          ? data.fileType
          : "application/octet-stream";
      const size =
        typeof data.size === "number" && Number.isFinite(data.size) && data.size >= 0
          ? data.size
          : 0;
      const filename =
        typeof data.filename === "string" && data.filename.trim()
          ? data.filename
          : "document";
      const originalFilename =
        typeof data.originalFilename === "string" && data.originalFilename.trim()
          ? data.originalFilename
          : filename;

      const nextVersion = currentVersion + 1;
      const versionRef = docRef.collection("versions").doc(`v${nextVersion}`);
      const renderAssets = buildPendingRenderAssets({
        storagePath,
        fileType,
      });

      tx.set(
        versionRef,
        {
          version: nextVersion,
          storagePath,
          filename,
          originalFilename,
          fileType,
          size,
          status: "ready",
          source: "edit",
          changeSummary,
          editorFormat,
          editorState,
          plainText,
          renderAssets,
          createdAt: now,
          createdBy: uid,
          promotedAt: now,
          promotedBy: uid,
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );

      tx.set(
        docRef,
        {
          status: "ready",
          editStatus: "ready",
          extractedText: plainText || null,
          textStatus: "ready",
          textUpdatedAt: now,
          chunkStatus: "processing",
          chunkCount: 0,
          version: nextVersion,
          currentVersion: nextVersion,
          currentVersionNumber: nextVersion,
          lastVersionChangeAt: now,
          pendingVersion: FieldValue.delete(),
          updatedAt: now,
          updatedBy: uid,
          "versionMeta.current": nextVersion,
          [`versionMeta.items.v${nextVersion}`]: {
            version: nextVersion,
            storagePath,
            filename,
            originalFilename,
            fileType,
            size,
            status: "ready",
            source: "edit",
            changeSummary,
            editorFormat,
            createdAt: now,
            createdBy: uid,
          },
        },
        { merge: true },
      );

      return {
        versionNumber: nextVersion,
        plainText,
        title: typeof data.title === "string" ? data.title : "Untitled",
        filename,
      };
    });

    const versionRef = docRef.collection("versions").doc(`v${transactionResult.versionNumber}`);
    const exportAssets = await generateAndStoreEditorExports({
      orgId,
      docId,
      versionNumber: transactionResult.versionNumber,
      title: transactionResult.title,
      filename: transactionResult.filename,
      editorState,
      plainText: transactionResult.plainText,
    });

    await versionRef.set(
      {
        renderAssets: exportAssets,
        updatedAt: new Date(),
        updatedBy: uid,
      },
      { merge: true },
    );
    await docRef.set(
      {
        [`versionMeta.items.v${transactionResult.versionNumber}.renderAssets`]: exportAssets,
        updatedAt: new Date(),
        updatedBy: uid,
      },
      { merge: true },
    );

    try {
      const ingested = await ingestDocumentChunks({
        orgId,
        docId,
        version: transactionResult.versionNumber,
        extractedText: transactionResult.plainText,
        actorUid: uid,
      });

      await docRef.set(
        {
          chunkStatus: "ready",
          chunkCount: ingested.chunkCount,
          chunkVersion: ingested.chunkVersion,
          chunkUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );
    } catch (chunkErr: unknown) {
      await docRef.set(
        {
          chunkStatus: "failed",
          chunkCount: 0,
          chunkUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );

      const errorReason =
        chunkErr instanceof Error ? chunkErr.message.slice(0, 320) : "Unknown chunking error";

      await writeOrgAuditLog({
        orgId,
        eventType: "documents.chunk_ingestion_failed",
        actorUid: uid,
        actorEmail: email,
        docId,
        metadata: {
          version: transactionResult.versionNumber,
          source: "editor",
          error: errorReason,
        },
      });

      return NextResponse.json(
        {
          error: `Version saved, but chunk ingestion failed: ${errorReason}`,
          versionSaved: true,
          versionNumber: transactionResult.versionNumber,
        },
        { status: 500 },
      );
    }

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.version_saved",
      actorUid: uid,
      actorEmail: email,
      docId,
        metadata: {
          source: "editor",
          previousVersion: expectedCurrentVersion,
          version: transactionResult.versionNumber,
          changeSummary,
          plainTextChars: transactionResult.plainText.length,
          exportDocxStatus: exportAssets.docx.status,
          exportPdfStatus: exportAssets.pdf.status,
        },
      });

    const updatedSnap = await docRef.get();
    const updated = (updatedSnap.data() ?? {}) as CurrentDocument;

    return NextResponse.json({
      ok: true,
      versionNumber: transactionResult.versionNumber,
      exports: exportAssets,
      document: {
        id: updatedSnap.id,
        title: typeof updated.title === "string" ? updated.title : "Untitled",
        storagePath: typeof updated.storagePath === "string" ? updated.storagePath : "",
        fileType:
          typeof updated.fileType === "string"
            ? updated.fileType
            : "application/octet-stream",
        size: typeof updated.size === "number" ? updated.size : 0,
        status: typeof updated.status === "string" ? updated.status : "ready",
        version: normalizeVersion(
          updated.currentVersionNumber,
          normalizeVersion(updated.version, 1),
        ),
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
