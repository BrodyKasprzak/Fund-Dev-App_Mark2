import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebaseAdmin";
import { requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  ingestDocumentChunks,
  StaleDocumentVersionError,
} from "@/lib/documentChunkIngestion";
import {
  DOCX_IMPORT_PIPELINE_PHASE_A,
  DOCX_MIME,
  LEXICAL_EDITOR_FORMAT,
  type ImportFidelityProfile,
} from "@/lib/documents/versionMetadata";
import { derivePlainTextFromLexicalEditorState } from "@/lib/documents/lexicalPlainText";
import {
  lexicalEditorStateFromHtml,
  lexicalEditorStateFromHtmlPhaseA,
} from "@/lib/documents/lexicalImportFromHtml";

export const runtime = "nodejs";

const EXTRACT_LIMIT_PER_10_MIN = 40;
const MAX_EXTRACTED_TEXT_CHARS = 200_000;
const MAX_IMPORTED_EDITOR_STATE_BYTES = 700_000;
const MAX_DOC_ID_LENGTH = 128;
const MAX_PROFILE_FEATURES = 20;
const MAX_PROFILE_REASON_LENGTH = 120;
const TEXT_SOURCE_FILE_EXTRACT = "file_extract";
const TEXT_SOURCE_LEXICAL_PLAIN_TEXT = "lexical_plain_text";

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

type ExtractTextSource =
  | typeof TEXT_SOURCE_FILE_EXTRACT
  | typeof TEXT_SOURCE_LEXICAL_PLAIN_TEXT;

type VersionRecord = {
  editorFormat?: unknown;
  editorState?: unknown;
  plainText?: unknown;
  docxImportPipeline?: unknown;
  importFidelityProfile?: unknown;
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

function normalizeText(raw: string) {
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function sanitizeFeatureList(input: string[] | undefined) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, 80);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
    if (output.length >= MAX_PROFILE_FEATURES) break;
  }
  return output;
}

function buildImportFidelityProfile(args: {
  mappedFeatures?: string[];
  downgradedFeatures?: string[];
  fallbackUsed: boolean;
  fallbackReason?: string | null;
}): ImportFidelityProfile {
  const reason =
    typeof args.fallbackReason === "string" && args.fallbackReason.trim()
      ? args.fallbackReason.trim().slice(0, MAX_PROFILE_REASON_LENGTH)
      : null;
  return {
    pipeline: DOCX_IMPORT_PIPELINE_PHASE_A,
    source: "docx_mammoth_html",
    mappedFeatures: sanitizeFeatureList(args.mappedFeatures),
    downgradedFeatures: sanitizeFeatureList(args.downgradedFeatures),
    fallbackUsed: args.fallbackUsed,
    fallbackReason: reason,
    measuredAt: new Date(),
  };
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

async function importDocxAsLexicalLegacy(args: { buffer: Buffer }) {
  const { buffer } = args;
  const mammothModule = await import("mammoth");
  const mammoth = (mammothModule.default ?? mammothModule) as {
    convertToHtml: (
      input: { buffer: Buffer },
      options?: { styleMap?: string[] },
    ) => Promise<{ value?: string }>;
  };

  const parsed = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Title'] => h1:fresh",
        "b => strong",
        "i => em",
      ],
    },
  );
  const html = typeof parsed.value === "string" ? parsed.value.trim() : "";
  if (!html) return null;

  const editorState = lexicalEditorStateFromHtml(html);
  if (!editorState) return null;

  let serialized = "";
  try {
    serialized = JSON.stringify(editorState);
  } catch {
    return null;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_IMPORTED_EDITOR_STATE_BYTES) {
    return null;
  }

  const plainText = derivePlainTextFromLexicalEditorState(editorState, MAX_EXTRACTED_TEXT_CHARS);
  return {
    editorState,
    plainText: normalizeText(plainText),
    profile: null as ImportFidelityProfile | null,
  };
}

