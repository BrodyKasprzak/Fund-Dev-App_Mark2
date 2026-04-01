"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { TRANSFORMERS } from "@lexical/markdown";
import { $getRoot } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { useAuth } from "@/lib/AuthContext";
import { LexicalEditorToolbarPlugin } from "@/components/editor/plugins/LexicalEditorToolbarPlugin";
import { LexicalPasteCleanupPlugin } from "@/components/editor/plugins/LexicalPasteCleanupPlugin";
import { LEXICAL_EDITOR_FORMAT } from "@/lib/documents/versionMetadata";

type DocStatus = "ready" | "processing" | "failed";
type TextStatus = "pending" | "processing" | "ready" | "failed";
type DownloadFormat = "docx" | "pdf" | "original";

type DocumentDetail = {
  id: string;
  title: string;
  fileType: string;
  status: DocStatus;
  textStatus: TextStatus;
  version: number;
  currentVersionNumber?: number;
  extractedText: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

type VersionListItem = {
  version?: number;
  isCurrent?: boolean;
  editorState?: Record<string, unknown> | null;
  plainText?: string | null;
};

type SaveEditorResponse = {
  error?: unknown;
  versionSaved?: unknown;
  versionNumber?: unknown;
};

const MAX_CHANGE_SUMMARY_LENGTH = 500;
const MAX_DOWNLOAD_FILENAME_LENGTH = 220;
const DEFAULT_FONT_SIZE = "14px";

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
};

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

