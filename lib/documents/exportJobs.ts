import { adminDb } from "@/lib/firebaseAdmin";
import { writeOrgAuditLog } from "@/lib/auditLog";
import { generateAndStoreEditorExports, type StoredExportAssets } from "@/lib/documents/editorExports";
import {
  DOCX_MIME,
  LEXICAL_EDITOR_FORMAT,
  PDF_MIME,
  type VersionRenderAssets,
} from "@/lib/documents/versionMetadata";

const EXPORT_JOB_COLLECTION = "_document_export_jobs";
const EXPORT_JOB_DEFAULT_MAX_ATTEMPTS = 5;
const EXPORT_JOB_DEFAULT_LEASE_MS = 2 * 60 * 1000;
const EXPORT_JOB_MAX_CLAIM_SCAN = 25;
const EXPORT_JOB_MAX_BATCH = 20;
const EXPORT_JOB_MAX_ERROR_LENGTH = 320;
const EXPORT_JOB_BACKOFF_BASE_MS = 15_000;
const EXPORT_JOB_BACKOFF_MAX_MS = 15 * 60 * 1000;

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type ExportJobStatus = "queued" | "processing" | "succeeded" | "failed";
type ExportJobReason = "save_editor" | "regenerate";

type ExportJobRecord = {
  orgId?: unknown;
  docId?: unknown;
  versionNumber?: unknown;
  status?: unknown;
  reason?: unknown;
  attempts?: unknown;
  maxAttempts?: unknown;
  runAfter?: FirestoreDateLike;
  requestedByUid?: unknown;
  leasedBy?: unknown;
  leaseExpiresAt?: FirestoreDateLike;
  lastError?: unknown;
  createdAt?: FirestoreDateLike;
  updatedAt?: FirestoreDateLike;
  completedAt?: FirestoreDateLike;
};

type DocumentRecord = {
  title?: unknown;
};

type VersionRecord = {
  version?: unknown;
  filename?: unknown;
  originalFilename?: unknown;
  editorFormat?: unknown;
  editorState?: unknown;
  plainText?: unknown;
};

type ClaimedExportJob = {
  jobId: string;
  orgId: string;
  docId: string;
  versionNumber: number;
  attempts: number;
  maxAttempts: number;
  reason: ExportJobReason;
  requestedByUid: string | null;
};

type ProcessSingleResult =
  | { state: "idle" }
  | {
      state: "processed";
      jobId: string;
      orgId: string;
      docId: string;
      versionNumber: number;
      outcome: "succeeded" | "retry_scheduled" | "failed";
    };

const EXPORT_WORKER_AUDIT_ACTOR_UID = "system:document-export-worker";

export type ProcessQueueBatchResult = {
  ok: true;
  processed: number;
  succeeded: number;
  retryScheduled: number;
  failed: number;
  jobs: Array<{
    jobId: string;
    orgId: string;
    docId: string;
    versionNumber: number;
    outcome: "succeeded" | "retry_scheduled" | "failed";
  }>;
};

export type EnqueueDocumentExportJobArgs = {
  orgId: string;
  docId: string;
  versionNumber: number;
  requestedByUid?: string | null;
  reason: ExportJobReason;
  force?: boolean;
};

export type EnqueueDocumentExportJobResult = {
  ok: true;
  jobId: string;
  queued: boolean;
  status: ExportJobStatus;
};

class PermanentExportJobError extends Error {}

function asDate(value: FirestoreDateLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  try {
    return value.toDate();
  } catch {
    return null;
  }
}

function sanitizeDocKeyPart(input: string) {
  const clean = input
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
  return clean || "id";
}

function buildExportJobId(args: {
  orgId: string;
  docId: string;
  versionNumber: number;
}) {
  const org = sanitizeDocKeyPart(args.orgId);
  const doc = sanitizeDocKeyPart(args.docId);
  const version = Math.max(1, Math.floor(args.versionNumber));
  return `${org}__${doc}__v${version}`;
}

function normalizePositiveInt(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function normalizeStatus(value: unknown): ExportJobStatus {
  if (value === "queued" || value === "processing" || value === "succeeded" || value === "failed") {
    return value;
  }
  return "queued";
}

function normalizeReason(value: unknown): ExportJobReason {
  return value === "regenerate" ? "regenerate" : "save_editor";
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, EXPORT_JOB_MAX_ERROR_LENGTH);
  return "Unknown export job error";
}

