"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ref, uploadBytesResumable } from "firebase/storage";
import { useAuth } from "@/lib/AuthContext";
import { storage } from "@/lib/firebaseClient";
import type { RagCitation } from "@/lib/rag/types";

type DocStatus = "ready" | "processing" | "failed";
type TextStatus = "pending" | "processing" | "ready" | "failed";
type ChatVisibility = "private";
type WorkspaceMode = "documents" | "chat-private";
type SidebarPanel = "documents" | "history";

type DocumentListItem = {
  id: string;
  title: string;
  storagePath: string;
  fileType: string;
  size: number;
  status: DocStatus;
  textStatus: TextStatus;
  version: number;
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

type SearchResultItem = DocumentListItem & {
  match?: {
    inTitle?: boolean;
    inText?: boolean;
    snippet?: string | null;
  };
};

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

type FolderNode = {
  id: string;
  name: string;
  note: string;
  children?: FolderNode[];
};

const MOCK_FOLDERS: FolderNode[] = [
  { id: "all", name: "All Documents", note: "Organization-wide" },
  {
    id: "status",
    name: "By Status",
    note: "System generated",
    children: [
      { id: "ready", name: "Text Ready", note: "Extracted text available" },
      { id: "processing", name: "Processing", note: "Upload/index in progress" },
      { id: "failed", name: "Needs Attention", note: "Failed upload or extraction" },
    ],
  },
  {
    id: "folders",
    name: "Folders",
    note: "Structured folders",
    children: [
      { id: "governance", name: "Governance", note: "Policies and compliance" },
      { id: "operations", name: "Operations", note: "Internal process docs" },
      { id: "fundraising", name: "Fundraising", note: "Campaign and grant files" },
    ],
  },
];

const FOLDER_FILTERS: Record<string, (doc: DocumentListItem) => boolean> = {
  all: () => true,
  status: () => true,
  folders: () => true,
  ready: (doc) => doc.textStatus === "ready",
  processing: (doc) => doc.status === "processing" || doc.textStatus !== "ready",
  failed: (doc) => doc.status === "failed" || doc.textStatus === "failed",
  governance: (doc) =>
    /policy|govern|board|audit|compliance/i.test(`${doc.title} ${doc.fileType}`),
  operations: (doc) => /ops|operation|procedure|process|internal/i.test(doc.title),
  fundraising: (doc) => /fund|grant|donor|campaign|appeal/i.test(doc.title),
};

const RAG_SNIPPET_MAX_LENGTH = 200;
const CHAT_MESSAGE_MAX_LENGTH = 4_000;
const DOC_WINDOW_LIMIT = 50_000;
const CHUNK_VIEW_OFFSET_PADDING = 8_000;

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

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function citationSnippet(snippet: string) {
  const trimmed = snippet.trim();
  if (trimmed.length <= RAG_SNIPPET_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, RAG_SNIPPET_MAX_LENGTH)}...`;
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

function supportChipClasses(label: string | null) {
  if (!label) return "bg-slate-100 text-slate-700 border-slate-200";
  if (label.startsWith("Supported by")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (label === "Partial support") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
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

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4 4.5h12v8H9l-3.5 3v-3H4v-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FolderTreeItemProps = {
  node: FolderNode;
  depth: number;
  activeFolderId: string;
  expandedFolders: Record<string, boolean>;
  onToggle: (folderId: string) => void;
  onSelect: (folderId: string) => void;
};

function FolderTreeItem(props: FolderTreeItemProps) {
  const { node, depth, activeFolderId, expandedFolders, onToggle, onSelect } = props;
  const isActive = activeFolderId === node.id;
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const expanded = hasChildren ? Boolean(expandedFolders[node.id]) : false;

  return (
    <li>
      <div className="flex items-stretch gap-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="mt-1 h-6 w-6 rounded-md border border-slate-200 text-xs text-slate-600 transition hover:bg-slate-100"
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {expanded ? "-" : "+"}
          </button>
        ) : (
          <span className="mt-1 block h-6 w-6" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className={`flex-1 cursor-pointer rounded-xl border px-3 py-2 text-left transition ${
            isActive
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-slate-100"
          }`}
          style={{ marginLeft: depth * 8 }}
        >
          <p className="text-sm font-medium">{node.name}</p>
          <p className={`text-xs ${isActive ? "text-white/80" : "text-slate-500"}`}>{node.note}</p>
        </button>
      </div>

      {hasChildren && expanded ? (
        <ul className="mt-2 space-y-2">
          {node.children?.map((child) => (
            <FolderTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              expandedFolders={expandedFolders}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
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
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>(
    requestedMode === "documents" ? "documents" : "history",
  );
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);

  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [loadingMoreText, setLoadingMoreText] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [leftFilter, setLeftFilter] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    status: false,
    folders: false,
  });
  const [detailAnchorQuery, setDetailAnchorQuery] = useState<string | null>(null);
  const [detailOffset, setDetailOffset] = useState<number | null>(null);
  const [viewerHighlightQuery, setViewerHighlightQuery] = useState<string | null>(null);
  const [statusInfoOpen, setStatusInfoOpen] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);

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
  const activeChat = useMemo(
    () => activeChats.find((chat) => chat.id === activeChatId) || null,
    [activeChats, activeChatId],
  );

  const normalizedSearchQuery = searchQuery.trim();
  const effectiveHighlightQuery = (normalizedSearchQuery || viewerHighlightQuery || "").trim();

  const visibleDocs = useMemo(() => {
    const q = leftFilter.trim().toLowerCase();
    const folderFilter = FOLDER_FILTERS[activeFolderId] || FOLDER_FILTERS.all;
    return docs.filter((doc) => {
      if (!folderFilter(doc)) return false;
      if (!q) return true;
      return doc.title.toLowerCase().includes(q);
    });
  }, [docs, leftFilter, activeFolderId]);

  const selectedMeta = useMemo(
    () => docs.find((d) => d.id === selectedDocId) || null,
    [docs, selectedDocId],
  );
  const extractedText = selectedDoc?.extractedText?.trim() || "";
  const paragraphs = extractedText ? splitParagraphs(extractedText) : [];

  const updateWorkspaceUrl = useCallback(
    (mode: WorkspaceMode, chatId: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("mode", mode);
      if (mode === "documents" || !chatId) next.delete("chatId");
      else next.set("chatId", chatId);
      router.replace(`/documents?${next.toString()}`);
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
      setWorkspaceMode("chat-private");
      setSidebarPanel("history");
      updateWorkspaceUrl("chat-private", nextChatId);
    },
    [activeChatId, updateWorkspaceUrl],
  );

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    setWorkspaceMode(requestedMode);
    setSidebarPanel(requestedMode === "documents" ? "documents" : "history");
    if (requestedMode === "chat-private" && requestedChatId) {
      setActiveChatId(requestedChatId);
    }
  }, [requestedChatId, requestedMode]);

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
        return documents[0].id;
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

  async function handleReindexSelectedDoc() {
    if (!selectedDocId || reindexing) return;
    setReindexing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authedFetch(`/api/documents/${selectedDocId}/extract-text`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to re-index document",
        );
      }

      await loadDocuments();
      setMessage("Document text/chunks re-indexed successfully.");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to re-index document");
    } finally {
      setReindexing(false);
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
        setChatMessages(messages);
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

  async function handleResetContext() {
    if (!activeChatId) return;
    setChatError(null);
    try {
      const res = await authedFetch(`/api/chats/${activeChatId}/reset`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to reset context");
      const nextChat = normalizeChatSummaries([data?.chat])[0];
      if (!nextChat) throw new Error("Invalid reset response");
      setChatList((current) => [nextChat, ...current.filter((chat) => chat.id !== nextChat.id)]);
      setActiveChatId(nextChat.id);
      setChatMessages([]);
      switchToChatMode(nextChat.id);
    } catch (err: unknown) {
      if (err instanceof Error) setChatError(err.message);
      else setChatError("Failed to reset context");
    }
  }

  async function handleSendChatMessage() {
    const content = chatInput.trim();
    if (!content || chatSending) return;
    if (content.length > CHAT_MESSAGE_MAX_LENGTH) {
      setChatError(`Message too long (${CHAT_MESSAGE_MAX_LENGTH} char max).`);
      return;
    }

    setChatSending(true);
    setChatError(null);
    switchToChatMode(activeChatId);

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

      setChatMessages((current) => [...current, ...nextMessages]);
      setChatInput("");
      await loadChats();
    } catch (err: unknown) {
      if (err instanceof Error) setChatError(err.message);
      else setChatError("Failed to send message");
    } finally {
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
    if (!user) return;
    if (!normalizedSearchQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const res = await authedFetch(
          `/api/documents/search?q=${encodeURIComponent(normalizedSearchQuery)}&limit=250`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Search failed");
        const results = Array.isArray(data?.documents)
          ? (data.documents as SearchResultItem[])
          : [];
        if (!cancelled) setSearchResults(results);
      } catch (err: unknown) {
        if (!cancelled) {
          setSearchResults([]);
          if (err instanceof Error) setError(err.message);
          else setError("Search failed");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authedFetch, normalizedSearchQuery, user]);

  useEffect(() => {
    setStatusInfoOpen(false);
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

  async function handleUpload() {
    if (!user || !uploadFile || !uploadTitle.trim()) return;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    setMessage(null);

    let docId: string | null = null;
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

      await authedFetch(`/api/documents/${docId}/extract-text`, { method: "POST" });

      await loadDocuments();
      setSelectedDocId(docId);
      setUploadFile(null);
      setUploadTitle("");
      setUploadProgress(null);
      setMessage("Upload complete. Document is now available in workspace search.");
      switchToDocumentsMode();
    } catch (err: unknown) {
      if (docId) {
        try {
          await authedFetch(`/api/documents/${docId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "failed" }),
          });
        } catch {
          // no-op
        }
      }
      if (err instanceof Error) setError(err.message);
      else setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function openDocument(docId: string) {
    switchToDocumentsMode();
    setDetailOffset(null);
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);
    setSelectedDocId(docId);
  }

  function openCitationInDocument(citation: RagCitation) {
    openDocument(citation.docId);
    setSearchQuery("");
    setSearchResults([]);
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
      <div className="fixed left-1/2 top-3 z-40 -translate-x-1/2">
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => switchToDocumentsMode()}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              workspaceMode === "documents"
                ? "bg-sky-600 text-white"
                : "bg-sky-50 text-sky-700 hover:bg-sky-100"
            }`}
          >
            Documents
          </button>
          <button
            type="button"
            onClick={() => switchToChatMode(activeChatId)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              workspaceMode === "chat-private"
                ? "bg-emerald-600 text-white"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            Chat (Private)
          </button>
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
          >
            Create
          </button>
        </div>
      </div>
      <div className="w-full min-h-screen bg-white pt-0">
        {error || message ? (
          <div className="space-y-2 px-3 pb-2 sm:px-4">
            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 shadow-sm">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}

        <div
          className={`grid min-h-[100dvh] grid-cols-1 gap-0 ${
            leftSidebarCollapsed
              ? "lg:grid-cols-[56px_minmax(0,1fr)]"
              : "lg:grid-cols-[320px_minmax(0,1fr)]"
          }`}
        >
          <aside
            className={`sticky top-0 self-start border-r border-slate-200 bg-white ${
              leftSidebarCollapsed
                ? "h-[100dvh] p-2"
                : "h-[100dvh] overflow-y-auto p-4"
            }`}
            onClick={leftSidebarCollapsed ? () => setLeftSidebarCollapsed(false) : undefined}
            role={leftSidebarCollapsed ? "button" : undefined}
            tabIndex={leftSidebarCollapsed ? 0 : undefined}
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
              <div className="flex h-full min-h-0 flex-col justify-end gap-2 rounded-xl border border-slate-200 bg-slate-100 p-2">
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
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSidebarPanel("history");
                    setLeftSidebarCollapsed(false);
                  }}
                  className={`inline-flex h-10 items-center justify-center rounded-lg border transition ${
                    sidebarPanel === "history"
                      ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  aria-label="Open history panel"
                >
                  <ChatIcon />
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
                title="Collapse sidebar"
              >
                {"<"}
              </button>
            </div>
            <div className="flex w-full items-center border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setSidebarPanel("documents")}
                className={`inline-flex flex-1 items-center justify-center gap-2 px-3 py-2 text-xs font-semibold transition ${
                  sidebarPanel === "documents"
                    ? "text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                title="Documents"
                aria-label="Show documents panel"
              >
                <DocumentIcon />
                Documents
              </button>
              <div className="h-5 w-px bg-slate-200" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setSidebarPanel("history")}
                className={`inline-flex flex-1 items-center justify-center gap-2 px-3 py-2 text-xs font-semibold transition ${
                  sidebarPanel === "history"
                    ? "text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                title="Chat history"
                aria-label="Show chat history panel"
              >
                <ChatIcon />
                History
              </button>
            </div>

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

              <section className="rounded-xl border border-slate-200 bg-slate-100 p-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cross-Document Search
                </h2>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search all documents..."
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                {normalizedSearchQuery ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] text-slate-500">
                      {searching
                        ? "Searching..."
                        : `Found ${searchResults.length} result(s) for "${normalizedSearchQuery}"`}
                    </p>
                    <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => {
                            openDocument(result.id);
                            setDetailOffset(null);
                            setDetailAnchorQuery(normalizedSearchQuery);
                            setViewerHighlightQuery(normalizedSearchQuery);
                          }}
                          className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <p className="truncate text-xs font-semibold text-slate-900">{result.title}</p>
                          <p className="mt-1 text-[11px] text-slate-600">
                            {result.match?.snippet || "Match found in this document."}
                          </p>
                        </button>
                      ))}
                      {!searching && searchResults.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                          No matches found.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>

            {sidebarPanel === "documents" ? (
              <div className="mt-4">
                <ul className="space-y-2">
                  {MOCK_FOLDERS.map((folder) => (
                    <FolderTreeItem
                      key={folder.id}
                      node={folder}
                      depth={0}
                      activeFolderId={activeFolderId}
                      expandedFolders={expandedFolders}
                      onToggle={(folderId) =>
                        setExpandedFolders((current) => ({
                          ...current,
                          [folderId]: !current[folderId],
                        }))
                      }
                      onSelect={(folderId) => setActiveFolderId(folderId)}
                    />
                  ))}
                </ul>

                <div className="mt-4 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Documents
                  </h2>
                  <button
                    type="button"
                    onClick={() => void loadDocuments()}
                    className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Refresh
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Showing {visibleDocs.length} of {docs.length} in{" "}
                  <span className="font-medium text-slate-700">{activeFolderId}</span>
                </p>
                <input
                  value={leftFilter}
                  onChange={(e) => setLeftFilter(e.target.value)}
                  placeholder="Filter docs"
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                <div className="mt-3 max-h-[38vh] space-y-2 overflow-y-auto pr-1">
                  {docsLoading ? (
                    <ListSkeleton />
                  ) : visibleDocs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      No documents found.
                    </p>
                  ) : (
                    visibleDocs.map((doc) => {
                      const selected = doc.id === selectedDocId;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => openDocument(doc.id)}
                          className={`w-full cursor-pointer rounded-xl border px-3 py-2 text-left transition ${
                            selected
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <p className="truncate text-sm font-medium">{doc.title}</p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                selected
                                  ? "border-emerald-200/50 bg-emerald-400/20 text-emerald-100"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              }`}
                            >
                              {doc.textStatus}
                            </span>
                            <span className={`text-[11px] ${selected ? "text-white/80" : "text-slate-500"}`}>
                              {formatDate(doc.updatedAt || doc.createdAt)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Private chat
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                    {activeChat?.title || "Select or create a chat"}
                  </p>
                  <select
                    value={activeChatId ?? ""}
                    onChange={(event) => {
                      const nextChatId = event.target.value || null;
                      setActiveChatId(nextChatId);
                      switchToChatMode(nextChatId);
                    }}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  >
                    <option value="" disabled>
                      {chatsLoading ? "Loading chats..." : "Select chat"}
                    </option>
                    {activeChats.map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.title}
                      </option>
                    ))}
                  </select>
                </div>
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleNewChat()}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    New chat
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResetContext()}
                    disabled={!activeChatId}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reset
                  </button>
                </div>
                <div className="max-h-[36vh] space-y-2 overflow-y-auto pr-1">
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

          <section className="min-w-0 bg-white p-5 lg:min-h-[100dvh] lg:border-l lg:border-slate-200">
            {workspaceMode === "documents" ? (
              !selectedDocId ? (
                <div className="flex min-h-[68vh] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <div className="space-y-2">
                    <p className="text-base font-semibold text-slate-900">Select a document to view it</p>
                    <p className="text-sm text-slate-500">
                      Choose a file from the left sidebar. Upload a file if your library is empty.
                    </p>
                  </div>
                </div>
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
                      </div>
                    ) : null}
                    {selectedDoc?.textWindow ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Loaded {selectedDoc.textWindow.returnedChars.toLocaleString()} of{" "}
                        {selectedDoc.textWindow.totalChars.toLocaleString()} characters
                        {selectedDoc.textWindow.anchoredQuery
                          ? ` (anchored to "${selectedDoc.textWindow.anchoredQuery}")`
                          : ""}
                      </p>
                    ) : null}
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => void handleReindexSelectedDoc()}
                        disabled={reindexing}
                        className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {reindexing ? "Re-indexing..." : "Re-index Extraction + Chunks"}
                      </button>
                    </div>
                  </div>

                  <div className="min-h-[60vh] border border-slate-200 bg-white p-4">
                    {paragraphs.length === 0 ? (
                      <div className="flex h-full min-h-[48vh] items-center justify-center text-center">
                        <div className="space-y-3">
                          <p className="text-base font-semibold text-slate-800">Text not available yet</p>
                          <p className="text-sm text-slate-500">
                            This file has not been extracted yet, or extraction returned no readable text.
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleReindexSelectedDoc()}
                            disabled={reindexing}
                            className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            {reindexing ? "Re-indexing..." : "Re-run extraction"}
                          </button>
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

                    {selectedDoc?.textWindow?.hasMore ? (
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
                              <aside className="min-w-0 self-start rounded-md border border-slate-200 bg-slate-100 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Sources
                                </p>
                                {chatMessage.citations.length > 0 ? (
                                  <div className="mt-2 space-y-2">
                                    {chatMessage.citations.map((citation, index) => {
                                      const citationKey = `${citation.docId}-${citation.chunkId ?? "none"}-${index}`;
                                      return (
                                        <article
                                          key={citationKey}
                                          className="rounded-md border border-slate-200 bg-white p-3"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="truncate text-sm font-semibold text-slate-900">
                                              {citation.docTitle}
                                            </p>
                                            <span className="text-[11px] text-slate-500">
                                              {citation.similarity.toFixed(4)}
                                            </span>
                                          </div>
                                          <p className="mt-0.5 text-xs text-slate-500">
                                            {citation.headingPath || "Heading path unavailable"}
                                          </p>
                                          <p className="mt-1 text-xs text-slate-700">
                                            {citationSnippet(citation.snippet) || "(No snippet)"}
                                          </p>
                                          <button
                                            type="button"
                                            onClick={() => openCitationInDocument(citation)}
                                            className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                          >
                                            Open in document
                                          </button>
                                        </article>
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