export default function DocumentEditorPage() {
  const router = useRouter();
  const params = useParams<{ docId: string | string[] }>();
  const { user, loading, authedFetch } = useAuth();

  const docId = useMemo(() => {
    const raw = params?.docId;
    if (Array.isArray(raw)) return raw[0] || "";
    return raw || "";
  }, [params]);

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [initialEditorState, setInitialEditorState] = useState<Record<string, unknown> | null>(
    null,
  );
  const [editorDraftState, setEditorDraftState] = useState<Record<string, unknown> | null>(null);
  const [editorSessionKey, setEditorSessionKey] = useState(0);
  const [plainText, setPlainText] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<DownloadFormat | null>(null);
  const [lastSaveAt, setLastSaveAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = doc?.status === "ready" && doc?.textStatus === "ready";
  const currentVersion = doc?.currentVersionNumber ?? doc?.version ?? 1;

  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: `document-editor-page-${docId || "unknown"}`,
      theme: lexicalTheme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode],
      onError: (editorError: Error) => {
        throw editorError;
      },
      editable: Boolean(canEdit) && !savingVersion,
      editorState: parseInitialEditorState(initialEditorState),
    }),
    [canEdit, docId, initialEditorState, savingVersion],
  );

  const loadDocument = useCallback(async () => {
    if (!docId.trim()) return;

    setLoadingDoc(true);
    setError(null);
    setMessage(null);

    try {
      const detailRes = await authedFetch(`/api/documents/${encodeURIComponent(docId)}?limit=50000`);
      const detailData = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) {
        throw new Error(detailData?.error || "Failed to load document");
      }

      const nextDoc = detailData?.document as DocumentDetail | undefined;
      if (!nextDoc?.id) {
        throw new Error("Document not found");
      }

      let currentVersionRow: VersionListItem | null = null;
      try {
        const versionsRes = await authedFetch(`/api/documents/${encodeURIComponent(docId)}/versions`);
        if (versionsRes.ok) {
          const versionsData = await versionsRes.json().catch(() => ({}));
          const rows = Array.isArray(versionsData?.versions)
            ? (versionsData.versions as VersionListItem[])
            : [];
          currentVersionRow = rows.find((row) => row?.isCurrent) || null;
        }
      } catch {
        // Keep editor bootstrap resilient if versions lookup has a transient failure.
      }

      const persistedEditorState = asEditorStateObject(currentVersionRow?.editorState);
      const sourceText =
        (typeof currentVersionRow?.plainText === "string"
          ? currentVersionRow.plainText
          : nextDoc.extractedText || "") || "";
      const normalizedText = sourceText.trim();
      const nextEditorState =
        persistedEditorState || buildLexicalStateFromPlainText(normalizedText);

      const versionFromCurrentRow =
        typeof currentVersionRow?.version === "number" && Number.isFinite(currentVersionRow.version)
          ? Math.max(1, Math.floor(currentVersionRow.version))
          : undefined;

      setDoc({
        ...nextDoc,
        currentVersionNumber:
          versionFromCurrentRow ??
          (typeof nextDoc.currentVersionNumber === "number" ? nextDoc.currentVersionNumber : undefined),
      });
      setInitialEditorState(nextEditorState);
      setEditorDraftState(nextEditorState);
      setPlainText(normalizedText);
      setEditorSessionKey((value) => value + 1);
      setChangeSummary("");
    } catch (err: unknown) {
      setDoc(null);
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load document");
    } finally {
      setLoadingDoc(false);
    }
  }, [authedFetch, docId]);

  useEffect(() => {
    if (loading || user) return;
    const target = `/documents/${encodeURIComponent(docId)}/edit`;
    router.replace(`/login?next=${encodeURIComponent(target)}`);
  }, [docId, loading, router, user]);

  useEffect(() => {
    if (loading || !user || !docId.trim()) return;
    void loadDocument();
  }, [docId, loadDocument, loading, user]);

  function goBackToDocument() {
    const next = new URLSearchParams();
    next.set("mode", "documents");
    next.set("docId", docId);
    router.push(`/documents?${next.toString()}`);
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
            plainText,
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
      setLastSaveAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      setMessage(`Saved as version v${savedVersion ?? currentVersion + 1}.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to save document version");
    } finally {
      setSavingVersion(false);
    }
  }

  async function handleDownload(format: DownloadFormat) {
    if (!docId.trim()) return;

    setDownloadingFormat(format);
    setError(null);
    setMessage(null);

    try {
      const params = new URLSearchParams();
      params.set("target", "current");
      if (format === "docx" || format === "pdf") params.set("format", format);
      if (format === "original") params.set("format", "original");

      const res = await authedFetch(
        `/api/documents/${encodeURIComponent(docId)}/download?${params.toString()}`,
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
      setDownloadingFormat(null);
    }
  }

  const saveDisabled =
    !canEdit || savingVersion || !changeSummary.trim() || !editorDraftState;

  return (
    <main className="workspace-page-fill min-h-screen bg-[#f1f3f4] [font-family:var(--font-geist-sans)]">
      <div className="pt-0">
        <LexicalComposer key={`composer-${docId}-${editorSessionKey}`} initialConfig={initialConfig}>
          <header className="sticky top-0 z-30 border-b border-slate-300 bg-white shadow-sm">
            <div className="flex min-h-[56px] items-center gap-4 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-slate-900">
                  {doc?.title || "Loading document..."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  v{currentVersion}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDownload("docx")}
                  disabled={loadingDoc || downloadingFormat !== null}
                  className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloadingFormat === "docx" ? "DOCX..." : "DOCX"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload("pdf")}
                  disabled={loadingDoc || downloadingFormat !== null}
                  className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloadingFormat === "pdf" ? "PDF..." : "PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload("original")}
                  disabled={loadingDoc || downloadingFormat !== null}
                  className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloadingFormat === "original" ? "Original..." : "Original"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveVersion()}
                  disabled={saveDisabled}
                  className="border border-sky-700 bg-sky-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingVersion ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={goBackToDocument}
                  className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Back
                </button>
              </div>
            </div>

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
              <div className="mx-auto w-full max-w-[850px] border border-slate-300 bg-white p-10 shadow-[0_6px_24px_rgba(15,23,42,0.08)]">
                <div className="h-7 w-56 animate-pulse bg-slate-100" />
                <div className="mt-6 h-[70vh] animate-pulse bg-slate-50" />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[850px] border border-slate-300 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.08)]">
                {!canEdit ? (
                  <div className="border-b border-amber-300 bg-amber-100/80 px-6 py-3 text-sm text-amber-900">
                    This document is not editable yet. Text must be fully processed before edits can
                    be saved.
                  </div>
                ) : null}

                <div className="relative min-h-[78vh]">
                  <RichTextPlugin
                    contentEditable={
                      <ContentEditable className="min-h-[78vh] w-full resize-y overflow-auto px-[72px] py-[56px] text-[15px] leading-7 text-slate-800 outline-none" />
                    }
                    placeholder={
                      <div className="pointer-events-none absolute px-[72px] py-[56px] text-sm text-slate-400">
                        Start writing...
                      </div>
                    }
                    ErrorBoundary={LexicalErrorBoundary}
                  />
                  <HistoryPlugin />
                  <ListPlugin />
                  <CheckListPlugin />
                  <LinkPlugin />
                  <LexicalPasteCleanupPlugin disabled={!canEdit || savingVersion} />
                  <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
                  <OnChangePlugin
                    onChange={(editorState) => {
                      editorState.read(() => {
                        setEditorDraftState(asEditorStateObject(editorState.toJSON()));
                        setPlainText($getRoot().getTextContent());
                      });
                    }}
                  />
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
        :global(.workspace-page-fill select) {
          font-size: ${DEFAULT_FONT_SIZE};
        }
      `}</style>
    </main>
  );
}
