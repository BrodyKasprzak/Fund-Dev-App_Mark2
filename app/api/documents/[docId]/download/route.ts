import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";

const DOWNLOAD_LIMIT_PER_10_MIN = 240;
const MAX_DOC_ID_LENGTH = 128;
const MAX_FILENAME_LENGTH = 220;

const FILE_TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/csv": ".csv",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

type DocumentRecord = {
  title?: unknown;
  storagePath?: unknown;
  fileType?: unknown;
  size?: unknown;
  status?: unknown;
  originalFilename?: unknown;
  filename?: unknown;
  version?: unknown;
};

function isValidDocId(docId: string) {
  const trimmed = docId.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DOC_ID_LENGTH) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return true;
}

function sanitizeFilename(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/[\/\\]+/g, "_")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>:"|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();

  return cleaned || "document";
}

function basename(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] || "document";
}

function withSafeExtension(filename: string, fileType: string | null) {
  if (/\.[A-Za-z0-9]{1,8}$/.test(filename)) return filename;
  if (!fileType) return filename;
  const ext = FILE_TYPE_EXTENSIONS[fileType];
  if (!ext) return filename;
  return `${filename}${ext}`;
}

function buildContentDisposition(filename: string) {
  const asciiFallback = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .replace(/[;\r\n]/g, "")
    .trim() || "document";

  const utf8Encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
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
      scope: "documents_download_user",
      key: `${orgId}:${uid}`,
      limit: DOWNLOAD_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_download_ip",
      key: getRequestIp(req),
      limit: DOWNLOAD_LIMIT_PER_10_MIN * 2,
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

    const data = docSnap.data() as DocumentRecord | undefined;
    const storagePath =
      typeof data?.storagePath === "string" ? data.storagePath.trim() : "";
    const status = typeof data?.status === "string" ? data.status : "processing";
    const fileType =
      typeof data?.fileType === "string" && data.fileType.trim()
        ? data.fileType
        : null;
    const version =
      typeof data?.version === "number" && Number.isFinite(data.version)
        ? Math.max(1, Math.floor(data.version))
        : 1;

    if (!storagePath) {
      return NextResponse.json(
        { error: "Document is missing storagePath" },
        { status: 409 },
      );
    }

    if (!storagePath.startsWith(`organizations/${orgId}/documents/${docId}/`)) {
      return NextResponse.json(
        { error: "Document storage path is invalid" },
        { status: 409 },
      );
    }

    if (status !== "ready") {
      return NextResponse.json(
        { error: "Document upload is not finalized yet" },
        { status: 409 },
      );
    }

    const fileRef = adminStorage.bucket().file(storagePath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      return NextResponse.json({ error: "Stored file was not found" }, { status: 409 });
    }

    const [objectMeta] = await fileRef.getMetadata();
    const contentType = fileType || objectMeta.contentType || "application/octet-stream";
    const [buffer] = await fileRef.download();

    const preferredName =
      (typeof data?.originalFilename === "string" && data.originalFilename) ||
      (typeof data?.filename === "string" && data.filename) ||
      basename(storagePath);

    const downloadFilename = withSafeExtension(
      sanitizeFilename(preferredName),
      contentType,
    );

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.downloaded",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        version,
        size: buffer.length,
        fileType: contentType,
        filename: downloadFilename,
      },
    });

    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": buildContentDisposition(downloadFilename),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
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
