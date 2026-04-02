"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ref, uploadBytesResumable } from "firebase/storage";
import { useAuth } from "@/lib/AuthContext";
import { storage } from "@/lib/firebaseClient";
import type { RagCitation } from "@/lib/rag/types";
import { WorkspaceTopNav } from "@/components/workspace/WorkspaceTopNav";
import { LexicalReadOnlyViewer } from "@/components/editor/LexicalReadOnlyViewer";
import { LEXICAL_EDITOR_FORMAT } from "@/lib/documents/versionMetadata";

type DocStatus = "ready" | "processing" | "failed";
type TextStatus = "pending" | "processing" | "ready" | "failed";
type ChatVisibility = "private";
type WorkspaceMode = "documents" | "chat-private";
type SidebarPanel = "documents" | "history";
type VersionLoadMode = "current" | "all";

type DocumentListItem = {
  id: string;
  title: string;
  storagePath: string;
  fileType: string;
  size: number;
  status: DocStatus;
  editStatus?: string | null;
  textStatus: TextStatus;
  version: number;
  currentVersionNumber?: number;
  createdAt: string | null;
  createdBy: string | null;
  textUpdatedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type DocumentDetail = DocumentListItem & {
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

type ExportFormat = "docx" | "pdf" | "original";

type ChatSummary = {
  id: string;
  title: string;
  visibility: ChatVisibility;
  ownerUid: string | null;
  ownerName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastMessageAt: string | null;
  summary: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  citations: RagCitation[];
  supportLabel: string | null;
  contextSummary: string | null;
};

const FOLDER_FILTERS: Record<string, (doc: DocumentListItem) => boolean> = {
  all: () => true,
  ready: (doc) => doc.textStatus === "ready",
  processing: (doc) => doc.status === "processing" || doc.textStatus !== "ready",
  failed: (doc) => doc.status === "failed" || doc.textStatus === "failed",
  governance: (doc) =>
    /policy|govern|board|audit|compliance/i.test(`${doc.title} ${doc.fileType}`),
  operations: (doc) => /ops|operation|procedure|process|internal/i.test(doc.title),
  fundraising: (doc) => /fund|grant|donor|campaign|appeal/i.test(doc.title),
};

const FILTER_LABELS: Record<string, string> = {
  all: "Most recent",
  ready: "Status: Text Ready",
  processing: "Status: Processing",
  failed: "Status: Needs Attention",
  governance: "Folder: Governance",
  operations: "Folder: Operations",
  fundraising: "Folder: Fundraising",
};

const STATUS_FILTER_OPTIONS = [
  { id: "ready", label: "Text Ready" },
  { id: "processing", label: "Processing" },
  { id: "failed", label: "Needs Attention" },
] as const;

const FOLDER_FILTER_OPTIONS = [
  { id: "governance", label: "Governance" },
  { id: "operations", label: "Operations" },
  { id: "fundraising", label: "Fundraising" },
] as const;

const RAG_SNIPPET_MAX_LENGTH = 200;
const CHAT_MESSAGE_MAX_LENGTH = 4_000;
const DOC_WINDOW_LIMIT = 50_000;
const CHUNK_VIEW_OFFSET_PADDING = 8_000;
const RECENT_DOCS_DEFAULT_LIMIT = 10;
const MAX_DOWNLOAD_FILENAME_LENGTH = 220;
const MAX_RICH_PREVIEW_PLAIN_TEXT_CHARS = 80_000;

function parseWorkspaceMode(raw: string | null): WorkspaceMode {
  if (raw === "chat-private") return "chat-private";
  if (raw === "chat-group" || raw === "chat") return "chat-private";
  return "documents";
}

function asOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asEditorStateObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

function deriveTitle(filename: string) {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const cleaned = noExt.trim().replace(/\s+/g, " ");
  return cleaned || "Untitled Document";
}

function parseFilenameFromContentDisposition(contentDisposition: string | null) {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // Fall through to standard filename parsing.
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

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function citationPreviewText(snippet: string) {
  const normalized = snippet.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "(No snippet)";
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const preview = (lines.slice(0, 2).join(" ") || normalized).trim();
  if (preview.length <= RAG_SNIPPET_MAX_LENGTH) return preview;
  return `${preview.slice(0, RAG_SNIPPET_MAX_LENGTH)}...`;
}

function normalizeRagCitations(value: unknown): RagCitation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const citation = item as {
        docId?: unknown;
        docTitle?: unknown;
        headingPath?: unknown;
        chunkId?: unknown;
        snippet?: unknown;
        moreContext?: unknown;
        deepLink?: unknown;
        similarity?: unknown;
      };
      if (typeof citation.docId !== "string" || typeof citation.docTitle !== "string") {
        return null;
      }

      return {
        docId: citation.docId,
        docTitle: citation.docTitle,
        headingPath: typeof citation.headingPath === "string" ? citation.headingPath : null,
        chunkId: typeof citation.chunkId === "string" ? citation.chunkId : null,
        snippet: typeof citation.snippet === "string" ? citation.snippet : "",
        moreContext: typeof citation.moreContext === "string" ? citation.moreContext : null,
        deepLink: typeof citation.deepLink === "string" ? citation.deepLink : "/documents",
        similarity:
          typeof citation.similarity === "number" && Number.isFinite(citation.similarity)
            ? citation.similarity
            : 0,
      };
    })
    .filter((citation): citation is RagCitation => Boolean(citation));
}
function normalizeChatSummaries(value: unknown): ChatSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const chat = item as {
        id?: unknown;
        title?: unknown;
        visibility?: unknown;
        ownerUid?: unknown;
        ownerName?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
        lastMessageAt?: unknown;
        summary?: unknown;
      };
      if (typeof chat.id !== "string") return null;
      if (chat.visibility !== undefined && chat.visibility !== "private") return null;
      const visibility: ChatVisibility = "private";
      return {
        id: chat.id,
        title: typeof chat.title === "string" ? chat.title : "New chat",
        visibility,
        ownerUid: asOptionalString(chat.ownerUid),
        ownerName: asOptionalString(chat.ownerName),
        createdAt: typeof chat.createdAt === "string" ? chat.createdAt : null,
        updatedAt: typeof chat.updatedAt === "string" ? chat.updatedAt : null,
        lastMessageAt: typeof chat.lastMessageAt === "string" ? chat.lastMessageAt : null,
        summary: typeof chat.summary === "string" ? chat.summary : null,
      } satisfies ChatSummary;
    })
    .filter((chat): chat is ChatSummary => Boolean(chat));
}

