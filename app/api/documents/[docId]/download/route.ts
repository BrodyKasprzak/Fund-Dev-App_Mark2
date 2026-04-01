import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebaseAdmin";
import { requireDocumentReadAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  DOCX_MIME,
  LEXICAL_EDITOR_FORMAT,
  PDF_MIME,
} from "@/lib/documents/versionMetadata";

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
  originalStoragePath?: unknown;
  originalFileType?: unknown;
  originalFilename?: unknown;
  filename?: unknown;
  version?: unknown;
  currentVersionNumber?: unknown;
};

type VersionRecord = {
  version?: unknown;
  storagePath?: unknown;
  fileType?: unknown;
  status?: unknown;
  filename?: unknown;
  originalFilename?: unknown;
  editorFormat?: unknown;
  renderAssets?: unknown;
};

type RenderAssetRecord = {
  status?: unknown;
  storagePath?: unknown;
  fileType?: unknown;
  error?: unknown;
};

type ExportFormat = "docx" | "pdf";

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

function normalizeVersion(value: unknown, fallback = 1) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function parseRequestedVersion(raw: string | null) {
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

function parseRequestedFormat(raw: string | null): ExportFormat | "original" | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "docx") return "docx";
  if (normalized === "pdf") return "pdf";
  if (normalized === "original") return "original";
  return null;
}

function resolveRenderAsset(renderAssets: unknown, format: ExportFormat) {
  if (!renderAssets || typeof renderAssets !== "object") return null;
  const record = (renderAssets as Record<string, unknown>)[format];
  if (!record || typeof record !== "object") return null;
  return record as RenderAssetRecord;
}

