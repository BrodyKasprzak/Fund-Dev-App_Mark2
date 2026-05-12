import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentReadAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  normalizeDocumentPermissions,
  userCanReadDocument,
} from "@/lib/documentPermissions";

export const runtime = "nodejs";

const LIST_LIMIT = 50;
const LIST_SCAN_LIMIT = 300;
const DOC_LIST_LIMIT_PER_5_MIN = 200;

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

function normalizeFolderFilter(raw: string | null) {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "root") return "root";
  if (trimmed === "all") return null;
  if (trimmed.length > 128) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
}

export async function GET(req: Request) {
  try {
    const { orgId, uid, role } = await requireDocumentReadAccess(req);

    await enforceRateLimit({
      scope: "documents_list_user",
      key: `${orgId}:${uid}`,
      limit: DOC_LIST_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_list_ip",
      key: getRequestIp(req),
      limit: DOC_LIST_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const folderFilter = normalizeFolderFilter(searchParams.get("folderId"));
    if (searchParams.get("folderId") && !folderFilter && searchParams.get("folderId") !== "all") {
      return NextResponse.json({ error: "Invalid folderId filter" }, { status: 400 });
    }

    const scanLimit = folderFilter ? LIST_SCAN_LIMIT : LIST_LIMIT;
    const snap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .orderBy("createdAt", "desc")
      .limit(scanLimit)
      .get();

    const documents = snap.docs
      .map((d) => {
      const data = d.data() as {
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
        version?: unknown;
        currentVersionNumber?: unknown;
        createdAt?: FirestoreDateLike;
        createdBy?: unknown;
        textUpdatedAt?: FirestoreDateLike;
        chunkUpdatedAt?: FirestoreDateLike;
        updatedAt?: FirestoreDateLike;
        updatedBy?: unknown;
        folderId?: unknown;
        docAccessMode?: unknown;
        docAllowedMemberUids?: unknown;
        docRagEnabled?: unknown;
        docPermissionsUpdatedBy?: unknown;
      };

      const docPermissions = normalizeDocumentPermissions(data);
      if (!userCanReadDocument({ permissions: docPermissions, uid, role })) {
        return null;
      }

      const resolvedVersion =
        typeof data.currentVersionNumber === "number" &&
        Number.isFinite(data.currentVersionNumber) &&
        data.currentVersionNumber > 0
          ? Math.floor(data.currentVersionNumber)
          : typeof data.version === "number" && Number.isFinite(data.version) && data.version > 0
            ? Math.floor(data.version)
            : 1;

      return {
        id: d.id,
        title: typeof data.title === "string" ? data.title : "Untitled",
        storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
        fileType:
          typeof data.fileType === "string"
            ? data.fileType
            : "application/octet-stream",
        size: typeof data.size === "number" ? data.size : 0,
        status: typeof data.status === "string" ? data.status : "processing",
        editStatus:
          typeof data.editStatus === "string" ? data.editStatus : "not_editable",
        textStatus: typeof data.textStatus === "string" ? data.textStatus : "pending",
        chunkStatus: typeof data.chunkStatus === "string" ? data.chunkStatus : "pending",
        chunkCount: typeof data.chunkCount === "number" ? data.chunkCount : 0,
        chunkVersion: typeof data.chunkVersion === "string" ? data.chunkVersion : null,
        version: resolvedVersion,
        currentVersionNumber: resolvedVersion,
        createdAt: toIso(data.createdAt),
        createdBy: typeof data.createdBy === "string" ? data.createdBy : null,
        textUpdatedAt: toIso(data.textUpdatedAt),
        chunkUpdatedAt: toIso(data.chunkUpdatedAt),
        updatedAt: toIso(data.updatedAt),
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
        folderId: typeof data.folderId === "string" ? data.folderId : null,
        docPermissions: {
          accessMode: docPermissions.accessMode,
          allowedMemberUids: docPermissions.allowedMemberUids,
          ragEnabled: docPermissions.ragEnabled,
        },
      };
      })
      .filter((document): document is NonNullable<typeof document> => {
        if (!document) return false;
        if (folderFilter === "root") return !document.folderId;
        if (folderFilter) return document.folderId === folderFilter;
        return true;
      })
      .slice(0, LIST_LIMIT);

    return NextResponse.json({ ok: true, documents });
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
