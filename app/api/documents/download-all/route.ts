import { basename } from "path";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebaseAdmin";
import { requireDocumentReadAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";

const DOWNLOAD_ALL_LIMIT_PER_HOUR = 8;
const MAX_DOCS_PER_DOWNLOAD = 1000;
const MAX_TOTAL_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
const ZIP_ROOT_FOLDER_NAME = "Document Desktop";
const MAX_PATH_SEGMENT_LENGTH = 120;

type FolderRecord = {
  name?: unknown;
};

type DocumentRecord = {
  title?: unknown;
  filename?: unknown;
  storagePath?: unknown;
  folderId?: unknown;
};

function sanitizePathSegment(value: string, fallback: string) {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, MAX_PATH_SEGMENT_LENGTH)
    .trim();
  return cleaned || fallback;
}

function normalizeFolderId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStoragePath(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeFilename(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function ensureUniquePath(path: string, usedPaths: Set<string>) {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const slashIdx = path.lastIndexOf("/");
  const dotIdx = path.lastIndexOf(".");
  const hasExtension = dotIdx > slashIdx;
  const basePath = hasExtension ? path.slice(0, dotIdx) : path;
  const ext = hasExtension ? path.slice(dotIdx) : "";

  let suffix = 2;
  while (usedPaths.has(`${basePath} (${suffix})${ext}`)) {
    suffix += 1;
  }
  const unique = `${basePath} (${suffix})${ext}`;
  usedPaths.add(unique);
  return unique;
}

function nowDateStamp() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function POST(req: Request) {
  try {
    const { orgId, uid, email } = await requireDocumentReadAccess(req);

    await enforceRateLimit({
      scope: "documents_download_all_user",
      key: `${orgId}:${uid}`,
      limit: DOWNLOAD_ALL_LIMIT_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_download_all_ip",
      key: getRequestIp(req),
      limit: DOWNLOAD_ALL_LIMIT_PER_HOUR * 2,
      windowMs: 60 * 60 * 1000,
    });

    const [foldersSnap, docsSnap] = await Promise.all([
      adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documentFolders")
        .get(),
      adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documents")
        .orderBy("createdAt", "desc")
        .limit(MAX_DOCS_PER_DOWNLOAD + 1)
        .get(),
    ]);

    if (docsSnap.size > MAX_DOCS_PER_DOWNLOAD) {
      return NextResponse.json(
        {
          error: `Too many documents to download at once (max ${MAX_DOCS_PER_DOWNLOAD}).`,
        },
        { status: 413 },
      );
    }

    const folderNameById = new Map<string, string>();
    for (const folderDoc of foldersSnap.docs) {
      const folder = folderDoc.data() as FolderRecord;
      const rawName =
        typeof folder.name === "string" && folder.name.trim()
          ? folder.name
          : `Folder ${folderDoc.id.slice(0, 6)}`;
      folderNameById.set(folderDoc.id, sanitizePathSegment(rawName, "Folder"));
    }

    const zip = new JSZip();
    const usedPaths = new Set<string>();
    const skipped: string[] = [];
    let totalBytes = 0;
    let includedCount = 0;

    for (const docSnap of docsSnap.docs) {
      const doc = docSnap.data() as DocumentRecord;
      const docId = docSnap.id;
      const storagePath = normalizeStoragePath(doc.storagePath);
      if (!storagePath) {
        skipped.push(`${docId}: missing storagePath`);
        continue;
      }

      const expectedPrefix = `organizations/${orgId}/documents/${docId}/`;
      if (!storagePath.startsWith(expectedPrefix)) {
        skipped.push(`${docId}: invalid storagePath`);
        continue;
      }

      const folderId = normalizeFolderId(doc.folderId);
      const folderSegment = folderId
        ? folderNameById.get(folderId) || sanitizePathSegment(`Folder ${folderId}`, "Folder")
        : null;

      const rawFilename =
        normalizeFilename(doc.filename) ||
        basename(storagePath) ||
        sanitizePathSegment(
          typeof doc.title === "string" && doc.title.trim() ? doc.title : `document-${docId}`,
          `document-${docId}`,
        );
      const filename = sanitizePathSegment(rawFilename, `document-${docId}`);
      const relativePath = folderSegment ? `${folderSegment}/${filename}` : filename;
      const zipPath = ensureUniquePath(`${ZIP_ROOT_FOLDER_NAME}/${relativePath}`, usedPaths);

      try {
        const [fileBuffer] = await adminStorage.bucket().file(storagePath).download();
        const nextTotalBytes = totalBytes + fileBuffer.length;
        if (nextTotalBytes > MAX_TOTAL_DOWNLOAD_BYTES) {
          return NextResponse.json(
            {
              error: `Download is too large (max ${Math.floor(MAX_TOTAL_DOWNLOAD_BYTES / (1024 * 1024))} MB).`,
            },
            { status: 413 },
          );
        }

        totalBytes = nextTotalBytes;
        zip.file(zipPath, fileBuffer);
        includedCount += 1;
      } catch {
        skipped.push(`${docId}: storage file unavailable`);
      }
    }

    if (includedCount === 0) {
      return NextResponse.json(
        {
          error: "No downloadable document files were found.",
          skippedCount: skipped.length,
        },
        { status: 409 },
      );
    }

    const summaryLines = [
      `Organization: ${orgId}`,
      `Generated at (UTC): ${new Date().toISOString()}`,
      `Included files: ${includedCount}`,
      `Skipped files: ${skipped.length}`,
      "",
      "Skipped details:",
      ...(skipped.length > 0 ? skipped : ["None"]),
    ];
    zip.file(`${ZIP_ROOT_FOLDER_NAME}/offboard-summary.txt`, summaryLines.join("\n"));

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.download_all",
      actorUid: uid,
      actorEmail: email,
      metadata: {
        includedCount,
        skippedCount: skipped.length,
        totalBytes,
      },
    });

    const filename = `documents-offboard-${nowDateStamp()}.zip`;
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
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
