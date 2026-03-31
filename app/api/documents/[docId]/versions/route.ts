import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const VERSION_LIST_LIMIT_PER_5_MIN = 240;
const VERSION_LIST_MAX_ITEMS = 200;
const MAX_DOC_ID_LENGTH = 128;

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type VersionDocRecord = {
  version?: unknown;
  storagePath?: unknown;
  filename?: unknown;
  originalFilename?: unknown;
  fileType?: unknown;
  size?: unknown;
  status?: unknown;
  source?: unknown;
  changeSummary?: unknown;
  createdAt?: FirestoreDateLike;
  createdBy?: unknown;
  updatedAt?: FirestoreDateLike;
  updatedBy?: unknown;
  promotedAt?: FirestoreDateLike;
  promotedBy?: unknown;
};

type ParentDocumentRecord = {
  version?: unknown;
  currentVersionNumber?: unknown;
  versionMeta?: unknown;
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

function serializeVersion(record: VersionDocRecord, currentVersionNumber: number) {
  const version = normalizeVersion(record.version, 1);
  return {
    version,
    storagePath: typeof record.storagePath === "string" ? record.storagePath : "",
    filename: typeof record.filename === "string" ? record.filename : null,
    originalFilename:
      typeof record.originalFilename === "string" ? record.originalFilename : null,
    fileType:
      typeof record.fileType === "string" ? record.fileType : "application/octet-stream",
    size: typeof record.size === "number" ? record.size : 0,
    status: typeof record.status === "string" ? record.status : "processing",
    source: typeof record.source === "string" ? record.source : "upload",
    changeSummary:
      typeof record.changeSummary === "string" ? record.changeSummary : null,
    createdAt: toIso(record.createdAt),
    createdBy: typeof record.createdBy === "string" ? record.createdBy : null,
    updatedAt: toIso(record.updatedAt),
    updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : null,
    promotedAt: toIso(record.promotedAt),
    promotedBy: typeof record.promotedBy === "string" ? record.promotedBy : null,
    isCurrent: version === currentVersionNumber,
  };
}

function fallbackVersionsFromVersionMeta(
  data: ParentDocumentRecord,
  currentVersionNumber: number,
) {
  const versionMeta =
    data.versionMeta && typeof data.versionMeta === "object"
      ? (data.versionMeta as { items?: unknown })
      : null;
  const items = versionMeta?.items;
  if (!items || typeof items !== "object") return [];

  const output = Object.entries(items as Record<string, unknown>)
    .map(([, raw]) => {
      if (!raw || typeof raw !== "object") return null;
      const record = raw as VersionDocRecord;
      return serializeVersion(record, currentVersionNumber);
    })
    .filter((row): row is ReturnType<typeof serializeVersion> => Boolean(row))
    .sort((a, b) => b.version - a.version);

  return output;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { docId } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_versions_list_user",
      key: `${orgId}:${uid}`,
      limit: VERSION_LIST_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_versions_list_ip",
      key: getRequestIp(req),
      limit: VERSION_LIST_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
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

    const docData = (docSnap.data() ?? {}) as ParentDocumentRecord;
    const currentVersionNumber = normalizeVersion(
      docData.currentVersionNumber,
      normalizeVersion(docData.version, 1),
    );

    const versionsSnap = await docRef
      .collection("versions")
      .orderBy("version", "desc")
      .limit(VERSION_LIST_MAX_ITEMS)
      .get();

    const versions = versionsSnap.empty
      ? fallbackVersionsFromVersionMeta(docData, currentVersionNumber)
      : versionsSnap.docs.map((snapshot) =>
          serializeVersion(snapshot.data() as VersionDocRecord, currentVersionNumber),
        );

    return NextResponse.json({
      ok: true,
      currentVersionNumber,
      versions,
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
