import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";

const INIT_VERSION_UPLOAD_LIMIT_PER_10_MIN = 120;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_DOC_ID_LENGTH = 128;
const MAX_FILENAME_LENGTH = 180;
const MAX_CHANGE_SUMMARY_LENGTH = 500;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type InitVersionUploadBody = {
  filename?: unknown;
  fileType?: unknown;
  size?: unknown;
  changeSummary?: unknown;
  expectedCurrentVersion?: unknown;
};

type CurrentDocument = {
  title?: unknown;
  status?: unknown;
  fileType?: unknown;
  version?: unknown;
  currentVersionNumber?: unknown;
  pendingVersion?: unknown;
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

function sanitizeFilename(input: string) {
  const stripped = input
    .trim()
    .replace(/[\/\\]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[^\w.\- ()]/g, "_");
  const normalized = stripped.replace(/_+/g, "_");
  const finalName = normalized.slice(0, MAX_FILENAME_LENGTH).trim();
  return finalName || "document.docx";
}

function safeOriginalFilename(input: string) {
  const trimmed = input.trim().slice(0, MAX_FILENAME_LENGTH);
  return trimmed || "document.docx";
}

function normalizeChangeSummary(value: unknown) {
  if (typeof value !== "string") return null;
  const summary = value.trim().replace(/\s+/g, " ");
  if (!summary) return null;
  return summary.slice(0, MAX_CHANGE_SUMMARY_LENGTH);
}

function ensureDocxFilename(name: string) {
  if (name.toLowerCase().endsWith(".docx")) return name;
  return `${name}.docx`;
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
      scope: "documents_version_init_upload_user",
      key: `${orgId}:${uid}`,
      limit: INIT_VERSION_UPLOAD_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_version_init_upload_ip",
      key: getRequestIp(req),
      limit: INIT_VERSION_UPLOAD_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as InitVersionUploadBody;
    const rawFilename = typeof body.filename === "string" ? body.filename : "";
    const rawFileType = typeof body.fileType === "string" ? body.fileType.trim() : "";
    const rawSize = Number(body.size);
    const expectedCurrentVersion =
      body.expectedCurrentVersion === undefined
        ? null
        : normalizeVersion(body.expectedCurrentVersion, -1);
    const changeSummary = normalizeChangeSummary(body.changeSummary);

    if (!rawFilename.trim()) {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }
    if (rawFileType !== DOCX_MIME) {
      return NextResponse.json({ error: "Only DOCX can be edited" }, { status: 400 });
    }
    if (!Number.isFinite(rawSize) || rawSize <= 0 || rawSize > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `size must be between 1 and ${MAX_FILE_SIZE_BYTES} bytes` },
        { status: 400 },
      );
    }
    if (!changeSummary) {
      return NextResponse.json(
        { error: "changeSummary is required" },
        { status: 400 },
      );
    }
    if (expectedCurrentVersion !== null && expectedCurrentVersion < 1) {
      return NextResponse.json(
        { error: "expectedCurrentVersion must be a positive integer" },
        { status: 400 },
      );
    }

    const safeFilename = ensureDocxFilename(sanitizeFilename(rawFilename));
    const originalFilename = ensureDocxFilename(safeOriginalFilename(rawFilename));
    const now = new Date();
    const docRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId);

    const result = await adminDb.runTransaction(async (tx) => {
      const docSnap = await tx.get(docRef);
      if (!docSnap.exists) {
        throw new HttpLikeError(404, "Document not found");
      }

      const data = (docSnap.data() ?? {}) as CurrentDocument;
      const currentVersion = normalizeVersion(
        data.currentVersionNumber,
        normalizeVersion(data.version, 1),
      );

      if (expectedCurrentVersion !== null && expectedCurrentVersion !== currentVersion) {
        throw new HttpLikeError(
          409,
          "Document changed since you opened it. Refresh and try again.",
        );
      }

      const status = typeof data.status === "string" ? data.status : "processing";
      if (status !== "ready") {
        throw new HttpLikeError(
          409,
          "Document is not ready for version updates",
        );
      }

      const fileType = typeof data.fileType === "string" ? data.fileType : "";
      if (fileType !== DOCX_MIME) {
        throw new HttpLikeError(
          400,
          "Only DOCX documents are editable in this phase",
        );
      }

      const pending =
        data.pendingVersion && typeof data.pendingVersion === "object"
          ? (data.pendingVersion as {
              status?: unknown;
              version?: unknown;
              createdBy?: unknown;
            })
          : null;
      let nextVersion = currentVersion + 1;
      if (pending && pending.status === "processing") {
        const pendingVersion = normalizeVersion(pending.version, nextVersion);
        if (pending.createdBy === uid) {
          nextVersion = pendingVersion;
        } else {
          throw new HttpLikeError(
            409,
            `A version upload is already in progress (v${pendingVersion})`,
          );
        }
      }

      const storagePath = `organizations/${orgId}/documents/${docId}/v${nextVersion}/${safeFilename}`;
      const versionRef = docRef.collection("versions").doc(`v${nextVersion}`);

      tx.set(
        versionRef,
        {
          version: nextVersion,
          storagePath,
          filename: safeFilename,
          originalFilename,
          fileType: DOCX_MIME,
          size: rawSize,
          status: "processing",
          source: "edit",
          changeSummary,
          createdAt: now,
          createdBy: uid,
          promotedAt: null,
          promotedBy: null,
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );

      tx.set(
        docRef,
        {
          pendingVersion: {
            version: nextVersion,
            storagePath,
            filename: safeFilename,
            originalFilename,
            fileType: DOCX_MIME,
            size: rawSize,
            status: "processing",
            source: "edit",
            changeSummary,
            createdAt: now,
            createdBy: uid,
          },
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );

      return {
        nextVersion,
        storagePath,
      };
    });

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.version_init_upload",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        version: result.nextVersion,
        fileType: DOCX_MIME,
        size: rawSize,
      },
    });

    return NextResponse.json({
      ok: true,
      versionNumber: result.nextVersion,
      storagePath: result.storagePath,
      fileType: DOCX_MIME,
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
