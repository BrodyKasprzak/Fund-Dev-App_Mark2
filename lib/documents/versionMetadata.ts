export const LEXICAL_EDITOR_FORMAT = "lexical-json-v1";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";

export type RenderAssetStatus =
  | "not_generated"
  | "processing"
  | "ready"
  | "failed";

export type VersionRenderAsset = {
  status: RenderAssetStatus;
  storagePath: string | null;
  fileType: string | null;
  generatedAt: Date | null;
  error: string | null;
};

export type VersionRenderAssets = {
  docx: VersionRenderAsset;
  pdf: VersionRenderAsset;
};

export type VersionEditorPayload = {
  editorFormat: string | null;
  editorState: Record<string, unknown> | null;
  plainText: string | null;
};

function notGeneratedAsset(fileType: string): VersionRenderAsset {
  return {
    status: "not_generated",
    storagePath: null,
    fileType,
    generatedAt: null,
    error: null,
  };
}

function processingAsset(args: {
  storagePath: string;
  fileType: string;
}): VersionRenderAsset {
  return {
    status: "processing",
    storagePath: args.storagePath.trim() || null,
    fileType: args.fileType.trim() || null,
    generatedAt: null,
    error: null,
  };
}

export function emptyVersionEditorPayload(): VersionEditorPayload {
  return {
    editorFormat: null,
    editorState: null,
    plainText: null,
  };
}

export function buildRenderAssetsFromStoredFile(args: {
  storagePath: string;
  fileType: string;
  now: Date;
}): VersionRenderAssets {
  const { storagePath, fileType, now } = args;
  const normalizedPath = storagePath.trim();
  const normalizedType = fileType.trim();

  const docx =
    normalizedType === DOCX_MIME && normalizedPath
      ? {
          status: "ready" as const,
          storagePath: normalizedPath,
          fileType: DOCX_MIME,
          generatedAt: now,
          error: null,
        }
      : notGeneratedAsset(DOCX_MIME);

  const pdf =
    normalizedType === PDF_MIME && normalizedPath
      ? {
          status: "ready" as const,
          storagePath: normalizedPath,
          fileType: PDF_MIME,
          generatedAt: now,
          error: null,
        }
      : notGeneratedAsset(PDF_MIME);

  return { docx, pdf };
}

export function buildPendingRenderAssets(args: {
  storagePath: string;
  fileType: string;
}): VersionRenderAssets {
  const { storagePath, fileType } = args;
  const normalizedType = fileType.trim();

  const docx =
    normalizedType === DOCX_MIME
      ? processingAsset({ storagePath, fileType: DOCX_MIME })
      : notGeneratedAsset(DOCX_MIME);

  const pdf =
    normalizedType === PDF_MIME
      ? processingAsset({ storagePath, fileType: PDF_MIME })
      : notGeneratedAsset(PDF_MIME);

  return { docx, pdf };
}
