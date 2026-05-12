import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireDocumentReadAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  normalizeDocumentPermissions,
  userCanReadDocument,
} from "@/lib/documentPermissions";
import {
  DOCX_MIME,
  PDF_MIME,
  type RenderAssetStatus,
} from "@/lib/documents/versionMetadata";

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
  editorFormat?: unknown;
  editorState?: unknown;
  plainText?: unknown;
  docxImportPipeline?: unknown;
  importFidelityProfile?: unknown;
  renderAssets?: unknown;
};

type ParentDocumentRecord = {
  title?: unknown;
  storagePath?: unknown;
  originalStoragePath?: unknown;
  filename?: unknown;
  originalFilename?: unknown;
  fileType?: unknown;
  originalFileType?: unknown;
  size?: unknown;
  status?: unknown;
  createdAt?: FirestoreDateLike;
  createdBy?: unknown;
  updatedAt?: FirestoreDateLike;
  updatedBy?: unknown;
  lastVersionChangeAt?: FirestoreDateLike;
  version?: unknown;
  currentVersionNumber?: unknown;
  versionMeta?: unknown;
};

type RenderAssetRecord = {
  status?: unknown;
  storagePath?: unknown;
  fileType?: unknown;
  generatedAt?: FirestoreDateLike;
  error?: unknown;
};

type SerializedRenderAsset = {
  status: RenderAssetStatus;
  storagePath: string | null;
  fileType: string | null;
  generatedAt: string | null;
  error: string | null;
};

type SerializedRenderAssets = {
  docx: SerializedRenderAsset;
  pdf: SerializedRenderAsset;
};

type SerializedImportFidelityProfile = {
  pipeline: string;
  source: string;
  mappedFeatures: string[];
  downgradedFeatures: string[];
  fallbackUsed: boolean;
  fallbackReason: string | null;
  measuredAt: string | null;
};

function sanitizeFeatureList(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, 80);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeImportFidelityProfile(raw: unknown): SerializedImportFidelityProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as {
    pipeline?: unknown;
    source?: unknown;
    mappedFeatures?: unknown;
    downgradedFeatures?: unknown;
    fallbackUsed?: unknown;
    fallbackReason?: unknown;
    measuredAt?: FirestoreDateLike;
  };
  const pipeline =
    typeof record.pipeline === "string" && record.pipeline.trim()
      ? record.pipeline.trim().slice(0, 120)
      : null;
  if (!pipeline) return null;
  const source =
    typeof record.source === "string" && record.source.trim()
      ? record.source.trim().slice(0, 80)
      : "docx_mammoth_html";
  return {
    pipeline,
    source,
    mappedFeatures: sanitizeFeatureList(record.mappedFeatures),
    downgradedFeatures: sanitizeFeatureList(record.downgradedFeatures),
    fallbackUsed: record.fallbackUsed === true,
    fallbackReason:
      typeof record.fallbackReason === "string" && record.fallbackReason.trim()
        ? record.fallbackReason.trim().slice(0, 120)
        : null,
    measuredAt: toIso(record.measuredAt),
  };
}

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

function normalizeRenderAsset(
  raw: unknown,
  defaults: { fileType: string },
): SerializedRenderAsset {
  const record = raw && typeof raw === "object" ? (raw as RenderAssetRecord) : null;
  const allowed: RenderAssetStatus[] = ["not_generated", "processing", "ready", "failed"];
  const status = allowed.includes(record?.status as RenderAssetStatus)
    ? (record?.status as RenderAssetStatus)
    : "not_generated";
  return {
    status,
    storagePath:
      typeof record?.storagePath === "string" && record.storagePath.trim()
        ? record.storagePath
        : null,
    fileType:
      typeof record?.fileType === "string" && record.fileType.trim()
        ? record.fileType
        : defaults.fileType,
    generatedAt: toIso(record?.generatedAt),
    error: typeof record?.error === "string" && record.error.trim() ? record.error : null,
  };
}

function normalizeRenderAssets(raw: unknown): SerializedRenderAssets {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    docx: normalizeRenderAsset(record.docx, { fileType: DOCX_MIME }),
    pdf: normalizeRenderAsset(record.pdf, { fileType: PDF_MIME }),
  };
}

