import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentWriteAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  normalizeDocumentPermissions,
  userCanReadDocument,
} from "@/lib/documentPermissions";
import { LEXICAL_EDITOR_FORMAT } from "@/lib/documents/versionMetadata";
import {
  buildEditorProcessingRenderAssets,
  enqueueDocumentExportJob,
  processDocumentExportQueueBatch,
  triggerExportWorkerKick,
} from "@/lib/documents/exportJobs";

export const runtime = "nodejs";

const REGENERATE_LIMIT_PER_10_MIN = 120;
const MAX_DOC_ID_LENGTH = 128;

type VersionRecord = {
  version?: unknown;
  filename?: unknown;
  originalFilename?: unknown;
  editorFormat?: unknown;
  editorState?: unknown;
  plainText?: unknown;
};

function isValidDocId(docId: string) {
  const trimmed = docId.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DOC_ID_LENGTH) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  return true;
}

function parseVersion(raw: string) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ docId: string; versionNumber: string }> },
) {
  try {
    const { orgId, uid, email, role } = await requireDocumentWriteAccess(req);
    const { docId, versionNumber: rawVersionNumber } = await context.params;

    if (!isValidDocId(docId)) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }
    const versionNumber = parseVersion(rawVersionNumber);
    if (!versionNumber) {
      return NextResponse.json({ error: "Invalid versionNumber" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_version_regenerate_user",
      key: `${orgId}:${uid}`,
      limit: REGENERATE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_version_regenerate_ip",
      key: getRequestIp(req),
      limit: REGENERATE_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const docRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId);
    const versionRef = docRef.collection("versions").doc(`v${versionNumber}`);

    const [docSnap, versionSnap] = await Promise.all([docRef.get(), versionRef.get()]);
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (
      !userCanReadDocument({
        permissions: normalizeDocumentPermissions(
          docSnap.data() as {
            docAccessMode?: unknown;
            docAllowedMemberUids?: unknown;
            docRagEnabled?: unknown;
            docPermissionsUpdatedBy?: unknown;
          },
        ),
        uid,
        role,
      })
    ) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (!versionSnap.exists) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const version = (versionSnap.data() ?? {}) as VersionRecord;

    const editorFormat =
      typeof version.editorFormat === "string" ? version.editorFormat : null;
    if (editorFormat !== LEXICAL_EDITOR_FORMAT) {
      return NextResponse.json(
        { error: "Only lexical editor versions support export regeneration" },
        { status: 400 },
      );
    }

    const editorState =
      version.editorState && typeof version.editorState === "object"
        ? (version.editorState as Record<string, unknown>)
        : null;
    if (!editorState) {
      return NextResponse.json(
        { error: "Version is missing editorState" },
        { status: 409 },
      );
    }

    const exportAssets = buildEditorProcessingRenderAssets();
    await versionRef.set(
      {
        renderAssets: exportAssets,
        updatedAt: new Date(),
        updatedBy: uid,
      },
      { merge: true },
    );
    await docRef.set(
      {
        [`versionMeta.items.v${versionNumber}.renderAssets`]: exportAssets,
        updatedAt: new Date(),
        updatedBy: uid,
      },
      { merge: true },
    );

    const exportJob = await enqueueDocumentExportJob({
      orgId,
      docId,
      versionNumber,
      requestedByUid: uid,
      reason: "regenerate",
      force: true,
    });
    void triggerExportWorkerKick({ requestUrl: req.url, maxJobs: 2 });
    void processDocumentExportQueueBatch({
      maxJobs: 1,
      workerId: `opportunistic-${orgId}-${docId}`,
    });

    await writeOrgAuditLog({
      orgId,
      eventType: "documents.version_exports_regenerated",
      actorUid: uid,
      actorEmail: email,
      docId,
      metadata: {
        version: versionNumber,
        docxStatus: exportAssets.docx.status,
        pdfStatus: exportAssets.pdf.status,
        exportJobId: exportJob.jobId,
        exportJobQueued: exportJob.queued,
      },
    });

    return NextResponse.json({
      ok: true,
      versionNumber,
      exports: exportAssets,
      exportJob,
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