function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    createdAt?: unknown;
    createdBy?: unknown;
    createdByName?: unknown;
    citations?: unknown;
    supportLabel?: unknown;
    contextSummary?: unknown;
  };
  if (typeof message.id !== "string") return null;
  const role = message.role === "assistant" ? "assistant" : "user";
  return {
    id: message.id,
    role,
    content: typeof message.content === "string" ? message.content : "",
    createdAt: typeof message.createdAt === "string" ? message.createdAt : null,
    createdBy: asOptionalString(message.createdBy),
    createdByName: asOptionalString(message.createdByName),
    citations: role === "assistant" ? normalizeRagCitations(message.citations) : [],
    supportLabel:
      role === "assistant" && typeof message.supportLabel === "string" ? message.supportLabel : null,
    contextSummary:
      role === "assistant" && typeof message.contextSummary === "string"
        ? message.contextSummary
        : null,
  };
}

function dedupeChatMessages(messages: ChatMessage[]) {
  const seen = new Set<string>();
  const next: ChatMessage[] = [];
  for (const message of messages) {
    if (!message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    next.push(message);
  }
  return next;
}

function supportChipClasses(label: string | null) {
  if (!label) return "bg-slate-100 text-slate-700 border-slate-200";
  if (label.startsWith("Supported by")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (label.startsWith("Low source support") || label === "Partial support") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function documentTextStatusClasses(status: TextStatus) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "processing") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function formatFileTypeLabel(fileType: string) {
  const normalized = (fileType || "").trim().toLowerCase();
  if (!normalized) return "FILE";
  if (normalized.includes("/")) {
    const [, subtype = "file"] = normalized.split("/");
    return subtype.replace(/[+.-]/g, " ").trim().slice(0, 16).toUpperCase();
  }
  return normalized.replace(/[+.-]/g, " ").trim().slice(0, 16).toUpperCase();
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array.from({ length: 6 })].map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  );
}

function ViewerSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-2/5 animate-pulse rounded bg-slate-100" />
      <div className="h-5 w-3/5 animate-pulse rounded bg-slate-100" />
      <div className="h-[1px] bg-slate-200" />
      {[...Array.from({ length: 8 })].map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-slate-100" />
      ))}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="ml-1 inline-flex items-end gap-1 align-middle" aria-hidden="true">
      {[0, 1, 2].map((idx) => (
        <span
          key={idx}
          className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${idx * 0.12}s` }}
        />
      ))}
    </span>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M6 3.5h5l3 3v10H6v-13Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M11 3.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M2.75 5.75A1.75 1.75 0 0 1 4.5 4h3l1.5 1.5h6a1.75 1.75 0 0 1 1.75 1.75v6.5A1.75 1.75 0 0 1 15 15.5H4.5a1.75 1.75 0 0 1-1.75-1.75v-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DocumentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, authedFetch, me } = useAuth();

  const requestedMode = useMemo(
    () => parseWorkspaceMode(searchParams.get("mode")),
    [searchParams],
  );
  const requestedChatId = useMemo(
    () => asOptionalString(searchParams.get("chatId")),
    [searchParams],
  );
  const deepLinkDocId = searchParams.get("docId");
  const deepLinkHighlight = searchParams.get("highlight");

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(requestedMode);
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("documents");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);

  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [loadingMoreText, setLoadingMoreText] = useState(false);
  const [leftFilter, setLeftFilter] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [docFiltersOpen, setDocFiltersOpen] = useState(true);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [detailAnchorQuery, setDetailAnchorQuery] = useState<string | null>(null);
  const [detailOffset, setDetailOffset] = useState<number | null>(null);
  const [viewerHighlightQuery, setViewerHighlightQuery] = useState<string | null>(null);
  const [forceFormattedPreview, setForceFormattedPreview] = useState(false);
  const [statusInfoOpen, setStatusInfoOpen] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);
  const [loadedVersionMode, setLoadedVersionMode] = useState<VersionLoadMode | null>(null);
  const [regeneratingVersion, setRegeneratingVersion] = useState<number | null>(null);

  const [chatList, setChatList] = useState<ChatSummary[]>([]);
  const [chatListLoading, setChatListLoading] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    requestedMode === "chat-private" ? requestedChatId : null,
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstMatchRef = useRef<HTMLElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const handledDeepLinkRef = useRef<string | null>(null);
  const chatAutoScrollRef = useRef(true);
  const chatSendInFlightRef = useRef(false);

  const displayName = useMemo(() => {
    const candidate = typeof me?.name === "string" ? me.name.trim() : "";
    if (candidate) return candidate;
    const email = user?.email?.trim() || "";
    if (email) return email;
    return "You";
  }, [me?.name, user?.email]);

  const activeChats = chatList;
  const chatsLoading = chatListLoading;
  const isChatMode = workspaceMode === "chat-private";

  const effectiveHighlightQuery = (viewerHighlightQuery || "").trim();
  const normalizedLeftFilter = leftFilter.trim();

  const visibleDocs = useMemo(() => {
    const q = normalizedLeftFilter.toLowerCase();
    const folderFilter = FOLDER_FILTERS[activeFolderId] || FOLDER_FILTERS.all;
    return docs.filter((doc) => {
      if (!folderFilter(doc)) return false;
      if (!q) return true;
      return doc.title.toLowerCase().includes(q);
    });
  }, [docs, normalizedLeftFilter, activeFolderId]);
  const showingRecentOnly = activeFolderId === "all" && !normalizedLeftFilter && !showAllDocs;
  const displayedDocs = useMemo(
    () => (showingRecentOnly ? visibleDocs.slice(0, RECENT_DOCS_DEFAULT_LIMIT) : visibleDocs),
    [showingRecentOnly, visibleDocs],
  );
  const activeFilterLabel = FILTER_LABELS[activeFolderId] || FILTER_LABELS.all;

  const selectedMeta = useMemo(
    () => docs.find((d) => d.id === selectedDocId) || null,
    [docs, selectedDocId],
  );
  const selectedDocStatus = selectedDoc?.status || selectedMeta?.status || "processing";
  const selectedDocTextStatus = selectedDoc?.textStatus || selectedMeta?.textStatus || "pending";
  const selectedDocVersion =
    (typeof selectedDoc?.currentVersionNumber === "number"
      ? selectedDoc.currentVersionNumber
      : selectedDoc?.version) ??
    (typeof selectedMeta?.currentVersionNumber === "number"
      ? selectedMeta.currentVersionNumber
      : selectedMeta?.version) ??
    1;
  const canEditSelectedDoc =
    Boolean(selectedDocId) &&
    selectedDocStatus === "ready" &&
    selectedDocTextStatus === "ready";
  const canDownloadSelectedDoc = Boolean(selectedDocId && selectedDocStatus === "ready");
  const currentVersionRow = useMemo(() => {
    if (!versions.length) return null;
    return (
      versions.find((row) => row.isCurrent) ||
      versions.find((row) => row.version === selectedDocVersion) ||
      null
    );
  }, [selectedDocVersion, versions]);
  const currentEditorState = asEditorStateObject(currentVersionRow?.editorState);
  const richPreviewTooLarge =
    typeof currentVersionRow?.plainText === "string" &&
    currentVersionRow.plainText.length > MAX_RICH_PREVIEW_PLAIN_TEXT_CHARS;
  const richPreviewBlockedBySize = richPreviewTooLarge && !forceFormattedPreview;
  const canRenderRichTextView =
    Boolean(currentEditorState) &&
    currentVersionRow?.editorFormat === LEXICAL_EDITOR_FORMAT &&
    !effectiveHighlightQuery &&
    !richPreviewBlockedBySize;
  const extractedText = selectedDoc?.extractedText?.trim() || "";
  const paragraphs = extractedText ? splitParagraphs(extractedText) : [];

  const updateWorkspaceUrl = useCallback(
    (mode: WorkspaceMode, chatId: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("mode", mode);
      if (mode === "documents" || !chatId) next.delete("chatId");
      else next.set("chatId", chatId);
      const nextQuery = next.toString();
      if (nextQuery === searchParams.toString()) return;
      router.replace(nextQuery ? `/documents?${nextQuery}` : "/documents");
    },
    [router, searchParams],
  );

  const switchToDocumentsMode = useCallback(() => {
    setWorkspaceMode("documents");
    setSidebarPanel("documents");
    updateWorkspaceUrl("documents", null);
  }, [updateWorkspaceUrl]);

  const switchToChatMode = useCallback(
    (chatId?: string | null) => {
      const nextChatId = chatId ?? activeChatId ?? null;
      if (nextChatId) {
        router.push(`/chat?chatId=${encodeURIComponent(nextChatId)}`);
        return;
      }
      router.push("/chat");
    },
    [activeChatId, router],
  );

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    setWorkspaceMode(requestedMode);
    setSidebarPanel("documents");
    if (requestedMode === "chat-private" && requestedChatId) {
      setActiveChatId(requestedChatId);
    }
  }, [requestedChatId, requestedMode]);

  useEffect(() => {
    if (requestedMode !== "chat-private") return;
    if (requestedChatId) {
      router.replace(`/chat?chatId=${encodeURIComponent(requestedChatId)}`);
      return;
    }
    router.replace("/chat");
  }, [requestedChatId, requestedMode, router]);

  async function loadDocuments() {
    if (!user) return;
    setDocsLoading(true);
    setError(null);

    try {
      const res = await authedFetch("/api/documents");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load documents");

      const documents = Array.isArray(data?.documents)
        ? (data.documents as DocumentListItem[])
        : [];

      setDocs(documents);
      setSelectedDocId((current) => {
        if (documents.length === 0) return null;
        if (current && documents.some((d) => d.id === current)) return current;
        return null;
      });
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load documents");
    } finally {
      setDocsLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && user) void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const fetchDocumentDetail = useCallback(
    async (args: { docId: string; offset?: number; anchorQuery?: string | null }) => {
      const { docId, offset, anchorQuery } = args;
      const params = new URLSearchParams();
      params.set("limit", String(DOC_WINDOW_LIMIT));
      if (typeof offset === "number" && Number.isFinite(offset) && offset >= 0) {
        params.set("offset", String(Math.floor(offset)));
      }

      const q = anchorQuery?.trim();
      if (q) params.set("q", q);

      const res = await authedFetch(`/api/documents/${docId}?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load document");
      const doc = data?.document as DocumentDetail | undefined;
      if (!doc?.id) throw new Error("Invalid document response");
      return doc;
    },
    [authedFetch],
  );

  const loadDocumentVersions = useCallback(
    async (docId: string, mode: VersionLoadMode = "all") => {
      const cleanedDocId = docId.trim();
      if (!cleanedDocId) {
        setVersions([]);
        setLoadedVersionMode(null);
        return;
      }

      setVersionHistoryLoading(true);
      setVersionHistoryError(null);
      try {
        const params = new URLSearchParams();
        params.set("mode", mode);
        const res = await authedFetch(
          `/api/documents/${encodeURIComponent(cleanedDocId)}/versions?${params.toString()}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load version history");
        const rows = Array.isArray(data?.versions)
          ? (data.versions as DocumentVersionItem[])
          : [];
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
    [authedFetch],
  );

  useEffect(() => {
    if (!selectedDocId || !user) {
      setSelectedDoc(null);
      return;
    }

    let cancelled = false;
    const loadDetail = async () => {
      setDocLoading(true);
      setError(null);
      try {
        const doc = await fetchDocumentDetail({
          docId: selectedDocId,
          offset: detailOffset ?? undefined,
          anchorQuery: detailAnchorQuery,
        });
        if (!cancelled) setSelectedDoc(doc);
      } catch (err: unknown) {
        if (!cancelled) {
          setSelectedDoc(null);
          if (err instanceof Error) setError(err.message);
          else setError("Failed to load document");
        }
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [detailAnchorQuery, detailOffset, fetchDocumentDetail, selectedDocId, user]);

  useEffect(() => {
    if (!selectedDocId || !user) {
      setVersions([]);
      setLoadedVersionMode(null);
      return;
    }
    void loadDocumentVersions(selectedDocId, "current");
  }, [loadDocumentVersions, selectedDocId, user]);

  useEffect(() => {
    if (!versionHistoryOpen || !selectedDocId || !user) return;
    if (loadedVersionMode === "all") return;
    void loadDocumentVersions(selectedDocId, "all");
  }, [loadDocumentVersions, loadedVersionMode, selectedDocId, user, versionHistoryOpen]);

  async function loadMoreExtractedText() {
    if (!selectedDocId || !selectedDoc?.textWindow?.hasMore || loadingMoreText) return;

    setLoadingMoreText(true);
    setError(null);
    try {
      const doc = await fetchDocumentDetail({
        docId: selectedDocId,
        offset: selectedDoc.textWindow.nextOffset ?? 0,
      });
      setSelectedDoc((current) => {
        if (!current || current.id !== doc.id) return doc;
        const existing = current.extractedText || "";
        const incoming = doc.extractedText || "";
        return {
          ...doc,
          extractedText: `${existing}${incoming}` || null,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load more text");
    } finally {
      setLoadingMoreText(false);
    }
  }

  const loadChats = useCallback(async () => {
    if (!user) return;
    setChatListLoading(true);
    setChatError(null);
    try {
      const res = await authedFetch("/api/chats?limit=25&visibility=private");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load chats");
      const nextChats = normalizeChatSummaries(data?.chats).filter(
        (chat) => chat.visibility === "private",
      );
      setChatList(nextChats);
      setActiveChatId((current) => {
        if (current && nextChats.some((chat) => chat.id === current)) return current;
        return nextChats[0]?.id || null;
      });
    } catch (err: unknown) {
      if (err instanceof Error) setChatError(err.message);
      else setChatError("Failed to load chats");
    } finally {
      setChatListLoading(false);
    }
  }, [authedFetch, user]);

  useEffect(() => {
    if (loading || !user) return;
    void loadChats();
  }, [loadChats, loading, user]);

  useEffect(() => {
    if (requestedMode !== "chat-private") return;
    if (!requestedChatId) return;
    if (!chatList.some((chat) => chat.id === requestedChatId)) return;
    setActiveChatId(requestedChatId);
  }, [chatList, requestedChatId, requestedMode]);

  useEffect(() => {
    if (!activeChatId) {
      setChatMessages([]);
      return;
    }
    let cancelled = false;
    const loadChatDetail = async () => {
      setChatLoading(true);
      setChatError(null);
      try {
        const res = await authedFetch(`/api/chats/${activeChatId}?limit=60`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load chat");
        const messages = Array.isArray(data?.messages)
          ? data.messages
              .map((item: unknown) => normalizeChatMessage(item))
              .filter((item: ChatMessage | null): item is ChatMessage => Boolean(item))
          : [];
        if (cancelled) return;
        setChatMessages(dedupeChatMessages(messages));
      } catch (err: unknown) {
        if (!cancelled) {
          setChatMessages([]);
          if (err instanceof Error) setChatError(err.message);
          else setChatError("Failed to load chat");
        }
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    };

    void loadChatDetail();

    return () => {
      cancelled = true;
    };
  }, [activeChatId, authedFetch]);

  const createChat = useCallback(
    async (title?: string) => {
      const res = await authedFetch("/api/chats", {
        method: "POST",
        body: JSON.stringify({ title: title?.trim() || "New chat", visibility: "private" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create chat");
      const next = normalizeChatSummaries([data?.chat])[0];
      if (!next) throw new Error("Invalid chat response");
      return next;
    },
    [authedFetch],
  );

  async function handleNewChat() {
    setChatError(null);
    try {
      const nextChat = await createChat("New chat");
      setChatList((current) => [nextChat, ...current.filter((chat) => chat.id !== nextChat.id)]);
      setActiveChatId(nextChat.id);
      setChatMessages([]);
      switchToChatMode(nextChat.id);
    } catch (err: unknown) {
      if (err instanceof Error) setChatError(err.message);
      else setChatError("Failed to create chat");
    }
  }

  async function ensureActiveChatId(seedTitle: string) {
    if (activeChatId) return activeChatId;
    const nextChat = await createChat(seedTitle);
    setChatList((current) => [nextChat, ...current.filter((chat) => chat.id !== nextChat.id)]);
    setActiveChatId(nextChat.id);
    return nextChat.id;
  }

  async function handleSendChatMessage() {
    const content = chatInput.trim();
    if (!content || chatSending || chatSendInFlightRef.current) return;
    if (content.length > CHAT_MESSAGE_MAX_LENGTH) {
      setChatError(`Message too long (${CHAT_MESSAGE_MAX_LENGTH} char max).`);
      return;
    }

    chatSendInFlightRef.current = true;
    setChatSending(true);
    setChatError(null);

    try {
      const chatId = await ensureActiveChatId(content);
      switchToChatMode(chatId);
      const res = await authedFetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to send message");

      const userMessage = normalizeChatMessage(data?.userMessage);
      const assistantMessage = normalizeChatMessage(data?.assistantMessage);
      const nextMessages = [userMessage, assistantMessage].filter(
        (item): item is ChatMessage => Boolean(item),
      );

      setChatMessages((current) => dedupeChatMessages([...current, ...nextMessages]));
      setChatInput("");
      await loadChats();
    } catch (err: unknown) {
      if (err instanceof Error) setChatError(err.message);
      else setChatError("Failed to send message");
    } finally {
      chatSendInFlightRef.current = false;
      setChatSending(false);
    }
  }

  const resolveHighlightToAnchor = useCallback(
    async (docId: string, chunkId: string) => {
      try {
        const res = await authedFetch(
          `/api/documents/${encodeURIComponent(docId)}/chunk-context?chunkId=${encodeURIComponent(chunkId)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const anchor = typeof data?.anchorQuery === "string" ? data.anchorQuery.trim() : "";
        const highlightText =
          typeof data?.highlightText === "string" ? data.highlightText.trim() : "";
        const chunkStartOffset =
          typeof data?.startOffset === "number" && Number.isFinite(data.startOffset)
            ? Math.max(0, Math.floor(data.startOffset))
            : null;

        setDetailAnchorQuery(anchor || null);
        setViewerHighlightQuery(highlightText || anchor || null);
        setDetailOffset(
          chunkStartOffset !== null
            ? Math.max(0, chunkStartOffset - CHUNK_VIEW_OFFSET_PADDING)
            : null,
        );
      } catch {
        setDetailAnchorQuery(null);
        setViewerHighlightQuery(null);
        setDetailOffset(null);
      }
    },
    [authedFetch],
  );

  useEffect(() => {
    if (!deepLinkDocId) {
      handledDeepLinkRef.current = null;
      return;
    }
    const key = `${deepLinkDocId}:${deepLinkHighlight ?? ""}`;
    if (handledDeepLinkRef.current === key) return;
    handledDeepLinkRef.current = key;
    switchToDocumentsMode();
    setSelectedDocId(deepLinkDocId);
    if (deepLinkHighlight) {
      void resolveHighlightToAnchor(deepLinkDocId, deepLinkHighlight);
      return;
    }
    setDetailOffset(null);
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);
  }, [deepLinkDocId, deepLinkHighlight, resolveHighlightToAnchor, switchToDocumentsMode]);

  useEffect(() => {
    setStatusInfoOpen(false);
    setVersionHistoryOpen(false);
    setVersionHistoryError(null);
    setVersions([]);
    setLoadedVersionMode(null);
    setForceFormattedPreview(false);
  }, [selectedDocId]);

  useEffect(() => {
    if (!docLoading && selectedDocId && effectiveHighlightQuery && firstMatchRef.current) {
      firstMatchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [docLoading, selectedDocId, extractedText, effectiveHighlightQuery]);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior });
  }, []);
  useEffect(() => {
    if (!isChatMode) return;
    chatAutoScrollRef.current = true;
    const id = requestAnimationFrame(() => scrollChatToBottom("auto"));
    return () => cancelAnimationFrame(id);
  }, [activeChatId, isChatMode, scrollChatToBottom]);

  useEffect(() => {
    if (!isChatMode) return;
    if (!chatAutoScrollRef.current) return;
    scrollChatToBottom(chatSending ? "smooth" : "auto");
  }, [chatLoading, chatMessages, chatSending, isChatMode, scrollChatToBottom]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 2000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function handleUpload() {
    if (!user || !uploadFile || !uploadTitle.trim()) return;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    setMessage(null);

    let docId: string | null = null;
    let uploadFinalized = false;
    try {
      const initRes = await authedFetch("/api/documents/init-upload", {
        method: "POST",
        body: JSON.stringify({
          filename: uploadFile.name,
          title: uploadTitle.trim(),
          fileType: uploadFile.type || "application/octet-stream",
          size: uploadFile.size,
        }),
      });
      const initData = await initRes.json().catch(() => ({}));
      if (!initRes.ok) throw new Error(initData?.error || "Failed to initialize upload");

      docId = String(initData.docId || "");
      const storagePath = String(initData.storagePath || "");
      if (!docId || !storagePath) throw new Error("Invalid upload initialization response");

      const storageRef = ref(storage, storagePath);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, uploadFile, {
          contentType: uploadFile.type || undefined,
        });

        task.on(
          "state_changed",
          (snapshot) => {
            const pct = Math.round(
              (snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1)) * 100,
            );
            setUploadProgress(pct);
          },
          (uploadErr) => reject(uploadErr),
          () => resolve(),
        );
      });

      const finalizeRes = await authedFetch(`/api/documents/${docId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "ready",
          title: uploadTitle.trim(),
          fileType: uploadFile.type || "application/octet-stream",
          size: uploadFile.size,
        }),
      });
      const finalizeData = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) throw new Error(finalizeData?.error || "Failed to finalize upload");
      uploadFinalized = true;

      const extractRes = await authedFetch(`/api/documents/${docId}/extract-text`, {
        method: "POST",
      });
      const extractData = await extractRes.json().catch(() => ({}));
      if (!extractRes.ok) {
        throw new Error(
          extractData?.error ||
            "Upload completed, but text extraction failed. Please re-run extraction.",
        );
      }

      await loadDocuments();
      setUploadFile(null);
      setUploadTitle("");
      setUploadProgress(null);
      setMessage("Upload complete. Select the document from the list to open it.");
      switchToDocumentsMode();
    } catch (err: unknown) {
      if (docId && !uploadFinalized) {
        try {
          await authedFetch(`/api/documents/${docId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "failed" }),
          });
        } catch {
          // no-op
        }
      }
      if (uploadFinalized) {
        await loadDocuments();
        setUploadFile(null);
        setUploadTitle("");
        setUploadProgress(null);
        switchToDocumentsMode();
      }
      if (err instanceof Error) setError(err.message);
      else setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadDocument(args?: {
    docId?: string | null;
    version?: number | null;
    target?: "current" | "original";
    format?: ExportFormat | null;
  }) {
    const target = args?.target || "current";
    const format = args?.format || null;
    const version =
      typeof args?.version === "number" && Number.isFinite(args.version) && args.version > 0
        ? Math.floor(args.version)
        : null;
    const docIdInput = args?.docId ?? null;
    const docId = (docIdInput || selectedDocId || "").trim();
    if (!docId) return;

    setError(null);
    setMessage(null);
    setDownloadingDocId(docId);

    try {
      const params = new URLSearchParams();
      params.set("target", target);
      if (version !== null) params.set("version", String(version));
      if (format) params.set("format", format);
      const res = await authedFetch(
        `/api/documents/${encodeURIComponent(docId)}/download?${params.toString()}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to download document");
      }

      const blob = await res.blob();
      const parsedFilename = parseFilenameFromContentDisposition(
        res.headers.get("Content-Disposition"),
      );
      const fallbackTitle = selectedDoc?.title || selectedMeta?.title || "document";
      const filename = sanitizeDownloadFilename(parsedFilename || fallbackTitle);
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

  function beginEditDocument() {
    const docId = (selectedDocId || "").trim();
    if (!docId) {
      setError("Select a document before editing.");
      return;
    }
    if (!canEditSelectedDoc) {
      setError("Document text must be ready before editing.");
      return;
    }
    setError(null);
    setMessage(null);
    router.push(`/documents/${encodeURIComponent(docId)}/edit`);
  }

  async function handleRegenerateVersionExports(versionNumber: number) {
    const docId = (selectedDocId || "").trim();
    if (!docId || !Number.isFinite(versionNumber) || versionNumber < 1) return;

    setRegeneratingVersion(versionNumber);
    setError(null);
    setMessage(null);
    try {
      const res = await authedFetch(
        `/api/documents/${encodeURIComponent(docId)}/versions/${encodeURIComponent(String(versionNumber))}/regenerate`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to regenerate exports");
      }

      await loadDocumentVersions(docId, "all");
      setVersionHistoryOpen(true);
      setMessage(`Regenerated exports for v${versionNumber}.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to regenerate exports");
    } finally {
      setRegeneratingVersion(null);
    }
  }

  function openDocument(docId: string) {
    switchToDocumentsMode();
    setDetailOffset(null);
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);
    setSelectedDocId(docId);
  }

  function closeDocument() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("docId");
    next.delete("highlight");
    next.set("mode", "documents");
    next.delete("chatId");
    const nextQuery = next.toString();
    router.replace(nextQuery ? `/documents?${nextQuery}` : "/documents");
    handledDeepLinkRef.current = null;
    setSelectedDocId(null);
    setSelectedDoc(null);
    setDetailOffset(null);
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);
    setStatusInfoOpen(false);
  }

  function openCitationInDocument(citation: RagCitation) {
    openDocument(citation.docId);
    setDetailOffset(null);
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);

    if (citation.chunkId) {
      void resolveHighlightToAnchor(citation.docId, citation.chunkId);
      return;
    }

    const querySource = `${citation.snippet || ""} ${citation.moreContext || ""}`
      .replace(/\s+/g, " ")
      .trim();
    if (querySource) {
      setDetailAnchorQuery(querySource.slice(0, 120));
      setViewerHighlightQuery(querySource.slice(0, 200));
      return;
    }
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);
  }

  async function copyAssistantMessage(messageId: string, content: string) {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedAssistantMessageId(messageId);
      setTimeout(() => {
        setCopiedAssistantMessageId((current) => (current === messageId ? null : current));
      }, 1200);
    } catch {
      setChatError("Unable to copy message.");
    }
  }

  function messageSenderLabel(chatMessage: ChatMessage) {
    if (chatMessage.role === "assistant") return "Assistant";
    if (chatMessage.createdBy && user && chatMessage.createdBy === user.uid) return "You";
    if (chatMessage.createdByName) return chatMessage.createdByName;
    return displayName;
  }

  function onChatScroll() {
    if (!chatScrollRef.current) return;
    const el = chatScrollRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    chatAutoScrollRef.current = distanceFromBottom < 80;
  }

  if (loading || !user) {
    return (
      <main className="workspace-page-fill min-h-screen bg-white [font-family:var(--font-geist-sans)]">
        <div className="w-full min-h-screen bg-white p-3 sm:p-4">
          <div className="h-12 animate-pulse rounded-2xl border border-slate-200 bg-white/90" />
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-slate-200 bg-white/90 p-4">
              <ListSkeleton />
            </aside>
            <section className="rounded-2xl border border-slate-200 bg-white/90 p-6">
              <ViewerSkeleton />
            </section>
          </div>
        </div>
      </main>
    );
  }

  let firstMatchAssigned = false;

  return (
    <main className="workspace-page-fill min-h-screen bg-white [font-family:var(--font-geist-sans)]">
      <a
        href="#documents-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900"
      >
        Skip to main content
      </a>
      <WorkspaceTopNav active="documents" />
      <div className="w-full min-h-screen bg-white pt-0">
        {error || message ? (
          <div className="space-y-2 px-3 pb-2 sm:px-4">
            {error ? (
              <p
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {message ? (
              <p
                className="rounded-xl border border-emerald-300/70 bg-emerald-100/60 px-3 py-2 text-sm text-emerald-800 shadow-sm"
                role="status"
                aria-live="polite"
              >
                {message}
              </p>
            ) : null}
          </div>
        ) : null}

        <div
          className={`grid min-h-[100dvh] grid-cols-1 gap-0 ${
            leftSidebarCollapsed
              ? "lg:grid-cols-[minmax(0,1fr)_56px]"
              : "lg:grid-cols-[minmax(0,1fr)_320px]"
          }`}
        >
          <aside
            className={`sticky top-0 self-start border-l border-slate-200 bg-white lg:order-2 ${
              leftSidebarCollapsed
                ? "h-[100dvh] p-2"
                : "h-[100dvh] overflow-y-auto p-4"
            }`}
            onClick={leftSidebarCollapsed ? () => setLeftSidebarCollapsed(false) : undefined}
            role={leftSidebarCollapsed ? "button" : undefined}
            tabIndex={leftSidebarCollapsed ? 0 : undefined}
            aria-label={leftSidebarCollapsed ? "Expand right sidebar" : "Right sidebar"}
            onKeyDown={
              leftSidebarCollapsed
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setLeftSidebarCollapsed(false);
                    }
                  }
                : undefined
            }
          >
            {leftSidebarCollapsed ? (
              <div className="flex h-full min-h-0 flex-col justify-start gap-2 rounded-xl border border-slate-200 bg-slate-100 p-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSidebarPanel("documents");
                    setLeftSidebarCollapsed(false);
                  }}
                  className={`inline-flex h-10 items-center justify-center rounded-lg border transition ${
                    sidebarPanel === "documents"
                      ? "border-sky-200 bg-sky-100 text-sky-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  aria-label="Open documents panel"
                >
                  <DocumentIcon />
                </button>
              </div>
            ) : (
              <>
            <div className="mb-2 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setLeftSidebarCollapsed(true)}
                className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                aria-label="Collapse sidebar"
                aria-expanded={!leftSidebarCollapsed}
                title="Collapse sidebar"
              >
                {">"}
              </button>
            </div>
            <div className="flex w-full items-center gap-2 border-b border-slate-200 pb-2">
              <DocumentIcon />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Documents
              </h2>
            </div>

            {sidebarPanel === "documents" ? (
              <div className="mt-4 space-y-3">
                <section className="rounded-xl border border-slate-200 bg-slate-100 p-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Upload New File
                  </h2>
                  <div className="mt-2 space-y-2">
                    <input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setUploadFile(file);
                        setUploadTitle(file ? deriveTitle(file.name) : "");
                      }}
                      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    />
                    <input
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      placeholder="Document title"
                      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      disabled={!uploadFile || !uploadTitle.trim() || uploading}
                      onClick={() => void handleUpload()}
                      className="w-full cursor-pointer rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {uploading ? "Uploading..." : "Upload"}
                    </button>
                    {uploadProgress !== null ? (
                      <p className="text-[11px] text-slate-500">Upload progress: {uploadProgress}%</p>
                    ) : null}
                  </div>
                </section>

                <button
                  type="button"
                  onClick={() => void loadDocuments()}
                  className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Refresh Documents
                </button>

                <section className="rounded-xl border border-slate-200 bg-slate-100 p-3">
                  <button
                    type="button"
                    onClick={() => setDocFiltersOpen((current) => !current)}
                    className="flex w-full items-center justify-between text-left"
                    aria-expanded={docFiltersOpen}
                    aria-controls="documents-filter-panel"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <FolderIcon />
                      <span>Folder Options</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {docFiltersOpen ? "Hide" : "Show"}
                    </span>
                  </button>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Active: <span className="font-medium text-slate-700">{activeFilterLabel}</span>
                  </p>
                  {docFiltersOpen ? (
                    <div id="documents-filter-panel" className="mt-3 space-y-3">
                      <input
                        value={leftFilter}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setLeftFilter(nextValue);
                          if (nextValue.trim()) setShowAllDocs(true);
                          else if (activeFolderId === "all") setShowAllDocs(false);
                        }}
                        placeholder="Search document titles..."
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      />
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Most recent
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveFolderId("all");
                            if (!normalizedLeftFilter) setShowAllDocs(false);
                          }}
                          className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition ${
                            activeFolderId === "all"
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span>Recent uploads</span>
                            <span className="text-[11px] opacity-80">{docs.length}</span>
                          </span>
                        </button>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          By status
                        </p>
                        <div className="mt-1 grid grid-cols-1 gap-1">
                          {STATUS_FILTER_OPTIONS.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setActiveFolderId(option.id);
                                setShowAllDocs(true);
                              }}
                              className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition ${
                                activeFolderId === option.id
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span>{option.label}</span>
                                <span className="text-[11px] opacity-80">
                                  {docs.filter((doc) => FOLDER_FILTERS[option.id](doc)).length}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          By folders
                        </p>
                        <div className="mt-1 grid grid-cols-1 gap-1">
                          {FOLDER_FILTER_OPTIONS.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setActiveFolderId(option.id);
                                setShowAllDocs(true);
                              }}
                              className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition ${
                                activeFolderId === option.id
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span>{option.label}</span>
                                <span className="text-[11px] opacity-80">
                                  {docs.filter((doc) => FOLDER_FILTERS[option.id](doc)).length}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="rounded-xl border border-slate-200 bg-slate-100 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Current View
                  </h3>
                  <p className="mt-2 text-sm font-medium text-slate-800">{activeFilterLabel}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {showingRecentOnly
                      ? `Showing top ${Math.min(RECENT_DOCS_DEFAULT_LIMIT, displayedDocs.length)} most recent uploads`
                      : `Showing ${displayedDocs.length} matching document(s)`}
                  </p>
                  {docsLoading ? (
                    <div className="mt-2 h-8 animate-pulse rounded-lg bg-white" />
                  ) : null}
                </section>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Chat History
                  </h2>
                  <button
                    type="button"
                    onClick={() => void loadChats()}
                    className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Refresh
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleNewChat()}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  New chat
                </button>
                <div className="max-h-[64vh] space-y-2 overflow-y-auto pr-1">
                  {chatsLoading ? (
                    <ListSkeleton />
                  ) : activeChats.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      No chats yet. Start a new chat.
                    </p>
                  ) : (
                    activeChats.map((chat) => {
                      const selected = activeChatId === chat.id;
                      return (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => {
                            setActiveChatId(chat.id);
                            switchToChatMode(chat.id);
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                            selected
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <p className="truncate text-sm font-semibold">{chat.title}</p>
                          <p className={`mt-1 text-[11px] ${selected ? "text-white/80" : "text-slate-500"}`}>
                            Updated {formatDate(chat.updatedAt || chat.lastMessageAt || chat.createdAt)}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
              </>
            )}
          </aside>

          <section
            id="documents-main-content"
            className="min-w-0 bg-white p-5 lg:order-1 lg:min-h-[100dvh] lg:border-r lg:border-slate-200"
          >
            {workspaceMode === "documents" ? (
              !selectedDocId ? (
                docsLoading ? (
                  <ViewerSkeleton />
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/90 p-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Documents
                        </p>
                        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                          Desktop View
                        </h2>
                        <p className="mt-1 text-sm text-slate-600">
                          Open any file to enter the full document viewer and editing workspace.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                          {activeFilterLabel}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                          {showingRecentOnly
                            ? `Top ${Math.min(RECENT_DOCS_DEFAULT_LIMIT, displayedDocs.length)}`
                            : `${displayedDocs.length} shown`}
                        </span>
                        {activeFolderId === "all" &&
                        !normalizedLeftFilter &&
                        visibleDocs.length > RECENT_DOCS_DEFAULT_LIMIT ? (
                          <button
                            type="button"
                            onClick={() => setShowAllDocs((current) => !current)}
                            className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            {showAllDocs ? "Top 10" : "Show all"}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="relative min-h-[66vh] overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-sky-50 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:p-6">
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 opacity-40"
                        style={{
                          backgroundImage:
                            "radial-gradient(circle at 18% 18%, rgba(14,116,144,0.13), transparent 38%), radial-gradient(circle at 82% 72%, rgba(30,64,175,0.1), transparent 36%)",
                        }}
                      />
                      {visibleDocs.length === 0 ? (
                        <div className="relative flex min-h-[58vh] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/80 p-8 text-center">
                          <div className="space-y-2">
                            <p className="text-base font-semibold text-slate-900">No documents match this view</p>
                            <p className="text-sm text-slate-500">
                              Adjust folder options on the right, or upload a new file.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="relative grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
                          {displayedDocs.map((doc, idx) => {
                            const xOffset = ((idx * 3) % 5) - 2;
                            const yOffset = (idx % 4) * 5;
                            const rotation = ((idx % 2 === 0 ? -1 : 1) * ((idx % 3) + 1)) / 2;
                            return (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => openDocument(doc.id)}
                                className="group min-h-[136px] rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-left shadow-[0_10px_25px_rgba(15,23,42,0.07)] transition hover:border-slate-300 hover:shadow-[0_14px_30px_rgba(15,23,42,0.12)] sm:min-h-[150px] sm:p-4"
                                style={{
                                  transform: `translate(${xOffset}px, ${yOffset}px) rotate(${rotation}deg)`,
                                }}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700">
                                    <DocumentIcon />
                                  </span>
                                  <span
                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${documentTextStatusClasses(doc.textStatus)}`}
                                  >
                                    {doc.textStatus}
                                  </span>
                                </div>
                                <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
                                  {doc.title}
                                </p>
                                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                  <span className="truncate">{formatDate(doc.updatedAt || doc.createdAt)}</span>
                                  <span className="truncate font-semibold text-slate-600">
                                    {formatFileTypeLabel(doc.fileType)}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              ) : docLoading || docsLoading ? (
                <ViewerSkeleton />
              ) : (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">
                      {selectedDoc?.title || selectedMeta?.title || "Untitled"}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <button
                        type="button"
                        onClick={() => setStatusInfoOpen((prev) => !prev)}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        Status
                      </button>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                        Updated {formatDate(selectedDoc?.updatedAt || selectedMeta?.updatedAt || null)}
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
                        onClick={() => void handleDownloadDocument({ docId: selectedDocId })}
                        disabled={!canDownloadSelectedDoc || downloadingDocId === selectedDocId}
                        className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {downloadingDocId === selectedDocId ? "Downloading..." : "Download current"}
                      </button>
                      <button
                        type="button"
                        onClick={beginEditDocument}
                        disabled={!canEditSelectedDoc}
                        className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Edit in full page
                      </button>
                      <button
                        type="button"
                        onClick={closeDocument}
                        className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Close document
                      </button>
                    </div>
                    {statusInfoOpen ? (
                      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
                        <p>
                          File type:{" "}
                          <span className="font-semibold">
                            {selectedDoc?.fileType || selectedMeta?.fileType || "application/octet-stream"}
                          </span>
                        </p>
                        <p className="mt-1">
                          Text index:{" "}
                          <span className="font-semibold">
                            {selectedDoc?.textStatus || selectedMeta?.textStatus || "pending"}
                          </span>
                        </p>
                        <p className="mt-1">
                          Current version: <span className="font-semibold">v{selectedDocVersion}</span>
                        </p>
                      </div>
                    ) : null}
                    {versionHistoryOpen ? (
                      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
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
                                          docId: selectedDocId,
                                          version: versionRow.version,
                                          format: "docx",
                                        })
                                      }
                                      disabled={downloadingDocId === selectedDocId}
                                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      DOCX
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleDownloadDocument({
                                          docId: selectedDocId,
                                          version: versionRow.version,
                                          format: "pdf",
                                        })
                                      }
                                      disabled={downloadingDocId === selectedDocId}
                                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      PDF
                                    </button>
                                    {versionRow.version === 1 ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleDownloadDocument({
                                            docId: selectedDocId,
                                            target: "original",
                                          })
                                        }
                                        disabled={downloadingDocId === selectedDocId}
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
                    {selectedDoc?.textWindow && !canRenderRichTextView ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Loaded {selectedDoc.textWindow.returnedChars.toLocaleString()} of{" "}
                        {selectedDoc.textWindow.totalChars.toLocaleString()} characters
                        {selectedDoc.textWindow.anchoredQuery
                          ? ` (anchored to "${selectedDoc.textWindow.anchoredQuery}")`
                          : ""}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-h-[60vh] border border-slate-200 bg-white p-4">
                    {richPreviewBlockedBySize ? (
                      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <p>
                          Rich preview is paused for this large document to keep the page responsive.
                          You can still open formatted preview if you want an exact visual match.
                        </p>
                        <button
                          type="button"
                          onClick={() => setForceFormattedPreview(true)}
                          className="mt-2 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-200"
                        >
                          Show formatted preview
                        </button>
                      </div>
                    ) : null}
                    {canRenderRichTextView && currentEditorState ? (
                      <LexicalReadOnlyViewer
                        namespace={`document-readonly-${selectedDocId || "unknown"}-${selectedDocVersion}`}
                        editorState={currentEditorState}
                      />
                    ) : paragraphs.length === 0 ? (
                      <div className="flex h-full min-h-[48vh] items-center justify-center text-center">
                        <div className="space-y-3">
                          <p className="text-base font-semibold text-slate-800">Text not available yet</p>
                          <p className="text-sm text-slate-500">
                            This file has not been extracted yet, or extraction returned no readable text.
                          </p>
                        </div>
                      </div>
                    ) : effectiveHighlightQuery ? (
                      <article className="space-y-4 text-[15px] leading-7 text-slate-700">
                        {paragraphs.map((paragraph, idx) => {
                          const regex = new RegExp(`(${escapeRegExp(effectiveHighlightQuery)})`, "ig");
                          const parts = paragraph.split(regex);
                          return (
                            <p key={`${selectedDocId}-${idx}`} className="whitespace-pre-wrap">
                              {parts.map((part, partIdx) => {
                                const isMatch = part.toLowerCase() === effectiveHighlightQuery.toLowerCase();
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
                      <article className="space-y-4 text-[15px] leading-7 text-slate-700">
                        {paragraphs.map((paragraph, idx) => (
                          <p key={`${selectedDocId}-${idx}`} className="whitespace-pre-wrap">
                            {paragraph}
                          </p>
                        ))}
                      </article>
                    )}

                    {selectedDoc?.textWindow?.hasMore && !canRenderRichTextView ? (
                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <button
                          type="button"
                          onClick={() => void loadMoreExtractedText()}
                          disabled={loadingMoreText}
                          className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loadingMoreText ? "Loading more..." : "Load more text"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            ) : (
              <div className="flex min-h-[72vh] flex-col">
                <div
                  ref={chatScrollRef}
                  onScroll={onChatScroll}
                  className="flex-1 space-y-4 overflow-y-auto border border-slate-200 bg-slate-50 p-4"
                >
                  {chatLoading ? (
                    <ViewerSkeleton />
                  ) : chatMessages.length === 0 ? (
                    <div className="flex h-full min-h-[40vh] items-center justify-center text-center">
                      <div>
                        <p className="text-base font-semibold text-slate-800">Start a grounded chat</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Ask a question to retrieve org-scoped context from your document library.
                        </p>
                      </div>
                    </div>
                  ) : (
                    chatMessages.map((chatMessage) => {
                      if (chatMessage.role === "assistant") {
                        const supportText =
                          chatMessage.supportLabel ||
                          (chatMessage.citations.length > 0
                            ? `Supported by ${chatMessage.citations.length} sources`
                            : "No supporting sources found");
                        return (
                          <article
                            key={chatMessage.id}
                            className="rounded-md border border-slate-200 bg-white p-3 shadow-sm"
                          >
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
                              <div className="min-w-0">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Assistant
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs text-slate-500">{formatDateTime(chatMessage.createdAt)}</p>
                                    <button
                                      type="button"
                                      onClick={() => void copyAssistantMessage(chatMessage.id, chatMessage.content)}
                                      className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                      {copiedAssistantMessageId === chatMessage.id ? "Copied" : "Copy"}
                                    </button>
                                  </div>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
                                  {chatMessage.content}
                                </p>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${supportChipClasses(chatMessage.supportLabel)}`}
                                  >
                                    {supportText}
                                  </span>
                                  {chatMessage.contextSummary ? (
                                    <span className="text-xs text-slate-500">{chatMessage.contextSummary}</span>
                                  ) : null}
                                </div>
                              </div>
                              <aside className="min-w-0 self-start rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
                                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Sources
                                </p>
                                {chatMessage.citations.length > 0 ? (
                                  <div className="mt-2 space-y-1.5">
                                    {chatMessage.citations.map((citation, index) => {
                                      const citationKey = `${citation.docId}-${citation.chunkId ?? "none"}-${index}`;
                                      return (
                                        <button
                                          key={citationKey}
                                          type="button"
                                          onClick={() => openCitationInDocument(citation)}
                                          className="group w-full rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-left shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)]"
                                        >
                                          <p className="truncate text-sm font-semibold text-slate-900">
                                            {citation.docTitle}
                                          </p>
                                          <p
                                            className="mt-0.5 text-xs leading-5 text-slate-600"
                                            style={{
                                              display: "-webkit-box",
                                              WebkitLineClamp: 2,
                                              WebkitBoxOrient: "vertical",
                                              overflow: "hidden",
                                            }}
                                          >
                                            {citationPreviewText(citation.snippet)}
                                          </p>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="mt-2 text-xs text-slate-500">No sources for this response.</p>
                                )}
                              </aside>
                            </div>
                          </article>
                        );
                      }

                      const isOwnMessage = chatMessage.createdBy ? chatMessage.createdBy === user.uid : true;
                      const senderLabel = messageSenderLabel(chatMessage);

                      return (
                        <div
                          key={chatMessage.id}
                          className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                        >
                          <article
                            className={`w-full max-w-[88%] rounded-md border px-4 py-2.5 ${
                              isOwnMessage
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-900"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p
                                className={`text-[11px] font-semibold uppercase tracking-wide ${
                                  isOwnMessage ? "text-white/80" : "text-slate-500"
                                }`}
                              >
                                {senderLabel}
                              </p>
                              <p className={`text-xs ${isOwnMessage ? "text-white/70" : "text-slate-500"}`}>
                                {formatDateTime(chatMessage.createdAt)}
                              </p>
                            </div>
                            <p
                              className={`mt-1 whitespace-pre-wrap text-sm leading-6 ${
                                isOwnMessage ? "text-white" : "text-slate-800"
                              }`}
                            >
                              {chatMessage.content}
                            </p>
                          </article>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  className="mt-3 space-y-2 border border-slate-200 bg-slate-100 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSendChatMessage();
                  }}
                >
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    rows={3}
                    placeholder="Ask a question about your organization documents..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      {chatInput.trim().length}/{CHAT_MESSAGE_MAX_LENGTH}
                    </p>
                    <button
                      type="submit"
                      disabled={chatSending || !chatInput.trim()}
                      className="inline-flex cursor-pointer items-center rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {chatSending ? (
                        <>
                          Thinking
                          <ThinkingDots />
                        </>
                      ) : (
                        "Send"
                      )}
                    </button>
                  </div>
                  {chatSending ? (
                    <p className="inline-flex items-center text-xs font-medium text-slate-500">
                      Thinking
                      <ThinkingDots />
                    </p>
                  ) : null}
                </form>
                {chatError ? <p className="mt-2 text-sm text-rose-700">{chatError}</p> : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