function inferRenderAssetsFromFile(args: { storagePath: unknown; fileType: unknown }) {
  const storagePath =
    typeof args.storagePath === "string" && args.storagePath.trim()
      ? args.storagePath
      : null;
  const fileType =
    typeof args.fileType === "string" && args.fileType.trim() ? args.fileType : null;
  return normalizeRenderAssets({
    docx: {
      status: fileType === DOCX_MIME && storagePath ? "ready" : "not_generated",
      storagePath: fileType === DOCX_MIME ? storagePath : null,
      fileType: DOCX_MIME,
    },
    pdf: {
      status: fileType === PDF_MIME && storagePath ? "ready" : "not_generated",
      storagePath: fileType === PDF_MIME ? storagePath : null,
      fileType: PDF_MIME,
    },
  });
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
    editorFormat:
      typeof record.editorFormat === "string" ? record.editorFormat : null,
    editorState:
      record.editorState && typeof record.editorState === "object"
        ? (record.editorState as Record<string, unknown>)
        : null,
    plainText: typeof record.plainText === "string" ? record.plainText : null,
    docxImportPipeline:
      typeof record.docxImportPipeline === "string" ? record.docxImportPipeline : null,
    importFidelityProfile: normalizeImportFidelityProfile(record.importFidelityProfile),
    renderAssets:
      record.renderAssets !== undefined
        ? normalizeRenderAssets(record.renderAssets)
        : inferRenderAssetsFromFile({
            storagePath: record.storagePath,
            fileType: record.fileType,
          }),
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

function fallbackCurrentVersionFromParentDocument(
  data: ParentDocumentRecord,
  currentVersionNumber: number,
) {
  const storagePath = typeof data.storagePath === "string" ? data.storagePath : "";
  if (!storagePath) return null;

  return {
    version: currentVersionNumber,
    storagePath,
    filename: typeof data.filename === "string" ? data.filename : null,
    originalFilename:
      typeof data.originalFilename === "string" ? data.originalFilename : null,
    fileType:
      typeof data.fileType === "string" ? data.fileType : "application/octet-stream",
    size: typeof data.size === "number" ? data.size : 0,
    status: typeof data.status === "string" ? data.status : "processing",
    source: "upload",
    changeSummary: currentVersionNumber === 1 ? "Initial upload" : null,
    editorFormat: null,
    editorState: null,
    plainText: null,
    docxImportPipeline: null,
    importFidelityProfile: null,
    renderAssets:
      inferRenderAssetsFromFile({
        storagePath: data.storagePath,
        fileType: data.fileType,
      }),
    createdAt: toIso(data.createdAt),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : null,
    updatedAt: toIso(data.updatedAt),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    promotedAt: toIso(data.lastVersionChangeAt) || toIso(data.updatedAt),
    promotedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    isCurrent: true,
  };
}

function mergeVersionRows(
  primary: ReturnType<typeof serializeVersion>[],
  secondary: ReturnType<typeof serializeVersion>[],
) {
  const byVersion = new Map<number, ReturnType<typeof serializeVersion>>();
  for (const row of secondary) byVersion.set(row.version, row);
  for (const row of primary) byVersion.set(row.version, row);
  return Array.from(byVersion.values()).sort((a, b) => b.version - a.version);
}

function ensureSyntheticOriginalVersion(args: {
  versions: ReturnType<typeof serializeVersion>[];
  docData: ParentDocumentRecord;
  currentVersionNumber: number;
  orgId: string;
  docId: string;
}) {
  const { versions, docData, currentVersionNumber, orgId, docId } = args;
  if (currentVersionNumber <= 1) return versions;
  if (versions.some((row) => row.version === 1)) return versions;

  const originalStoragePath =
    typeof docData.originalStoragePath === "string"
      ? docData.originalStoragePath.trim()
      : "";
  if (!originalStoragePath) return versions;
  if (!originalStoragePath.startsWith(`organizations/${orgId}/documents/${docId}/`)) {
    return versions;
  }

  const syntheticV1: ReturnType<typeof serializeVersion> = {
    version: 1,
    storagePath: originalStoragePath,
    filename:
      typeof docData.originalFilename === "string"
        ? docData.originalFilename
        : typeof docData.filename === "string"
          ? docData.filename
          : null,
    originalFilename:
      typeof docData.originalFilename === "string"
        ? docData.originalFilename
        : typeof docData.filename === "string"
          ? docData.filename
          : null,
    fileType:
      typeof docData.originalFileType === "string"
        ? docData.originalFileType
        : typeof docData.fileType === "string"
          ? docData.fileType
          : "application/octet-stream",
    size: 0,
    status: "ready",
    source: "upload",
    changeSummary: "Initial upload",
    editorFormat: null,
    editorState: null,
    plainText: null,
    docxImportPipeline: null,
    importFidelityProfile: null,
    renderAssets: normalizeRenderAssets({
      docx: {
        status:
          (typeof docData.originalFileType === "string"
            ? docData.originalFileType
            : docData.fileType) === DOCX_MIME
            ? "ready"
            : "not_generated",
        storagePath:
          (typeof docData.originalFileType === "string"
            ? docData.originalFileType
            : docData.fileType) === DOCX_MIME
            ? originalStoragePath
            : null,
        fileType: DOCX_MIME,
      },
      pdf: {
        status:
          (typeof docData.originalFileType === "string"
            ? docData.originalFileType
            : docData.fileType) === PDF_MIME
            ? "ready"
            : "not_generated",
        storagePath:
          (typeof docData.originalFileType === "string"
            ? docData.originalFileType
            : docData.fileType) === PDF_MIME
            ? originalStoragePath
            : null,
        fileType: PDF_MIME,
      },
    }),
    createdAt: toIso(docData.createdAt),
    createdBy: typeof docData.createdBy === "string" ? docData.createdBy : null,
    updatedAt: toIso(docData.createdAt),
    updatedBy: typeof docData.createdBy === "string" ? docData.createdBy : null,
    promotedAt: toIso(docData.createdAt),
    promotedBy: typeof docData.createdBy === "string" ? docData.createdBy : null,
    isCurrent: false,
  };

  return [...versions, syntheticV1].sort((a, b) => b.version - a.version);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid, role } = await requireDocumentReadAccess(req);
    const { docId } = await context.params;
    const { searchParams } = new URL(req.url);
    const modeParam = (searchParams.get("mode") || "all").trim().toLowerCase();
    if (modeParam !== "all" && modeParam !== "current") {
      return NextResponse.json({ error: "mode must be one of: all, current" }, { status: 400 });
    }
    const currentOnly = modeParam === "current";

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

    const docData = (docSnap.data() ?? {}) as ParentDocumentRecord;
    const currentVersionNumber = normalizeVersion(
      docData.currentVersionNumber,
      normalizeVersion(docData.version, 1),
    );

    if (currentOnly) {
      const currentVersionSnap = await docRef
        .collection("versions")
        .doc(`v${currentVersionNumber}`)
        .get();

      let currentVersion: ReturnType<typeof serializeVersion> | null = null;
      if (currentVersionSnap.exists) {
        currentVersion = serializeVersion(
          currentVersionSnap.data() as VersionDocRecord,
          currentVersionNumber,
        );
      } else {
        const fromMeta = fallbackVersionsFromVersionMeta(docData, currentVersionNumber);
        currentVersion = fromMeta.find((row) => row.version === currentVersionNumber) || null;
      }

      if (!currentVersion) {
        currentVersion = fallbackCurrentVersionFromParentDocument(docData, currentVersionNumber);
      }

      return NextResponse.json({
        ok: true,
        currentVersionNumber,
        versions: currentVersion ? [currentVersion] : [],
      });
    }

    const versionsSnap = await docRef
      .collection("versions")
      .orderBy("version", "desc")
      .limit(VERSION_LIST_MAX_ITEMS)
      .get();

    const fromCollection = versionsSnap.docs.map((snapshot) =>
      serializeVersion(snapshot.data() as VersionDocRecord, currentVersionNumber),
    );
    const fromMeta = fallbackVersionsFromVersionMeta(docData, currentVersionNumber);
    let versions = mergeVersionRows(fromCollection, fromMeta);
    versions = ensureSyntheticOriginalVersion({
      versions,
      docData,
      currentVersionNumber,
      orgId,
      docId,
    });
    if (versions.length === 0) {
      const fromParent = fallbackCurrentVersionFromParentDocument(
        docData,
        currentVersionNumber,
      );
      if (fromParent) versions = [fromParent];
    }

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
