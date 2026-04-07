"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { TRANSFORMERS } from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { useAuth } from "@/lib/AuthContext";
import { LexicalEditorToolbarPlugin } from "@/components/editor/plugins/LexicalEditorToolbarPlugin";
import { LexicalPasteCleanupPlugin } from "@/components/editor/plugins/LexicalPasteCleanupPlugin";
import { LEXICAL_EDITOR_FORMAT } from "@/lib/documents/versionMetadata";

type DocStatus = "ready" | "processing" | "failed";
type TextStatus = "pending" | "processing" | "ready" | "failed";
type ExportFormat = "docx" | "pdf" | "original";
type VersionLoadMode = "current" | "all";

type DocumentDetail = {
  id: string;
  title: string;
  fileType: string;
  status: DocStatus;
  textStatus: TextStatus;
  version: number;
  currentVersionNumber?: number;
  extractedText: string | null;
  textWindow?: {
    offset: number;
    limit: number;
    returnedChars: number;
    totalChars: number;
    hasMore: boolean;
    nextOffset: number | null;
    anchoredQuery: string | null;
    matchOffset: number | null;
  };
  updatedAt: string | null;
  createdAt: string | null;
};

type DocumentVersionItem = {
  version: number;
  storagePath: string;
  filename: string | null;
  originalFilename: string | null;
  fileType: string;
  size: number;
  status: string;
  source: string;
  changeSummary: string | null;
  createdAt: string | null;
  createdBy: string | null;
  promotedAt: string | null;
  isCurrent: boolean;
  editorFormat?: string | null;
  editorState?: Record<string, unknown> | null;
  plainText?: string | null;
  renderAssets?: {
    docx?: {
      status?: string;
      storagePath?: string | null;
      fileType?: string | null;
      generatedAt?: string | null;
      error?: string | null;
    };
    pdf?: {
      status?: string;
      storagePath?: string | null;
      fileType?: string | null;
      generatedAt?: string | null;
      error?: string | null;
    };
  };
};

type SaveEditorResponse = {
  error?: unknown;
  versionSaved?: unknown;
  versionNumber?: unknown;
};

const MAX_CHANGE_SUMMARY_LENGTH = 500;
const MAX_DOWNLOAD_FILENAME_LENGTH = 220;
const DEFAULT_FONT_SIZE = "14px";
const DOCX_PAGE_MAX_WIDTH_PX = 816;
const DOCX_PAGE_HEIGHT_PX = 1056;
const DOCX_PAGE_GAP_PX = 14;
const DOCX_PAGE_BOTTOM_MARGIN_PX = 72;
const DOCX_BODY_FONT_SIZE_PT = 11;
const DOCX_BODY_LINE_HEIGHT = 1.15;
const DOCX_BODY_FONT_FAMILY = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";
const CHUNK_VIEW_OFFSET_PADDING = 8_000;

const lexicalTheme: InitialConfigType["theme"] = {
  paragraph: "mb-2",
  code: "my-3 block rounded-md bg-slate-900 px-3 py-2 font-mono text-[13px] leading-6 text-slate-100",
  quote: "border-l-2 border-slate-300 pl-3 italic text-slate-700",
  heading: {
    h1: "text-2xl font-semibold leading-tight mt-4 mb-2",
    h2: "text-xl font-semibold leading-tight mt-4 mb-2",
    h3: "text-lg font-semibold leading-tight mt-3 mb-2",
    h4: "text-base font-semibold leading-tight mt-3 mb-2",
    h5: "text-sm font-semibold leading-tight mt-2 mb-1",
    h6: "text-xs font-semibold leading-tight mt-2 mb-1 uppercase tracking-wide",
  },
  list: {
    listitem: "ml-5",
    listitemChecked: "ml-5 list-none",
    listitemUnchecked: "ml-5 list-none",
    nested: {
      listitem: "ml-4",
    },
    olDepth: ["list-decimal", "list-[lower-alpha]", "list-[lower-roman]"],
    ul: "list-disc",
  },
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.95em]",
  },
  link: "text-sky-700 underline",
  table: "my-3 w-full border-collapse border border-slate-300",
  tableRow: "border border-slate-300",
  tableCell: "border border-slate-300 px-2 py-1 align-top",
  tableCellHeader:
    "border border-slate-300 bg-slate-100 px-2 py-1 align-top font-semibold text-slate-800",
};

function asOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asEditorStateObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseInitialEditorState(value: Record<string, unknown> | null | undefined) {
  if (!value) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function parseFilenameFromContentDisposition(contentDisposition: string | null) {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // fall through
    }
  }

  const plainMatch = contentDisposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  const plainFilename = plainMatch?.[1] || plainMatch?.[2];
  if (plainFilename) return plainFilename.trim();
  return null;
}

function sanitizeDownloadFilename(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/[\/\\]+/g, "_")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>:"|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, MAX_DOWNLOAD_FILENAME_LENGTH)
    .trim();
  return cleaned || "document";
}

function buildLexicalStateFromPlainText(input: string) {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const paragraphs = normalized
    ? normalized
        .split(/\n{2,}/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  const paragraphNodes =
    paragraphs.length > 0
      ? paragraphs.map((line) => ({
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text: line,
              type: "text",
              version: 1,
            },
          ],
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        }))
      : [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "",
                type: "text",
                version: 1,
              },
            ],
            direction: null,
            format: "",
            indent: 0,
            type: "paragraph",
            version: 1,
          },
        ];

  return {
    root: {
      children: paragraphNodes,
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  } as Record<string, unknown>;
}

function formatDate(iso: string | null) {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeExportStatus(value: unknown) {
  if (value === "ready" || value === "processing" || value === "failed") return value;
  return "not_generated";
}

function formatExportStatusLabel(value: string) {
  if (value === "ready") return "Ready";
  if (value === "processing") return "Processing";
  if (value === "failed") return "Failed";
  return "Not generated";
}

function EditorEditablePlugin(props: { editable: boolean }) {
  const { editable } = props;
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);

  return null;
}