function buildRetryDelayMs(nextAttempt: number) {
  const expDelay = Math.min(
    EXPORT_JOB_BACKOFF_MAX_MS,
    EXPORT_JOB_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, nextAttempt - 1)),
  );
  const jitter = Math.floor(Math.random() * 5_000);
  return Math.min(EXPORT_JOB_BACKOFF_MAX_MS, expDelay + jitter);
}

function isTransientErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  const transientSignals = [
    "timeout",
    "timed out",
    "temporarily unavailable",
    "too many requests",
    "rate limit",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "network",
    "deadline exceeded",
    "503",
    "502",
    "500",
    "429",
  ];
  return transientSignals.some((signal) => normalized.includes(signal));
}

function buildTransientRetryAssets(assets: StoredExportAssets): VersionRenderAssets {
  return {
    docx:
      assets.docx.status === "failed"
        ? {
            status: "processing",
            storagePath: assets.docx.storagePath,
            fileType: assets.docx.fileType || DOCX_MIME,
            generatedAt: null,
            error: assets.docx.error,
          }
        : assets.docx,
    pdf:
      assets.pdf.status === "failed"
        ? {
            status: "processing",
            storagePath: assets.pdf.storagePath,
            fileType: assets.pdf.fileType || PDF_MIME,
            generatedAt: null,
            error: assets.pdf.error,
          }
        : assets.pdf,
  };
}

export function buildEditorProcessingRenderAssets(): VersionRenderAssets {
  return {
    docx: {
      status: "processing",
      storagePath: null,
      fileType: DOCX_MIME,
      generatedAt: null,
      error: null,
    },
    pdf: {
      status: "processing",
      storagePath: null,
      fileType: PDF_MIME,
      generatedAt: null,
      error: null,
    },
  };
}

export async function enqueueDocumentExportJob(
  args: EnqueueDocumentExportJobArgs,
): Promise<EnqueueDocumentExportJobResult> {
  const versionNumber = Math.max(1, Math.floor(args.versionNumber));
  const now = new Date();
  const force = Boolean(args.force);
  const jobId = buildExportJobId({
    orgId: args.orgId,
    docId: args.docId,
    versionNumber,
  });
  const ref = adminDb.collection(EXPORT_JOB_COLLECTION).doc(jobId);

  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.data() ?? {}) as ExportJobRecord;
    const currentStatus = normalizeStatus(current.status);

    if (
      snap.exists &&
      (currentStatus === "queued" || currentStatus === "processing") &&
      !force
    ) {
      tx.set(
        ref,
        {
          updatedAt: now,
          requestedByUid: args.requestedByUid ?? null,
          reason: args.reason,
        },
        { merge: true },
      );
      return {
        ok: true as const,
        jobId,
        queued: false,
        status: currentStatus,
      };
    }

    tx.set(
      ref,
      {
        orgId: args.orgId,
        docId: args.docId,
        versionNumber,
        status: "queued",
        reason: args.reason,
        attempts: 0,
        maxAttempts: EXPORT_JOB_DEFAULT_MAX_ATTEMPTS,
        runAfter: now,
        leasedBy: null,
        leaseExpiresAt: null,
        lastError: null,
        requestedByUid: args.requestedByUid ?? null,
        createdAt: snap.exists ? current.createdAt ?? now : now,
        updatedAt: now,
        completedAt: null,
      },
      { merge: true },
    );

    return {
      ok: true as const,
      jobId,
      queued: true,
      status: "queued" as const,
    };
  });

  return result;
}

