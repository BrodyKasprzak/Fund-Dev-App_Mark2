import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentReadAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  normalizeDocumentPermissions,
  userCanReadDocument,
} from "@/lib/documentPermissions";

export const runtime = "nodejs";

const DEFAULT_SCAN_LIMIT = 150;
const MAX_SCAN_LIMIT = 300;
const SEARCH_LIMIT_PER_5_MIN = 300;
const MAX_QUERY_LENGTH = 120;

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

function normalizeQuery(raw: string) {
  return raw.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
}

function toSafeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildSnippet(text: string, query: string) {
  if (!text || !query) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx < 0) return null;

  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + query.length + 80);
  return text.slice(start, end).trim();
}

export async function GET(req: Request) {
  try {
    const { orgId, uid, email, role } = await requireDocumentReadAccess(req);

    await enforceRateLimit({
      scope: "documents_search_user",
      key: `${orgId}:${uid}`,
      limit: SEARCH_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "documents_search_ip",
      key: getRequestIp(req),
      limit: SEARCH_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const query = normalizeQuery(searchParams.get("q") || "");

    const parsedLimit = Number(searchParams.get("limit"));
    const scanLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(MAX_SCAN_LIMIT, Math.floor(parsedLimit)))
      : DEFAULT_SCAN_LIMIT;

    if (!query) {
      return NextResponse.json({ ok: true, query: "", documents: [] });
    }

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
          folderId?: unknown;
          status?: unknown;
          textStatus?: unknown;
          extractedText?: unknown;
          version?: unknown;
          createdAt?: FirestoreDateLike;
          createdBy?: unknown;
          textUpdatedAt?: FirestoreDateLike;
          updatedAt?: FirestoreDateLike;
          updatedBy?: unknown;
          docAccessMode?: unknown;
          docAllowedMemberUids?: unknown;
          docRagEnabled?: unknown;
          docPermissionsUpdatedBy?: unknown;
        };

        const docPermissions = normalizeDocumentPermissions(data);
        if (!userCanReadDocument({ permissions: docPermissions, uid, role })) return null;

        const title = toSafeString(data.title);
        const extractedText = toSafeString(data.extractedText);
        const titleMatch = title.toLowerCase().includes(query);
        const textMatch = extractedText.toLowerCase().includes(query);
        if (!titleMatch && !textMatch) return null;

        return {
          id: d.id,
          title: title || "Untitled",
          storagePath: toSafeString(data.storagePath),
          fileType: toSafeString(data.fileType) || "application/octet-stream",
          size: typeof data.size === "number" ? data.size : 0,
          folderId: typeof data.folderId === "string" ? data.folderId : null,
          status: toSafeString(data.status) || "processing",
          textStatus: toSafeString(data.textStatus) || "pending",
          version: typeof data.version === "number" ? data.version : 1,
          createdAt: toIso(data.createdAt),
          createdBy: toSafeString(data.createdBy) || null,
          textUpdatedAt: toIso(data.textUpdatedAt),
          updatedAt: toIso(data.updatedAt),
          updatedBy: toSafeString(data.updatedBy) || null,
          docPermissions: {
            accessMode: docPermissions.accessMode,
            allowedMemberUids: docPermissions.allowedMemberUids,
            ragEnabled: docPermissions.ragEnabled,
          },
          match: {
            inTitle: titleMatch,
            inText: textMatch,
            snippet: textMatch ? buildSnippet(extractedText, query) : null,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.search",
      actorUid: uid,
      actorEmail: email,
      metadata: {
        queryLength: query.length,
        resultCount: documents.length,
      },
    });

    return NextResponse.json({ ok: true, query, documents });
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
