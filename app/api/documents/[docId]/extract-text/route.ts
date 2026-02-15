import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import { ingestDocumentChunks } from "@/lib/documentChunkIngestion";

export const runtime = "nodejs";

const EXTRACT_LIMIT_PER_10_MIN = 40;
const MAX_EXTRACTED_TEXT_CHARS = 200_000;
const MAX_DOC_ID_LENGTH = 128;

const SUPPORTED_EXTRACT_FILE_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
]);

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

function toIso(value: FirestoreDateLike) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

function normalizeText(raw: string) {
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

async function extractText(buffer: Buffer, fileType: string) {
  if (fileType === "application/pdf") {
    const pdfModule = await import("pdf-parse");
    const parsePdf = (pdfModule.default ?? pdfModule) as (
      dataBuffer: Buffer,
    ) => Promise<{ text?: string }>;
    const parsed = await parsePdf(buffer);
    return parsed.text ?? "";
  }

  if (
    fileType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammothModule = await import("mammoth");
    const mammoth = (mammothModule.default ?? mammothModule) as {
      extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
    };
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value ?? "";
  }

  if (fileType === "text/plain" || fileType === "text/csv") {
    return buffer.toString("utf8");
  }

  throw new Error("Unsupported file type for extraction");
}

function isValidDocId(docId: string) {
  const trimmed = docId.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DOC_ID_LENGTH) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return true;
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
      scope: "documents_extract_text_user",
      key: `${orgId}:${uid}`,
      limit: EXTRACT_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_extract_text_ip",
      key: getRequestIp(req),
      limit: EXTRACT_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
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

    const current = docSnap.data() as
      | {
          title?: unknown;
          storagePath?: unknown;
          fileType?: unknown;
          size?: unknown;
          status?: unknown;
          textStatus?: unknown;
          chunkStatus?: unknown;
          chunkCount?: unknown;
          chunkVersion?: unknown;
          version?: unknown;
          createdAt?: FirestoreDateLike;
          createdBy?: unknown;
          textUpdatedAt?: FirestoreDateLike;
          chunkUpdatedAt?: FirestoreDateLike;
          updatedAt?: FirestoreDateLike;
          updatedBy?: unknown;
        }
      | undefined;

    const storagePath =
      typeof current?.storagePath === "string" ? current.storagePath.trim() : "";
    const fileType = typeof current?.fileType === "string" ? current.fileType : "";
    const uploadStatus = typeof current?.status === "string" ? current.status : "processing";

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.extract_text_requested",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        status: uploadStatus,
        fileType: fileType || null,
      },
    });

    if (uploadStatus !== "ready") {
      return NextResponse.json(
        { error: "Document upload is not finalized yet" },
        { status: 409 },
      );
    }

    if (!storagePath || !fileType) {
      await docRef.set(
        {
          textStatus: "failed",
          chunkStatus: "failed",
          textUpdatedAt: new Date(),
          chunkUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );
      return NextResponse.json(
        { error: "Document is missing storagePath or fileType" },
        { status: 409 },
      );
    }

    if (!SUPPORTED_EXTRACT_FILE_TYPES.has(fileType)) {
      await docRef.set(
        {
          textStatus: "failed",
          chunkStatus: "failed",
          textUpdatedAt: new Date(),
          chunkUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );
      return NextResponse.json(
        { error: "Unsupported file type for extraction" },
        { status: 400 },
      );
    }

    const bucket = adminStorage.bucket();
    const fileRef = bucket.file(storagePath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      await docRef.set(
        {
          textStatus: "failed",
          chunkStatus: "failed",
          textUpdatedAt: new Date(),
          chunkUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );
      return NextResponse.json(
        { error: "Stored file was not found" },
        { status: 409 },
      );
    }

    await docRef.set(
      {
        textStatus: "processing",
        chunkStatus: "processing",
        textUpdatedAt: new Date(),
        chunkUpdatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: uid,
      },
      { merge: true },
    );

    try {
      const [buffer] = await fileRef.download();
      const extractedText = normalizeText(await extractText(buffer, fileType));
      const version =
        typeof current?.version === "number" && Number.isFinite(current.version)
          ? Math.max(1, Math.floor(current.version))
          : 1;

      await docRef.set(
        {
          extractedText: extractedText || null,
          textStatus: "ready",
          textUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );

      try {
        const ingested = await ingestDocumentChunks({
          orgId,
          docId,
          version,
          extractedText,
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

        await writeOrgAuditLog({
          orgId,
          eventType: "documents.chunk_ingestion_completed",
          actorUid: uid,
          actorEmail: email,
          docId,
          metadata: {
            version: ingested.version,
            chunkCount: ingested.chunkCount,
            totalChars: ingested.totalChars,
            totalTokensEstimate: ingested.totalTokensEstimate,
            chunkVersion: ingested.chunkVersion,
          },
        });
      } catch (chunkErr: unknown) {
        await docRef.set(
          {
            chunkStatus: "failed",
            chunkUpdatedAt: new Date(),
            updatedAt: new Date(),
            updatedBy: uid,
          },
          { merge: true },
        );

        await writeOrgAuditLog({
          orgId,
          eventType: "documents.chunk_ingestion_failed",
          actorUid: uid,
          actorEmail: email,
          docId,
          metadata: {
            version,
          },
        });

        const missingSchema =
          chunkErr instanceof Error &&
          (chunkErr.message.includes("code=PGRST202") ||
            chunkErr.message.includes("relation \"document_chunks\" does not exist"));
        const errorReason =
          chunkErr instanceof Error
            ? chunkErr.message.slice(0, 320)
            : "Unknown ingestion error";

        return NextResponse.json(
          {
            error: missingSchema
              ? "Chunk ingestion failed: Supabase RAG schema is missing. Run supabase/sql/rag_setup.sql."
              : `Chunk ingestion failed: ${errorReason}`,
          },
          { status: 500 },
        );
      }
    } catch {
      await docRef.set(
        {
          extractedText: null,
          textStatus: "failed",
          chunkStatus: "failed",
          textUpdatedAt: new Date(),
          chunkUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
        },
        { merge: true },
      );
      return NextResponse.json({ error: "Text extraction failed" }, { status: 500 });
    }

    const updated = await docRef.get();
    const data = updated.data() as
      | {
          title?: unknown;
          storagePath?: unknown;
          fileType?: unknown;
          size?: unknown;
          status?: unknown;
          textStatus?: unknown;
          chunkStatus?: unknown;
          chunkCount?: unknown;
          chunkVersion?: unknown;
          version?: unknown;
          createdAt?: FirestoreDateLike;
          createdBy?: unknown;
          textUpdatedAt?: FirestoreDateLike;
          chunkUpdatedAt?: FirestoreDateLike;
          updatedAt?: FirestoreDateLike;
          updatedBy?: unknown;
        }
      | undefined;

    return NextResponse.json({
      ok: true,
      document: {
        id: updated.id,
        title: typeof data?.title === "string" ? data.title : "Untitled",
        storagePath: typeof data?.storagePath === "string" ? data.storagePath : "",
        fileType:
          typeof data?.fileType === "string"
            ? data.fileType
            : "application/octet-stream",
        size: typeof data?.size === "number" ? data.size : 0,
        status: typeof data?.status === "string" ? data.status : "processing",
        textStatus: typeof data?.textStatus === "string" ? data.textStatus : "pending",
        chunkStatus: typeof data?.chunkStatus === "string" ? data.chunkStatus : "pending",
        chunkCount: typeof data?.chunkCount === "number" ? data.chunkCount : 0,
        chunkVersion: typeof data?.chunkVersion === "string" ? data.chunkVersion : null,
        version: typeof data?.version === "number" ? data.version : 1,
        createdAt: toIso(data?.createdAt),
        createdBy: typeof data?.createdBy === "string" ? data.createdBy : null,
        textUpdatedAt: toIso(data?.textUpdatedAt),
        chunkUpdatedAt: toIso(data?.chunkUpdatedAt),
        updatedAt: toIso(data?.updatedAt),
        updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
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