async function claimNextExportJob(workerId: string): Promise<ClaimedExportJob | null> {
  const now = new Date();
  const scan = await adminDb
    .collection(EXPORT_JOB_COLLECTION)
    .where("runAfter", "<=", now)
    .orderBy("runAfter", "asc")
    .limit(EXPORT_JOB_MAX_CLAIM_SCAN)
    .get();

  for (const doc of scan.docs) {
    const claimed = await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return null;
      const data = (fresh.data() ?? {}) as ExportJobRecord;

      const status = normalizeStatus(data.status);
      const runAfter = asDate(data.runAfter) ?? new Date(0);
      const leaseExpiresAt = asDate(data.leaseExpiresAt);
      const staleLease =
        status === "processing" &&
        leaseExpiresAt instanceof Date &&
        leaseExpiresAt.getTime() <= now.getTime();
      const claimable =
        (status === "queued" && runAfter.getTime() <= now.getTime()) || staleLease;
      if (!claimable) return null;

      const orgId = typeof data.orgId === "string" ? data.orgId.trim() : "";
      const docId = typeof data.docId === "string" ? data.docId.trim() : "";
      const versionNumber = normalizePositiveInt(data.versionNumber, 0);
      if (!orgId || !docId || versionNumber < 1) {
        tx.set(
          fresh.ref,
          {
            status: "failed",
            updatedAt: now,
            completedAt: now,
            lastError: "Invalid export job payload",
            leasedBy: null,
            leaseExpiresAt: null,
          },
          { merge: true },
        );
        return null;
      }

      const attempts = normalizePositiveInt(data.attempts, 0);
      const maxAttempts = normalizePositiveInt(
        data.maxAttempts,
        EXPORT_JOB_DEFAULT_MAX_ATTEMPTS,
      );

      tx.set(
        fresh.ref,
        {
          status: "processing",
          leasedBy: workerId,
          leaseExpiresAt: new Date(now.getTime() + EXPORT_JOB_DEFAULT_LEASE_MS),
          updatedAt: now,
          lastError: null,
        },
        { merge: true },
      );

      return {
        jobId: fresh.id,
        orgId,
        docId,
        versionNumber,
        attempts,
        maxAttempts,
        reason: normalizeReason(data.reason),
        requestedByUid:
          typeof data.requestedByUid === "string" && data.requestedByUid.trim()
            ? data.requestedByUid
            : null,
      } satisfies ClaimedExportJob;
    });

    if (claimed) return claimed;
  }

  return null;
}