export default function DocumentEditorPage() {
  const router = useRouter();
  const params = useParams<{ docId: string | string[] }>();
  const searchParams = useSearchParams();
  const { user, loading, authedFetch } = useAuth();

  const docId = useMemo(() => {
    const raw = params?.docId;
    if (Array.isArray(raw)) return raw[0] || "";
    return raw || "";
  }, [params]);

  const highlightChunkId = useMemo(
    () => asOptionalString(searchParams.get("highlight")),
    [searchParams],
  );

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [initialEditorState, setInitialEditorState] = useState<Record<string, unknown> | null>(
    null,
  );
  const [editorDraftState, setEditorDraftState] = useState<Record<string, unknown> | null>(null);
  const [editorSessionKey, setEditorSessionKey] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [changeSummary, setChangeSummary] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [lastSaveAt, setLastSaveAt] = useState<string | null>(null);
  const [statusInfoOpen, setStatusInfoOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);
  const [loadedVersionMode, setLoadedVersionMode] = useState<VersionLoadMode | null>(null);
  const [regeneratingVersion, setRegeneratingVersion] = useState<number | null>(null);
  const [viewerHighlightQuery, setViewerHighlightQuery] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstMatchRef = useRef<HTMLElement | null>(null);

  const canEdit = doc?.status === "ready" && doc?.textStatus === "ready";
  const canDownloadDoc = Boolean(doc?.id && doc.status === "ready");
  const currentVersion = doc?.currentVersionNumber ?? doc?.version ?? 1;
  const highlightParagraphs = useMemo(() => {
    const extractedText = doc?.extractedText?.trim() || "";
    return extractedText ? splitParagraphs(extractedText) : [];
  }, [doc?.extractedText]);
  const effectiveHighlightQuery = (viewerHighlightQuery || "").trim();

  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: `document-editor-page-${docId || "unknown"}`,
      theme: lexicalTheme,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        CodeNode,
        TableNode,
        TableRowNode,
        TableCellNode,
      ],
      onError: (editorError: Error) => {
        throw editorError;
      },
      editable: Boolean(canEdit) && isEditMode && !savingVersion,
      editorState: parseInitialEditorState(initialEditorState),
    }),
    [canEdit, docId, initialEditorState, isEditMode, savingVersion],
  );

  const fetchDocumentVersions = useCallback(
    async (nextDocId: string, mode: VersionLoadMode = "all") => {
      const cleanedDocId = nextDocId.trim();
      if (!cleanedDocId) return [] as DocumentVersionItem[];

      const params = new URLSearchParams();
      params.set("mode", mode);
      const versionsRes = await authedFetch(
        `/api/documents/${encodeURIComponent(cleanedDocId)}/versions?${params.toString()}`,
      );
      const versionsData = await versionsRes.json().catch(() => ({}));
      if (!versionsRes.ok) {
        throw new Error(versionsData?.error || "Failed to load version history");
      }

      return Array.isArray(versionsData?.versions)
        ? (versionsData.versions as DocumentVersionItem[])
        : [];
    },
    [authedFetch],
  );

  const loadDocumentVersions = useCallback(
    async (nextDocId: string, mode: VersionLoadMode = "all") => {
      const cleanedDocId = nextDocId.trim();
      if (!cleanedDocId) {
        setVersions([]);
        setLoadedVersionMode(null);
        return;
      }

      setVersionHistoryLoading(true);
      setVersionHistoryError(null);
      try {
        const rows = await fetchDocumentVersions(cleanedDocId, mode);
        setVersions(rows);
        setLoadedVersionMode(mode);
      } catch (err: unknown) {
        setVersions([]);
        setLoadedVersionMode(null);
        if (err instanceof Error) setVersionHistoryError(err.message);
        else setVersionHistoryError("Failed to load version history");
      } finally {
        setVersionHistoryLoading(false);
      }
    },
    [fetchDocumentVersions],
  );

  const loadDocument = useCallback(async () => {
    const cleanedDocId = docId.trim();
    if (!cleanedDocId) return;

    setLoadingDoc(true);
    setError(null);
    setMessage(null);

    try {
      let highlightAnchorQuery: string | null = null;
      let highlightText: string | null = null;
      let chunkStartOffset: number | null = null;

      if (highlightChunkId) {
        try {
          const chunkContextRes = await authedFetch(
            `/api/documents/${encodeURIComponent(cleanedDocId)}/chunk-context?chunkId=${encodeURIComponent(highlightChunkId)}`,
          );
          const chunkContextData = await chunkContextRes.json().catch(() => ({}));
          if (chunkContextRes.ok) {
            highlightAnchorQuery = asOptionalString(chunkContextData?.anchorQuery);
            highlightText = asOptionalString(chunkContextData?.highlightText);
            chunkStartOffset =
              typeof chunkContextData?.startOffset === "number" &&
              Number.isFinite(chunkContextData.startOffset)
                ? Math.max(0, Math.floor(chunkContextData.startOffset))
                : null;
          }
        } catch {
          // Keep editor bootstrap resilient if chunk context lookup has a transient failure.
        }
      }

      const detailParams = new URLSearchParams();
      detailParams.set("limit", "50000");
      if (highlightAnchorQuery) detailParams.set("q", highlightAnchorQuery);
      if (chunkStartOffset !== null) {
        detailParams.set(
          "offset",
          String(Math.max(0, chunkStartOffset - CHUNK_VIEW_OFFSET_PADDING)),
        );
      }

      const detailRes = await authedFetch(
        `/api/documents/${encodeURIComponent(cleanedDocId)}?${detailParams.toString()}`,
      );
      const detailData = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) {
        throw new Error(detailData?.error || "Failed to load document");
      }

      const nextDoc = detailData?.document as DocumentDetail | undefined;
      if (!nextDoc?.id) {
        throw new Error("Document not found");
      }

      let currentVersionRows: DocumentVersionItem[] = [];
      try {
        currentVersionRows = await fetchDocumentVersions(cleanedDocId, "current");
      } catch {
        // Keep editor bootstrap resilient if versions lookup has a transient failure.
      }

      const currentRow =
        currentVersionRows.find((row) => row?.isCurrent) || currentVersionRows[0] || null;
      const persistedEditorState = asEditorStateObject(currentRow?.editorState);
      const sourceText =
        (typeof currentRow?.plainText === "string" ? currentRow.plainText : nextDoc.extractedText || "") ||
        "";
      const normalizedText = sourceText.trim();
      const nextEditorState = persistedEditorState || buildLexicalStateFromPlainText(normalizedText);

      const versionFromCurrentRow =
        typeof currentRow?.version === "number" && Number.isFinite(currentRow.version)
          ? Math.max(1, Math.floor(currentRow.version))
          : undefined;

      setDoc({
        ...nextDoc,
        currentVersionNumber:
          versionFromCurrentRow ??
          (typeof nextDoc.currentVersionNumber === "number" ? nextDoc.currentVersionNumber : undefined),
      });
      setInitialEditorState(nextEditorState);
      setEditorDraftState(nextEditorState);
      setEditorSessionKey((value) => value + 1);
      setChangeSummary("");
      setStatusInfoOpen(false);
      setVersionHistoryOpen(false);
      setVersionHistoryError(null);
      setVersions(currentVersionRows);
      setLoadedVersionMode("current");
      setIsEditMode(false);
      setViewerHighlightQuery(highlightText || highlightAnchorQuery || null);
    } catch (err: unknown) {
      setDoc(null);
      setVersions([]);
      setLoadedVersionMode(null);
      setViewerHighlightQuery(null);
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load document");
    } finally {
      setLoadingDoc(false);
    }
  }, [authedFetch, docId, fetchDocumentVersions, highlightChunkId]);

  useEffect(() => {
    if (loading || user) return;
    const target = `/documents/${encodeURIComponent(docId)}/edit`;
    router.replace(`/login?next=${encodeURIComponent(target)}`);
  }, [docId, loading, router, user]);

  useEffect(() => {
    if (loading || !user || !docId.trim()) return;
    void loadDocument();
  }, [docId, loadDocument, loading, user]);

  useEffect(() => {
    if (!versionHistoryOpen || !docId.trim()) return;
    if (loadedVersionMode === "all") return;
    void loadDocumentVersions(docId, "all");
  }, [docId, loadDocumentVersions, loadedVersionMode, versionHistoryOpen]);

  useEffect(() => {
    if (!effectiveHighlightQuery || !firstMatchRef.current) return;
    firstMatchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [effectiveHighlightQuery, doc?.extractedText]);

  function goBackToDocuments() {
    router.push("/documents");
  }

  function toggleEditMode() {
    if (!canEdit) {
      setError("Document text must be ready before editing.");
      return;
    }
    setError(null);
    setMessage(null);
    setIsEditMode((current) => !current);
  }

  async function handleSaveVersion() {
    if (!docId.trim()) return;
    if (!canEdit) {
      setError("Document text must be ready before editing.");
      return;
    }

    const summary = changeSummary.trim();
    if (!summary) {
      setError("Please add a change summary before saving.");
      return;
    }

    const editorState = asEditorStateObject(editorDraftState);
    if (!editorState) {
      setError("Editor state is not ready yet. Make a small edit and try again.");
      return;
    }

    setSavingVersion(true);
    setError(null);
    setMessage(null);

    let savedVersion: number | null = null;

    try {
      const res = await authedFetch(
        `/api/documents/${encodeURIComponent(docId)}/versions/save-editor`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedCurrentVersion: currentVersion,
            changeSummary: summary.slice(0, MAX_CHANGE_SUMMARY_LENGTH),
            editorFormat: LEXICAL_EDITOR_FORMAT,
            editorState,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as SaveEditorResponse;

      if (typeof data.versionNumber === "number" && Number.isFinite(data.versionNumber)) {
        savedVersion = Math.max(1, Math.floor(data.versionNumber));
      }

      if (!res.ok) {
        if (data.versionSaved === true && savedVersion !== null) {
          await loadDocument();
          setIsEditMode(true);
          setLastSaveAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
          setMessage(
            `Saved as version v${savedVersion}. Some background processing is still completing.`,
          );
          return;
        }

        const apiError =
          typeof data.error === "string" ? data.error : "Failed to save document version";
        throw new Error(apiError);
      }

      await loadDocument();
      setIsEditMode(true);
      setLastSaveAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      setMessage(`Saved as version v${savedVersion ?? currentVersion + 1}.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to save document version");
    } finally {
      setSavingVersion(false);
    }
  }

  async function handleDownloadDocument(args?: {
    version?: number | null;
    target?: "current" | "original";
    format?: ExportFormat | null;
  }) {
    const cleanedDocId = docId.trim();
    if (!cleanedDocId) return;

    const target = args?.target || "current";
    const format = args?.format || null;
    const version =
      typeof args?.version === "number" && Number.isFinite(args.version) && args.version > 0
        ? Math.floor(args.version)
        : null;

    setError(null);
    setMessage(null);
    setDownloadingDocId(cleanedDocId);

    try {
      const params = new URLSearchParams();
      params.set("target", target);
      if (version !== null) params.set("version", String(version));
      if (format) params.set("format", format);

      const res = await authedFetch(
        `/api/documents/${encodeURIComponent(cleanedDocId)}/download?${params.toString()}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to download document");
      }

      const blob = await res.blob();
      const fromHeader = parseFilenameFromContentDisposition(
        res.headers.get("Content-Disposition"),
      );
      const fallbackName = doc?.title || "document";
      const filename = sanitizeDownloadFilename(fromHeader || fallbackName);
      const objectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setMessage("Download started.");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to download document");
    } finally {
      setDownloadingDocId(null);
    }
  }

  async function handleRegenerateVersionExports(versionNumber: number) {
    const cleanedDocId = docId.trim();
    if (!cleanedDocId || !Number.isFinite(versionNumber) || versionNumber < 1) return;

    setRegeneratingVersion(versionNumber);
    setError(null);
    setMessage(null);
    try {
      const res = await authedFetch(
        `/api/documents/${encodeURIComponent(cleanedDocId)}/versions/${encodeURIComponent(String(versionNumber))}/regenerate`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to regenerate exports");
      }

      await loadDocumentVersions(cleanedDocId, "all");
      setVersionHistoryOpen(true);
      setMessage(`Regenerated exports for v${versionNumber}.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to regenerate exports");
    } finally {
      setRegeneratingVersion(null);
    }
  }

  const saveDisabled =
    !canEdit || !isEditMode || savingVersion || !changeSummary.trim() || !editorDraftState;

  let firstMatchAssigned = false;

  return (
    <main className="workspace-page-fill min-h-screen bg-[#f1f3f4] [font-family:var(--font-geist-sans)]">
      <div className="pt-0">
        <LexicalComposer key={`composer-${docId}-${editorSessionKey}`} initialConfig={initialConfig}>
          <EditorEditablePlugin editable={Boolean(canEdit) && isEditMode && !savingVersion} />
          <header className="sticky top-0 z-30 border-b border-slate-300 bg-white shadow-sm">
            <div className="space-y-3 px-4 py-3">
              <div className="flex min-h-[40px] flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 truncate text-base font-medium text-slate-900">
                  {doc?.title || "Loading document..."}
                </p>
                <span className="border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  v{currentVersion}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <button
                  type="button"
                  onClick={() => setStatusInfoOpen((prev) => !prev)}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 transition hover:bg-emerald-100"
                >
                  Status
                </button>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                  Updated {formatDate(doc?.updatedAt || doc?.createdAt || null)}
                </span>
                <button
                  type="button"
                  onClick={() => setVersionHistoryOpen((prev) => !prev)}
                  className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  {versionHistoryOpen ? "Hide versions" : "Version history"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadDocument()}
                  disabled={!canDownloadDoc || downloadingDocId === docId}
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloadingDocId === docId ? "Downloading..." : "Download current"}
                </button>
                <button
                  type="button"
                  onClick={toggleEditMode}
                  disabled={!canEdit}
                  className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isEditMode ? "Stop editing" : "Edit"}
                </button>
                {isEditMode ? (
                  <button
                    type="button"
                    onClick={() => void handleSaveVersion()}
                    disabled={saveDisabled}
                    className="rounded-full border border-sky-700 bg-sky-700 px-2.5 py-1 font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingVersion ? "Saving..." : "Save"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={goBackToDocuments}
                  className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Close document
                </button>
              </div>

              {statusInfoOpen ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
                  <p>
                    File type:{" "}
                    <span className="font-semibold">
                      {doc?.fileType || "application/octet-stream"}
                    </span>
                  </p>
                  <p className="mt-1">
                    Text index: <span className="font-semibold">{doc?.textStatus || "pending"}</span>
                  </p>
                  <p className="mt-1">
                    Current version: <span className="font-semibold">v{currentVersion}</span>
                  </p>
                </div>
              ) : null}

              {versionHistoryOpen ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                      Version History
                    </p>
                    {versionHistoryLoading ? (
                      <p className="text-[11px] text-slate-500">Loading...</p>
                    ) : null}
                  </div>
                  {versionHistoryError ? (
                    <p className="mt-2 text-xs text-rose-700">{versionHistoryError}</p>
                  ) : null}
                  {!versionHistoryLoading && versions.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No version history available yet.</p>
                  ) : null}
                  {versions.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {versions.map((versionRow) => (
                        <div
                          key={`version-${versionRow.version}`}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-slate-800">
                                v{versionRow.version}
                                {versionRow.isCurrent ? " (Current)" : ""}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {formatDateTime(versionRow.promotedAt || versionRow.createdAt)}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDownloadDocument({
                                    version: versionRow.version,
                                    format: "docx",
                                  })
                                }
                                disabled={downloadingDocId === docId}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                DOCX
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDownloadDocument({
                                    version: versionRow.version,
                                    format: "pdf",
                                  })
                                }
                                disabled={downloadingDocId === docId}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                PDF
                              </button>
                              {versionRow.version === 1 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDownloadDocument({
                                      target: "original",
                                    })
                                  }
                                  disabled={downloadingDocId === docId}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Original
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-600">
                            {versionRow.changeSummary || "No summary provided"}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                              DOCX:{" "}
                              {formatExportStatusLabel(
                                normalizeExportStatus(versionRow.renderAssets?.docx?.status),
                              )}
                            </span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                              PDF:{" "}
                              {formatExportStatusLabel(
                                normalizeExportStatus(versionRow.renderAssets?.pdf?.status),
                              )}
                            </span>
                            {(normalizeExportStatus(versionRow.renderAssets?.docx?.status) ===
                              "failed" ||
                              normalizeExportStatus(versionRow.renderAssets?.pdf?.status) ===
                                "failed") ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleRegenerateVersionExports(versionRow.version)
                                }
                                disabled={regeneratingVersion === versionRow.version}
                                className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {regeneratingVersion === versionRow.version
                                  ? "Retrying..."
                                  : "Retry exports"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {isEditMode ? (
              <>
                <div className="border-t border-slate-200 bg-slate-50">
                  <LexicalEditorToolbarPlugin readOnly={!canEdit || savingVersion} />
                </div>

                <div className="border-t border-slate-200 bg-white px-4 py-2">
                  <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
                    <label
                      htmlFor="change-summary"
                      className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Change Summary
                    </label>
                    <p className="text-xs text-slate-500">
                      {lastSaveAt ? `Last saved at ${lastSaveAt}` : "No save yet in this session"}
                    </p>
                  </div>
                  <input
                    id="change-summary"
                    value={changeSummary}
                    onChange={(event) => setChangeSummary(event.target.value)}
                    maxLength={MAX_CHANGE_SUMMARY_LENGTH}
                    placeholder="Summarize what changed in this version..."
                    className="mt-2 h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-500"
                    disabled={!canEdit || savingVersion}
                  />
                  <div className="mt-1 text-right text-xs text-slate-500">
                    {changeSummary.trim().length}/{MAX_CHANGE_SUMMARY_LENGTH}
                  </div>
                </div>
              </>
            ) : null}
          </header>

          {message ? (
            <div className="border-b border-emerald-300/80 bg-emerald-100/80 px-4 py-2 text-sm text-emerald-900">
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="border-b border-rose-300/80 bg-rose-100/80 px-4 py-2 text-sm text-rose-900">
              {error}
            </div>
          ) : null}

          <section className="mx-auto max-w-[1320px] px-4 pb-16 pt-8 sm:px-8">
            {loading || loadingDoc ? (
              <div
                className="mx-auto w-full border border-slate-300 bg-white p-10 shadow-[0_6px_24px_rgba(15,23,42,0.08)]"
                style={{ maxWidth: `${DOCX_PAGE_MAX_WIDTH_PX}px` }}
              >
                <div className="h-7 w-56 animate-pulse bg-slate-100" />
                <div className="mt-6 min-h-[720px] animate-pulse bg-slate-50 sm:min-h-[1056px]" />
              </div>
            ) : (
              <div
                className="mx-auto w-full border border-slate-300 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.08)]"
                style={{ maxWidth: `${DOCX_PAGE_MAX_WIDTH_PX}px` }}
              >
                {!canEdit ? (
                  <div className="border-b border-amber-300 bg-amber-100/80 px-6 py-3 text-sm text-amber-900">
                    This document is not editable yet. Text must be fully processed before edits can
                    be saved.
                  </div>
                ) : null}

                <div className="doc-page-canvas relative min-h-[720px] sm:min-h-[1056px]">
                  {!isEditMode && effectiveHighlightQuery && highlightParagraphs.length > 0 ? (
                    <article
                      className="min-h-[720px] space-y-4 overflow-auto px-[clamp(24px,8vw,96px)] py-[clamp(24px,8vw,96px)] text-slate-700 sm:min-h-[1056px]"
                      style={{
                        fontFamily: DOCX_BODY_FONT_FAMILY,
                        fontSize: `${DOCX_BODY_FONT_SIZE_PT}pt`,
                        lineHeight: DOCX_BODY_LINE_HEIGHT,
                      }}
                    >
                      {highlightParagraphs.map((paragraph, idx) => {
                        const regex = new RegExp(`(${escapeRegExp(effectiveHighlightQuery)})`, "ig");
                        const parts = paragraph.split(regex);
                        return (
                          <p key={`${docId}-${idx}`} className="whitespace-pre-wrap">
                            {parts.map((part, partIdx) => {
                              const isMatch =
                                part.toLowerCase() === effectiveHighlightQuery.toLowerCase();
                              if (!isMatch) return <span key={`${idx}-${partIdx}`}>{part}</span>;
                              const attachFirstRef = !firstMatchAssigned;
                              if (attachFirstRef) firstMatchAssigned = true;
                              return (
                                <mark
                                  key={`${idx}-${partIdx}`}
                                  ref={attachFirstRef ? firstMatchRef : undefined}
                                  className="rounded bg-amber-200 px-0.5 text-slate-900"
                                >
                                  {part}
                                </mark>
                              );
                            })}
                          </p>
                        );
                      })}
                    </article>
                  ) : (
                    <>
                      <RichTextPlugin
                        contentEditable={
                          <ContentEditable
                            className="min-h-[720px] w-full overflow-auto px-[clamp(24px,8vw,96px)] py-[clamp(24px,8vw,96px)] text-slate-800 outline-none sm:min-h-[1056px]"
                            style={{
                              fontFamily: DOCX_BODY_FONT_FAMILY,
                              fontSize: `${DOCX_BODY_FONT_SIZE_PT}pt`,
                              lineHeight: DOCX_BODY_LINE_HEIGHT,
                            }}
                          />
                        }
                        placeholder={
                          <div
                            className="pointer-events-none absolute px-[clamp(24px,8vw,96px)] py-[clamp(24px,8vw,96px)] text-sm text-slate-400"
                            style={{
                              fontFamily: DOCX_BODY_FONT_FAMILY,
                              fontSize: `${DOCX_BODY_FONT_SIZE_PT}pt`,
                              lineHeight: DOCX_BODY_LINE_HEIGHT,
                            }}
                          >
                            Start writing...
                          </div>
                        }
                        ErrorBoundary={LexicalErrorBoundary}
                      />
                      <HistoryPlugin />
                      <ListPlugin hasStrictIndent />
                      <CheckListPlugin />
                      <LinkPlugin />
                      <TablePlugin hasCellMerge hasCellBackgroundColor />
                      <LexicalPasteCleanupPlugin disabled={!canEdit || !isEditMode || savingVersion} />
                      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
                      <OnChangePlugin
                        onChange={(editorState) => {
                          editorState.read(() => {
                            setEditorDraftState(asEditorStateObject(editorState.toJSON()));
                          });
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </LexicalComposer>
      </div>

      <style jsx global>{`
        .workspace-reduced-motion .animate-pulse {
          animation: none !important;
        }
      `}</style>
      <style jsx>{`
        .doc-page-canvas {
          background-color: #ffffff;
        }

        @media (min-width: 640px) {
          .doc-page-canvas {
            background-color: #e8edf3;
            background-image:
              repeating-linear-gradient(
                to bottom,
                transparent 0,
                transparent ${DOCX_PAGE_HEIGHT_PX - DOCX_PAGE_BOTTOM_MARGIN_PX}px,
                rgba(148, 163, 184, 0.2) ${DOCX_PAGE_HEIGHT_PX - DOCX_PAGE_BOTTOM_MARGIN_PX}px,
                rgba(148, 163, 184, 0.08) ${DOCX_PAGE_HEIGHT_PX - DOCX_PAGE_BOTTOM_MARGIN_PX + 1}px,
                rgba(148, 163, 184, 0.08) ${DOCX_PAGE_HEIGHT_PX}px,
                transparent ${DOCX_PAGE_HEIGHT_PX}px,
                transparent ${DOCX_PAGE_HEIGHT_PX + DOCX_PAGE_GAP_PX}px
              ),
              repeating-linear-gradient(
                to bottom,
                #ffffff 0,
                #ffffff ${DOCX_PAGE_HEIGHT_PX}px,
                transparent ${DOCX_PAGE_HEIGHT_PX}px,
                transparent ${DOCX_PAGE_HEIGHT_PX + DOCX_PAGE_GAP_PX}px
              ),
              repeating-linear-gradient(
                to bottom,
                rgba(148, 163, 184, 0.35) 0,
                rgba(148, 163, 184, 0.35) 1px,
                transparent 1px,
                transparent ${DOCX_PAGE_HEIGHT_PX + DOCX_PAGE_GAP_PX}px
              ),
              repeating-linear-gradient(
                to bottom,
                transparent 0,
                transparent ${DOCX_PAGE_HEIGHT_PX - 2}px,
                rgba(15, 23, 42, 0.11) ${DOCX_PAGE_HEIGHT_PX - 1}px,
                rgba(15, 23, 42, 0.05) ${DOCX_PAGE_HEIGHT_PX + 2}px,
                transparent ${DOCX_PAGE_HEIGHT_PX + DOCX_PAGE_GAP_PX}px
              );
            background-size: 100% ${DOCX_PAGE_HEIGHT_PX + DOCX_PAGE_GAP_PX}px;
          }

          .doc-page-canvas :global([contenteditable="true"]) {
            background: transparent;
          }
        }

        :global(.workspace-page-fill select) {
          font-size: ${DEFAULT_FONT_SIZE};
        }
      `}</style>
    </main>
  );
}
