import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentReadAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const LIST_LIMIT = 50;
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

export async function GET(req: Request) {
  try {
    const { orgId, uid } = await requireDocumentReadAccess(req);

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

    const snap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .orderBy("createdAt", "desc")
      .limit(LIST_LIMIT)
      .get();

    const documents = snap.docs.map((d) => {
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
      };

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
      };
    });

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