async function markJobSucceeded(job: ClaimedExportJob, workerId: string) {
  const now = new Date();
  await adminDb.runTransaction(async (tx) => {
    const ref = adminDb.collection(EXPORT_JOB_COLLECTION).doc(job.jobId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = (snap.data() ?? {}) as ExportJobRecord;
    const status = normalizeStatus(data.status);
    const leasedBy = typeof data.leasedBy === "string" ? data.leasedBy : null;
    if (status !== "processing" || leasedBy !== workerId) return;

    tx.set(
      ref,
      {
        status: "succeeded",
        updatedAt: now,
        completedAt: now,
        leasedBy: null,
        leaseExpiresAt: null,
        lastError: null,
      },
      { merge: true },
    );
  });
}

async function markJobRetry(job: ClaimedExportJob, workerId: string, errorMessage: string) {
  const now = new Date();
  await adminDb.runTransaction(async (tx) => {
    const ref = adminDb.collection(EXPORT_JOB_COLLECTION).doc(job.jobId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = (snap.data() ?? {}) as ExportJobRecord;
    const status = normalizeStatus(data.status);
    const leasedBy = typeof data.leasedBy === "string" ? data.leasedBy : null;
    if (status !== "processing" || leasedBy !== workerId) return;

    const attempts = normalizePositiveInt(data.attempts, job.attempts) + 1;
    const maxAttempts = normalizePositiveInt(data.maxAttempts, job.maxAttempts);
    if (attempts >= maxAttempts) {
      tx.set(
        ref,
        {
          status: "failed",
          attempts,
          updatedAt: now,
          completedAt: now,
          leasedBy: null,
          leaseExpiresAt: null,
          lastError: errorMessage,
        },
        { merge: true },
      );
      return;
    }

    tx.set(
      ref,
      {
        status: "queued",
        attempts,
        runAfter: new Date(now.getTime() + buildRetryDelayMs(attempts)),
        updatedAt: now,
        leasedBy: null,
        leaseExpiresAt: null,
        lastError: errorMessage,
      },
      { merge: true },
    );
  });
}

async function markJobFailed(job: ClaimedExportJob, workerId: string, errorMessage: string) {
  const now = new Date();
  await adminDb.runTransaction(async (tx) => {
    const ref = adminDb.collection(EXPORT_JOB_COLLECTION).doc(job.jobId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = (snap.data() ?? {}) as ExportJobRecord;
    const status = normalizeStatus(data.status);
    const leasedBy = typeof data.leasedBy === "string" ? data.leasedBy : null;
    if (status !== "processing" || leasedBy !== workerId) return;

    tx.set(
      ref,
      {
        status: "failed",
        attempts: normalizePositiveInt(data.attempts, job.attempts) + 1,
        updatedAt: now,
        completedAt: now,
        leasedBy: null,
        leaseExpiresAt: null,
        lastError: errorMessage,
      },
      { merge: true },
    );
  });
}

async function loadDocumentExportPayload(job: ClaimedExportJob) {
  const docRef = adminDb
    .collection("organizations")
    .doc(job.orgId)
    .collection("documents")
    .doc(job.docId);
  const versionRef = docRef.collection("versions").doc(`v${job.versionNumber}`);

  const [docSnap, versionSnap] = await Promise.all([docRef.get(), versionRef.get()]);
  if (!docSnap.exists) {
    throw new PermanentExportJobError("Document not found");
  }
  if (!versionSnap.exists) {
    throw new PermanentExportJobError("Document version not found");
  }

  const doc = (docSnap.data() ?? {}) as DocumentRecord;
  const version = (versionSnap.data() ?? {}) as VersionRecord;
  const editorFormat =
    typeof version.editorFormat === "string" ? version.editorFormat : null;
  if (editorFormat !== LEXICAL_EDITOR_FORMAT) {
    throw new PermanentExportJobError("Version is not lexical editor format");
  }

  const editorState =
    version.editorState && typeof version.editorState === "object"
      ? (version.editorState as Record<string, unknown>)
      : null;
  if (!editorState) {
    throw new PermanentExportJobError("Version is missing editorState");
  }

  const plainText = typeof version.plainText === "string" ? version.plainText : "";
  const filename =
    (typeof version.filename === "string" && version.filename) ||
    (typeof version.originalFilename === "string" && version.originalFilename) ||
    "document";
  const title = typeof doc.title === "string" ? doc.title : "Untitled";

  return {
    docRef,
    versionRef,
    title,
    filename,
    editorState,
    plainText,
  };
}

async function updateVersionRenderAssets(args: {
  orgId: string;
  docId: string;
  versionNumber: number;
  requestedByUid: string | null;
  renderAssets: VersionRenderAssets;
}) {
  const now = new Date();
  const docRef = adminDb
    .collection("organizations")
    .doc(args.orgId)
    .collection("documents")
    .doc(args.docId);
  const versionRef = docRef.collection("versions").doc(`v${args.versionNumber}`);

  const updateBase: Record<string, unknown> = {
    renderAssets: args.renderAssets,
    updatedAt: now,
  };
  if (args.requestedByUid) {
    updateBase.updatedBy = args.requestedByUid;
  }

  const docUpdate: Record<string, unknown> = {
    [`versionMeta.items.v${args.versionNumber}.renderAssets`]: args.renderAssets,
    updatedAt: now,
  };
  if (args.requestedByUid) {
    docUpdate.updatedBy = args.requestedByUid;
  }

  await Promise.all([
    versionRef.set(updateBase, { merge: true }),
    docRef.set(docUpdate, { merge: true }),
  ]);
}

async function processSingleExportJob(workerId: string): Promise<ProcessSingleResult> {
  const claimed = await claimNextExportJob(workerId);
  if (!claimed) return { state: "idle" };
  const auditActorUid = claimed.requestedByUid || EXPORT_WORKER_AUDIT_ACTOR_UID;

  try {
    const payload = await loadDocumentExportPayload(claimed);
    const exportAssets = await generateAndStoreEditorExports({
      orgId: claimed.orgId,
      docId: claimed.docId,
      versionNumber: claimed.versionNumber,
      title: payload.title,
      filename: payload.filename,
      editorState: payload.editorState,
      plainText: payload.plainText,
    });

    await updateVersionRenderAssets({
      orgId: claimed.orgId,
      docId: claimed.docId,
      versionNumber: claimed.versionNumber,
      requestedByUid: claimed.requestedByUid,
      renderAssets: exportAssets,
    });

    const failedErrors = [exportAssets.docx.error, exportAssets.pdf.error].filter(
      (value): value is string => Boolean(value && value.trim()),
    );
    if (failedErrors.length === 0) {
      await markJobSucceeded(claimed, workerId);
      await writeOrgAuditLog({
        orgId: claimed.orgId,
        eventType: "documents.version_exports_generated",
        actorUid: auditActorUid,
        actorEmail: null,
        docId: claimed.docId,
        metadata: {
          version: claimed.versionNumber,
          jobId: claimed.jobId,
          reason: claimed.reason,
          docxStatus: exportAssets.docx.status,
          pdfStatus: exportAssets.pdf.status,
        },
      });
      return {
        state: "processed",
        jobId: claimed.jobId,
        orgId: claimed.orgId,
        docId: claimed.docId,
        versionNumber: claimed.versionNumber,
        outcome: "succeeded",
      };
    }

    const errorMessage = failedErrors.join(" | ").slice(0, EXPORT_JOB_MAX_ERROR_LENGTH);
    const transient = failedErrors.some((msg) => isTransientErrorMessage(msg));
    if (transient) {
      const retryAssets = buildTransientRetryAssets(exportAssets);
      await updateVersionRenderAssets({
        orgId: claimed.orgId,
        docId: claimed.docId,
        versionNumber: claimed.versionNumber,
        requestedByUid: claimed.requestedByUid,
        renderAssets: retryAssets,
      });
      await markJobRetry(claimed, workerId, errorMessage);
      await writeOrgAuditLog({
        orgId: claimed.orgId,
        eventType: "documents.version_exports_retry_scheduled",
        actorUid: auditActorUid,
        actorEmail: null,
        docId: claimed.docId,
        metadata: {
          version: claimed.versionNumber,
          jobId: claimed.jobId,
          reason: claimed.reason,
          error: errorMessage,
        },
      });
      return {
        state: "processed",
        jobId: claimed.jobId,
        orgId: claimed.orgId,
        docId: claimed.docId,
        versionNumber: claimed.versionNumber,
        outcome: "retry_scheduled",
      };
    }

    await markJobFailed(claimed, workerId, errorMessage);
    await writeOrgAuditLog({
      orgId: claimed.orgId,
      eventType: "documents.version_exports_failed",
      actorUid: auditActorUid,
      actorEmail: null,
      docId: claimed.docId,
      metadata: {
        version: claimed.versionNumber,
        jobId: claimed.jobId,
        reason: claimed.reason,
        error: errorMessage,
      },
    });
    return {
      state: "processed",
      jobId: claimed.jobId,
      orgId: claimed.orgId,
      docId: claimed.docId,
      versionNumber: claimed.versionNumber,
      outcome: "failed",
    };
  } catch (error: unknown) {
    const errorMessage = normalizeErrorMessage(error);
    if (error instanceof PermanentExportJobError) {
      await markJobFailed(claimed, workerId, errorMessage);
      await writeOrgAuditLog({
        orgId: claimed.orgId,
        eventType: "documents.version_exports_failed",
        actorUid: auditActorUid,
        actorEmail: null,
        docId: claimed.docId,
        metadata: {
          version: claimed.versionNumber,
          jobId: claimed.jobId,
          reason: claimed.reason,
          error: errorMessage,
          permanent: true,
        },
      });
      return {
        state: "processed",
        jobId: claimed.jobId,
        orgId: claimed.orgId,
        docId: claimed.docId,
        versionNumber: claimed.versionNumber,
        outcome: "failed",
      };
    }

    await markJobRetry(claimed, workerId, errorMessage);
    return {
      state: "processed",
      jobId: claimed.jobId,
      orgId: claimed.orgId,
      docId: claimed.docId,
      versionNumber: claimed.versionNumber,
      outcome: "retry_scheduled",
    };
  }
}

export async function processDocumentExportQueueBatch(args?: {
  maxJobs?: number;
  workerId?: string;
}): Promise<ProcessQueueBatchResult> {
  const maxJobs = Math.max(1, Math.min(EXPORT_JOB_MAX_BATCH, args?.maxJobs ?? 1));
  const workerId =
    args?.workerId?.trim() ||
    `worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const jobs: ProcessQueueBatchResult["jobs"] = [];
  let succeeded = 0;
  let retryScheduled = 0;
  let failed = 0;

  for (let i = 0; i < maxJobs; i += 1) {
    const result = await processSingleExportJob(workerId);
    if (result.state === "idle") break;

    jobs.push({
      jobId: result.jobId,
      orgId: result.orgId,
      docId: result.docId,
      versionNumber: result.versionNumber,
      outcome: result.outcome,
    });
    if (result.outcome === "succeeded") succeeded += 1;
    else if (result.outcome === "retry_scheduled") retryScheduled += 1;
    else failed += 1;
  }

  return {
    ok: true,
    processed: jobs.length,
    succeeded,
    retryScheduled,
    failed,
    jobs,
  };
}

export async function triggerExportWorkerKick(args: {
  requestUrl: string;
  maxJobs?: number;
}) {
  const secret = process.env.DOCUMENT_EXPORT_WORKER_SECRET?.trim();
  if (!secret) return false;

  let origin = "";
  try {
    origin = new URL(args.requestUrl).origin;
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);

  try {
    await fetch(`${origin}/api/internal/documents/export-jobs/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-export-worker-secret": secret,
      },
      body: JSON.stringify({ maxJobs: Math.max(1, Math.min(10, args.maxJobs ?? 1)) }),
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
