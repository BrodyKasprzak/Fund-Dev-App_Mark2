import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  normalizeDocumentPermissions,
  userCanReadDocument,
} from "@/lib/documentPermissions";

export const runtime = "nodejs";

const ACTIVITY_LIMIT_PER_5_MIN = 240;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type AuditLogRecord = {
  eventType?: unknown;
  timestamp?: FirestoreDateLike;
  docId?: unknown;
  metadata?: unknown;
};

type MetadataRecord = {
  version?: unknown;
  previousVersion?: unknown;
  changeSummary?: unknown;
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

function normalizeLimit(raw: string | null) {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

function normalizeVersion(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return null;
}

function mapEventLabel(eventType: string, version: number | null) {
  if (eventType === "documents.version_saved") {
    return version ? `Document updated (v${version})` : "Document updated";
  }
  if (eventType === "documents.upload_finalized") {
    return version ? `Document uploaded (v${version})` : "Document uploaded";
  }
  if (eventType === "documents.init_upload") {
    return version ? `Upload started (v${version})` : "Upload started";
  }
  if (eventType === "documents.downloaded") {
    return version ? `Document downloaded (v${version})` : "Document downloaded";
  }
  return eventType;
}

export async function GET(req: Request) {
  try {
    const { orgId, uid, role } = await requireOrgContext(req);
    const { searchParams } = new URL(req.url);
    const limit = normalizeLimit(searchParams.get("limit"));
    if (limit === null) {
      return NextResponse.json(
        { error: `limit must be an integer between 1 and ${MAX_LIMIT}` },
        { status: 400 },
      );
    }

    await enforceRateLimit({
      scope: "activity_recent_user",
      key: `${orgId}:${uid}`,
      limit: ACTIVITY_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "activity_recent_ip",
      key: getRequestIp(req),
      limit: ACTIVITY_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const auditSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("auditLogs")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    const docIds = [...new Set(
      auditSnap.docs
        .map((snap) => {
          const data = snap.data() as AuditLogRecord;
          return typeof data.docId === "string" ? data.docId.trim() : "";
        })
        .filter(Boolean),
    )];

    const docTitleById = new Map<string, string>();
    const docReadableById = new Map<string, boolean>();
    if (docIds.length > 0) {
      const docsRef = adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("documents");
      const refs = docIds.map((docId) => docsRef.doc(docId));
      const docs = await adminDb.getAll(...refs);
      docs.forEach((snapshot) => {
        if (!snapshot.exists) return;
        const raw = snapshot.data() as { title?: unknown };
        const readable = userCanReadDocument({
          permissions: normalizeDocumentPermissions(
            snapshot.data() as {
              docAccessMode?: unknown;
              docAllowedMemberUids?: unknown;
              docRagEnabled?: unknown;
              docPermissionsUpdatedBy?: unknown;
            },
          ),
          uid,
          role,
        });
        docReadableById.set(snapshot.id, readable);
        docTitleById.set(
          snapshot.id,
          typeof raw?.title === "string" && raw.title.trim() ? raw.title : "Untitled document",
        );
      });
    }

    const items = auditSnap.docs.map((snapshot) => {
      const data = snapshot.data() as AuditLogRecord;
      const eventType =
        typeof data.eventType === "string" ? data.eventType : "unknown_event";
      const metadata =
        data.metadata && typeof data.metadata === "object"
          ? (data.metadata as MetadataRecord)
          : null;
      const version = normalizeVersion(metadata?.version);
      const previousVersion = normalizeVersion(metadata?.previousVersion);
      const docId = typeof data.docId === "string" ? data.docId : null;
      const canReadDoc = docId ? docReadableById.get(docId) !== false : true;
      const changeSummary =
        typeof metadata?.changeSummary === "string"
          ? metadata.changeSummary
          : null;

      return {
        id: snapshot.id,
        eventType,
        label: mapEventLabel(eventType, version),
        docId: canReadDoc ? docId : null,
        docTitle: docId
          ? canReadDoc
            ? docTitleById.get(docId) || "Untitled document"
            : "Restricted document"
          : "Organization activity",
        when: toIso(data.timestamp),
        version,
        previousVersion,
        changeSummary,
      };
    });

    return NextResponse.json({ ok: true, items });
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