function safeRenderAssetStatus(value: unknown) {
  if (value === "ready" || value === "processing" || value === "failed" || value === "not_generated") {
    return value;
  }
  return "not_generated";
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
    const { orgId, uid, email } = await requireDocumentReadAccess(req);
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

    const { searchParams } = new URL(req.url);
    const targetParam = (searchParams.get("target") || "current").trim().toLowerCase();
    const target: "current" | "original" =
      targetParam === "original" ? "original" : "current";
    const requestedFormat = parseRequestedFormat(searchParams.get("format"));
    if (searchParams.get("format") !== null && !requestedFormat) {
      return NextResponse.json(
        { error: "format must be one of: docx, pdf, original" },
        { status: 400 },
      );
    }
    const requestedVersion = parseRequestedVersion(searchParams.get("version"));
    if (searchParams.get("version") !== null && requestedVersion === null) {
      return NextResponse.json(
        { error: "version must be a positive integer" },
        { status: 400 },
      );
    }
    if (target === "original" && requestedVersion !== null) {
      return NextResponse.json(
        { error: "version cannot be used with target=original" },
        { status: 400 },
      );
    }
    if (requestedFormat === "original" && requestedVersion !== null) {
      return NextResponse.json(
        { error: "format=original cannot be used with version" },
        { status: 400 },
      );
    }

    const data = docSnap.data() as DocumentRecord | undefined;
    const currentVersion = normalizeVersion(
      data?.currentVersionNumber,
      normalizeVersion(data?.version, 1),
    );
    const currentStoragePath =
      typeof data?.storagePath === "string" ? data.storagePath.trim() : "";
    const currentStatus = typeof data?.status === "string" ? data.status : "processing";
    const currentFileType =
      typeof data?.fileType === "string" && data.fileType.trim()
        ? data.fileType
        : null;
    const originalStoragePath =
      typeof data?.originalStoragePath === "string" ? data.originalStoragePath.trim() : "";
    const originalFileType =
      typeof data?.originalFileType === "string" && data.originalFileType.trim()
        ? data.originalFileType
        : null;
    const originalFilename =
      typeof data?.originalFilename === "string" ? data.originalFilename : null;
    const currentFilename =
      (typeof data?.filename === "string" && data.filename) ||
      (typeof data?.originalFilename === "string" && data.originalFilename) ||
      null;

    let resolvedVersion = currentVersion;
    let resolvedStoragePath = currentStoragePath;
    let resolvedStatus = currentStatus;
    let resolvedFileType = currentFileType;
    let resolvedFilename = currentFilename;
    let resolvedTarget: "current" | "original" | "version" = "current";
    let resolvedVersionRecord: VersionRecord | null = null;

    if (target === "original" || requestedFormat === "original") {
      resolvedTarget = "original";
      resolvedVersion = 1;
      resolvedStoragePath = originalStoragePath;
      resolvedStatus = "ready";
      resolvedFileType = originalFileType;
      resolvedFilename = originalFilename;
      if (!resolvedStoragePath) {
        const v1Snap = await docRef.collection("versions").doc("v1").get();
        if (v1Snap.exists) {
          const v1Data = v1Snap.data() as VersionRecord | undefined;
          resolvedVersionRecord = v1Data || null;
          resolvedStoragePath =
            typeof v1Data?.storagePath === "string" ? v1Data.storagePath.trim() : "";
          resolvedStatus =
            typeof v1Data?.status === "string" ? v1Data.status : "processing";
          resolvedFileType =
            typeof v1Data?.fileType === "string" ? v1Data.fileType : resolvedFileType;
          resolvedFilename =
            (typeof v1Data?.originalFilename === "string" && v1Data.originalFilename) ||
            (typeof v1Data?.filename === "string" && v1Data.filename) ||
            resolvedFilename;
        }
      }
    } else if (requestedVersion !== null && requestedVersion !== currentVersion) {
      const versionSnap = await docRef.collection("versions").doc(`v${requestedVersion}`).get();
      if (!versionSnap.exists) {
        return NextResponse.json({ error: "Version not found" }, { status: 404 });
      }
      const versionData = versionSnap.data() as VersionRecord | undefined;
      resolvedVersionRecord = versionData || null;
      resolvedTarget = "version";
      resolvedVersion = normalizeVersion(versionData?.version, requestedVersion);
      resolvedStoragePath =
        typeof versionData?.storagePath === "string" ? versionData.storagePath.trim() : "";
      resolvedStatus = typeof versionData?.status === "string" ? versionData.status : "processing";
      resolvedFileType =
        typeof versionData?.fileType === "string" && versionData.fileType.trim()
          ? versionData.fileType
          : null;
      resolvedFilename =
        (typeof versionData?.originalFilename === "string" && versionData.originalFilename) ||
        (typeof versionData?.filename === "string" && versionData.filename) ||
        null;
    } else {
      const currentVersionSnap = await docRef.collection("versions").doc(`v${currentVersion}`).get();
      if (currentVersionSnap.exists) {
        const versionData = currentVersionSnap.data() as VersionRecord | undefined;
        resolvedVersionRecord = versionData || null;
        resolvedVersion = normalizeVersion(versionData?.version, currentVersion);
        resolvedStoragePath =
          typeof versionData?.storagePath === "string" && versionData.storagePath.trim()
            ? versionData.storagePath
            : resolvedStoragePath;
        resolvedStatus =
          typeof versionData?.status === "string" ? versionData.status : resolvedStatus;
        resolvedFileType =
          typeof versionData?.fileType === "string" && versionData.fileType.trim()
            ? versionData.fileType
            : resolvedFileType;
        resolvedFilename =
          (typeof versionData?.originalFilename === "string" && versionData.originalFilename) ||
          (typeof versionData?.filename === "string" && versionData.filename) ||
          resolvedFilename;
      }
    }

    const editorBased =
      resolvedVersionRecord?.editorFormat === LEXICAL_EDITOR_FORMAT;
    const preferredExportFormat: ExportFormat | null =
      requestedFormat === "docx" || requestedFormat === "pdf"
        ? requestedFormat
        : editorBased
          ? "docx"
          : null;

    if (preferredExportFormat && resolvedTarget !== "original") {
      const asset = resolveRenderAsset(
        resolvedVersionRecord?.renderAssets,
        preferredExportFormat,
      );
      const assetStatus = safeRenderAssetStatus(asset?.status);
      const desiredMime = preferredExportFormat === "docx" ? DOCX_MIME : PDF_MIME;
      const fallbackMatchesSource =
        !editorBased && resolvedFileType === desiredMime;
      if (assetStatus === "ready") {
        const exportPath =
          typeof asset?.storagePath === "string" ? asset.storagePath.trim() : "";
        if (exportPath) {
          if (!exportPath.startsWith(`organizations/${orgId}/documents/${docId}/`)) {
            return NextResponse.json(
              { error: "Document export path is invalid" },
              { status: 409 },
            );
          }
          resolvedStoragePath = exportPath;
          resolvedStatus = "ready";
          resolvedFileType =
            typeof asset?.fileType === "string" && asset.fileType.trim()
              ? asset.fileType
              : preferredExportFormat === "docx"
                ? DOCX_MIME
                : PDF_MIME;
          const baseName = (resolvedFilename || "document").replace(/\.[^.]+$/, "");
          resolvedFilename = `${baseName}.${preferredExportFormat}`;
        }
      } else if (fallbackMatchesSource) {
        const baseName = (resolvedFilename || "document").replace(/\.[^.]+$/, "");
        resolvedFilename = `${baseName}.${preferredExportFormat}`;
      } else if (requestedFormat) {
        if (assetStatus === "processing") {
          return NextResponse.json(
            { error: `Requested ${preferredExportFormat.toUpperCase()} export is still processing` },
            { status: 409 },
          );
        }
        const exportError =
          typeof asset?.error === "string" && asset.error.trim() ? asset.error : null;
        return NextResponse.json(
          {
            error:
              exportError ||
              `Requested ${preferredExportFormat.toUpperCase()} export is not ready`,
          },
          { status: 409 },
        );
      } else if (editorBased) {
        if (assetStatus === "processing") {
          return NextResponse.json(
            { error: "Current editor export is still processing" },
            { status: 409 },
          );
        }
        const exportError =
          typeof asset?.error === "string" && asset.error.trim() ? asset.error : null;
        return NextResponse.json(
          {
            error:
              exportError || "Current editor export is not ready",
          },
          { status: 409 },
        );
      }
    }

    if (!resolvedStoragePath) {
      return NextResponse.json(
        { error: "Document is missing storagePath" },
        { status: 409 },
      );
    }

    if (!resolvedStoragePath.startsWith(`organizations/${orgId}/documents/${docId}/`)) {
      return NextResponse.json(
        { error: "Document storage path is invalid" },
        { status: 409 },
      );
    }

    if (resolvedStatus !== "ready") {
      return NextResponse.json(
        { error: "Document upload is not finalized yet" },
        { status: 409 },
      );
    }

    const fileRef = adminStorage.bucket().file(resolvedStoragePath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      return NextResponse.json({ error: "Stored file was not found" }, { status: 409 });
    }

    const [objectMeta] = await fileRef.getMetadata();
    const contentType =
      resolvedFileType || objectMeta.contentType || "application/octet-stream";
    const [buffer] = await fileRef.download();

    const preferredName = resolvedFilename || basename(resolvedStoragePath);

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
        version: resolvedVersion,
        target: resolvedTarget,
        format:
          requestedFormat ||
          (resolvedFileType === DOCX_MIME
            ? "docx"
            : resolvedFileType === PDF_MIME
              ? "pdf"
              : "original"),
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