async function importDocxAsLexicalPhaseA(args: { buffer: Buffer }) {
  const { buffer } = args;
  const mammothModule = await import("mammoth");
  const mammoth = (mammothModule.default ?? mammothModule) as {
    convertToHtml: (
      input: { buffer: Buffer },
      options?: { styleMap?: string[] },
    ) => Promise<{ value?: string }>;
  };

  const parsed = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Heading 5'] => h5:fresh",
        "p[style-name='Heading 6'] => h6:fresh",
        "p[style-name='Title'] => h1:fresh",
        "b => strong",
        "i => em",
        "u => u",
        "strike => s",
      ],
    },
  );
  const html = typeof parsed.value === "string" ? parsed.value.trim() : "";
  if (!html) {
    return {
      editorState: null as Record<string, unknown> | null,
      plainText: null as string | null,
      profile: buildImportFidelityProfile({
        fallbackUsed: true,
        fallbackReason: "empty_html",
      }),
    };
  }

  const parsedLexical = lexicalEditorStateFromHtmlPhaseA(html);
  if (!parsedLexical.editorState) {
    return {
      editorState: null as Record<string, unknown> | null,
      plainText: null as string | null,
      profile: buildImportFidelityProfile({
        mappedFeatures: parsedLexical.summary.mappedFeatures,
        downgradedFeatures: parsedLexical.summary.downgradedFeatures,
        fallbackUsed: true,
        fallbackReason: "unparseable_html",
      }),
    };
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(parsedLexical.editorState);
  } catch {
    return {
      editorState: null as Record<string, unknown> | null,
      plainText: null as string | null,
      profile: buildImportFidelityProfile({
        mappedFeatures: parsedLexical.summary.mappedFeatures,
        downgradedFeatures: parsedLexical.summary.downgradedFeatures,
        fallbackUsed: true,
        fallbackReason: "serialize_error",
      }),
    };
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_IMPORTED_EDITOR_STATE_BYTES) {
    return {
      editorState: null as Record<string, unknown> | null,
      plainText: null as string | null,
      profile: buildImportFidelityProfile({
        mappedFeatures: parsedLexical.summary.mappedFeatures,
        downgradedFeatures: parsedLexical.summary.downgradedFeatures,
        fallbackUsed: true,
        fallbackReason: "editor_state_too_large",
      }),
    };
  }

  const plainText = derivePlainTextFromLexicalEditorState(
    parsedLexical.editorState,
    MAX_EXTRACTED_TEXT_CHARS,
  );
  return {
    editorState: parsedLexical.editorState,
    plainText: normalizeText(plainText),
    profile: buildImportFidelityProfile({
      mappedFeatures: parsedLexical.summary.mappedFeatures,
      downgradedFeatures: parsedLexical.summary.downgradedFeatures,
      fallbackUsed: false,
      fallbackReason: null,
    }),
  };
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
          currentVersionNumber?: unknown;
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
    const version = normalizeVersion(
      current?.currentVersionNumber,
      normalizeVersion(current?.version, 1),
    );
    const versionSnap = await docRef.collection("versions").doc(`v${version}`).get();
    const versionData = (versionSnap.data() ?? {}) as VersionRecord;
    const versionEditorFormat =
      typeof versionData.editorFormat === "string" ? versionData.editorFormat : null;
    const versionEditorState =
      versionData.editorState && typeof versionData.editorState === "object"
        ? (versionData.editorState as Record<string, unknown>)
        : null;
    const versionPlainText =
      typeof versionData.plainText === "string" ? versionData.plainText : null;
    const derivedPlainText = derivePlainTextFromLexicalEditorState(versionEditorState);
    const lexicalPlainText = derivedPlainText || versionPlainText || "";
    const versionDocxImportPipeline =
      typeof versionData.docxImportPipeline === "string"
        ? versionData.docxImportPipeline.trim()
        : null;
    const usePhaseADocxImport = versionDocxImportPipeline === DOCX_IMPORT_PIPELINE_PHASE_A;
    const shouldUseLexicalPlainText =
      versionEditorFormat === LEXICAL_EDITOR_FORMAT &&
      (versionEditorState !== null || versionPlainText !== null);
    const extractSource: ExtractTextSource = shouldUseLexicalPlainText
      ? TEXT_SOURCE_LEXICAL_PLAIN_TEXT
      : TEXT_SOURCE_FILE_EXTRACT;

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.extract_text_requested",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        status: uploadStatus,
        fileType: fileType || null,
        version,
        textSource: extractSource,
        docxImportPipeline: versionDocxImportPipeline,
      },
    });

    if (uploadStatus !== "ready") {
      return NextResponse.json(
        { error: "Document upload is not finalized yet" },
        { status: 409 },
      );
    }

    if (!shouldUseLexicalPlainText && (!storagePath || !fileType)) {
      await docRef.set(
        {
          textStatus: "failed",
          chunkStatus: "failed",
          chunkCount: 0,
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

    if (!shouldUseLexicalPlainText && !SUPPORTED_EXTRACT_FILE_TYPES.has(fileType)) {
      await docRef.set(
        {
          textStatus: "failed",
          chunkStatus: "failed",
          chunkCount: 0,
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

    if (!shouldUseLexicalPlainText) {
      const bucket = adminStorage.bucket();
      const fileRef = bucket.file(storagePath);
      const [exists] = await fileRef.exists();
      if (!exists) {
        await docRef.set(
          {
            textStatus: "failed",
            chunkStatus: "failed",
            chunkCount: 0,
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
    }

    await docRef.set(
      {
        textStatus: "processing",
        chunkStatus: "processing",
        chunkCount: 0,
        textUpdatedAt: new Date(),
        chunkUpdatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: uid,
        textSource: extractSource,
        textSourceVersion: version,
      },
      { merge: true },
    );

    try {
      let extractedText = "";
      let importedEditorState: Record<string, unknown> | null = null;
      let importedFidelityProfile: ImportFidelityProfile | null = null;

      if (shouldUseLexicalPlainText) {
        extractedText = normalizeText(lexicalPlainText);
      } else {
        const fileRef = adminStorage.bucket().file(storagePath);
        const [buffer] = await fileRef.download();

        if (fileType === DOCX_MIME) {
          if (usePhaseADocxImport) {
            const imported = await importDocxAsLexicalPhaseA({ buffer });
            importedFidelityProfile = imported.profile;
            if (imported.editorState && imported.plainText) {
              importedEditorState = imported.editorState;
              extractedText = imported.plainText;
            } else {
              extractedText = normalizeText(await extractText(buffer, fileType));
            }
          } else {
            const imported = await importDocxAsLexicalLegacy({ buffer });
            if (imported?.editorState) {
              importedEditorState = imported.editorState;
              extractedText = imported.plainText;
            } else {
              extractedText = normalizeText(await extractText(buffer, fileType));
            }
          }
        } else {
          extractedText = normalizeText(await extractText(buffer, fileType));
        }
      }

      await docRef.set(
        {
          extractedText: extractedText || null,
          textStatus: "ready",
          textUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: uid,
          textSource: extractSource,
          textSourceVersion: version,
        },
        { merge: true },
      );

      if (importedEditorState) {
        const versionRef = docRef.collection("versions").doc(`v${version}`);
        await versionRef.set(
          {
            editorFormat: LEXICAL_EDITOR_FORMAT,
            editorState: importedEditorState,
            plainText: extractedText || null,
            importFidelityProfile: importedFidelityProfile,
            updatedAt: new Date(),
            updatedBy: uid,
          },
          { merge: true },
        );

        await docRef.set(
          {
            [`versionMeta.items.v${version}.editorFormat`]: LEXICAL_EDITOR_FORMAT,
            [`versionMeta.items.v${version}.importFidelityProfile`]: importedFidelityProfile,
            updatedAt: new Date(),
            updatedBy: uid,
          },
          { merge: true },
        );
      } else if (importedFidelityProfile) {
        const versionRef = docRef.collection("versions").doc(`v${version}`);
        await versionRef.set(
          {
            importFidelityProfile: importedFidelityProfile,
            updatedAt: new Date(),
            updatedBy: uid,
          },
          { merge: true },
        );
        await docRef.set(
          {
            [`versionMeta.items.v${version}.importFidelityProfile`]: importedFidelityProfile,
            updatedAt: new Date(),
            updatedBy: uid,
          },
          { merge: true },
        );
      }

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
            chunkSource: extractSource,
            chunkSourceVersion: version,
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
            textSource: extractSource,
          },
        });
      } catch (chunkErr: unknown) {
        if (chunkErr instanceof StaleDocumentVersionError) {
          await writeOrgAuditLog({
            orgId,
            eventType: "documents.chunk_ingestion_skipped_stale",
            actorUid: uid,
            actorEmail: email,
            docId,
            metadata: {
              requestedVersion: chunkErr.requestedVersion,
              currentVersion: chunkErr.currentVersion,
              textSource: extractSource,
            },
          });

          return NextResponse.json(
            {
              error:
                "Chunk ingestion was skipped because a newer version is now current. Re-run extraction if needed.",
              stale: true,
              requestedVersion: chunkErr.requestedVersion,
              currentVersion: chunkErr.currentVersion,
            },
            { status: 409 },
          );
        }

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

        await writeOrgAuditLog({
          orgId,
          eventType: "documents.chunk_ingestion_failed",
          actorUid: uid,
            actorEmail: email,
            docId,
            metadata: {
              version,
              textSource: extractSource,
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
          chunkCount: 0,
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
          currentVersionNumber?: unknown;
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
        version:
          typeof data?.currentVersionNumber === "number" &&
          Number.isFinite(data.currentVersionNumber) &&
          data.currentVersionNumber > 0
            ? Math.floor(data.currentVersionNumber)
            : typeof data?.version === "number" &&
                Number.isFinite(data.version) &&
                data.version > 0
              ? Math.floor(data.version)
              : 1,
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
