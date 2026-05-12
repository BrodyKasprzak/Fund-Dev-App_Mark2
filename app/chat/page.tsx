"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type DocAccessMode = "org" | "restricted";

type OrgMemberOption = {
  uid: string;
  label: string;
  status: string;
};

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

const RAG_SNIPPET_MAX_LENGTH = 200;
const CHAT_MESSAGE_MAX_LENGTH = 4_000;
const DOC_WINDOW_LIMIT = 50_000;
const CHUNK_VIEW_OFFSET_PADDING = 8_000;
const RECENT_DOCS_DEFAULT_LIMIT = 10;
const MAX_DOWNLOAD_FILENAME_LENGTH = 220;

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

function parseSelectMultipleValues(event: ChangeEvent<HTMLSelectElement>) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
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
  if (!Array.isArray(value)) return[];

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
  if (!Array.isArray(value)) return[];
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
    citations: role === "assistant" ? normalizeRagCitations(message.citations) :[],
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
  const next: ChatMessage[] =[];
  for (const message of messages) {
    if (!message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    next.push(message);
  }
  return next;
}

function ListSkeleton() {
  return (
    <div className="space-y-1">
      {[...Array.from({ length: 6 })].map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-200/60" />
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

export default function DocumentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, authedFetch, me } = useAuth();

  const requestedMode = useMemo<WorkspaceMode>(() => "chat-private",[]);
  const requestedChatId = useMemo(
    () => asOptionalString(searchParams.get("chatId")),
    [searchParams],
  );
  const deepLinkDocId = searchParams.get("docId");
  const deepLinkHighlight = searchParams.get("highlight");

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(requestedMode);
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("history");

  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const[selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const[selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [loadingMoreText, setLoadingMoreText] = useState(false);
  const [leftFilter, setLeftFilter] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [docFiltersOpen, setDocFiltersOpen] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const[detailAnchorQuery, setDetailAnchorQuery] = useState<string | null>(null);
  const [detailOffset, setDetailOffset] = useState<number | null>(null);
  const [viewerHighlightQuery, setViewerHighlightQuery] = useState<string | null>(null);
  const [statusInfoOpen, setStatusInfoOpen] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadAccessMode, setUploadAccessMode] = useState<DocAccessMode>("org");
  const [uploadAllowedMemberUids, setUploadAllowedMemberUids] = useState<string[]>([]);
  const [uploadRagEnabled, setUploadRagEnabled] = useState(true);
  const [orgMembers, setOrgMembers] = useState<OrgMemberOption[]>([]);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);

  const [chatList, setChatList] = useState<ChatSummary[]>([]);
  const[chatListLoading, setChatListLoading] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    requestedMode === "chat-private" ? requestedChatId : null,
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const[chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [assistantTyping, setAssistantTyping] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
  const [sourcesModalMessageId, setSourcesModalMessageId] = useState<string | null>(null);

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
  },[me?.name, user?.email]);

  const activeChats = chatList;
  const chatsLoading = chatListLoading;
  const isChatMode = workspaceMode === "chat-private";
  const activeSourcesMessage = useMemo(
    () =>
      chatMessages.find(
        (chatMessage) =>
          chatMessage.id === sourcesModalMessageId && chatMessage.role === "assistant",
      ) || null,[chatMessages, sourcesModalMessageId],
  );

  const effectiveHighlightQuery = (viewerHighlightQuery || "").trim();
  const normalizedLeftFilter = leftFilter.trim();
  const activeOrgMembers = useMemo(
    () => orgMembers.filter((member) => member.status === "active"),
    [orgMembers],
  );
  const activeOrgMemberUidSet = useMemo(
    () => new Set(activeOrgMembers.map((member) => member.uid)),
    [activeOrgMembers],
  );

  const visibleDocs = useMemo(() => {
    const q = normalizedLeftFilter.toLowerCase();
    const folderFilter = FOLDER_FILTERS[activeFolderId] || FOLDER_FILTERS.all;
    return docs.filter((doc) => {
      if (!folderFilter(doc)) return false;
      if (!q) return true;
      return doc.title.toLowerCase().includes(q);
    });
  },[docs, normalizedLeftFilter, activeFolderId]);
  const showingRecentOnly = activeFolderId === "all" && !normalizedLeftFilter && !showAllDocs;
  const displayedDocs = useMemo(
    () => (showingRecentOnly ? visibleDocs.slice(0, RECENT_DOCS_DEFAULT_LIMIT) : visibleDocs),[showingRecentOnly, visibleDocs],
  );
  const activeFilterLabel = FILTER_LABELS[activeFolderId] || FILTER_LABELS.all;

  const selectedMeta = useMemo(
    () => docs.find((d) => d.id === selectedDocId) || null,
    [docs, selectedDocId],
  );
  const selectedDocStatus = selectedDoc?.status || selectedMeta?.status || "processing";
  const canDownloadSelectedDoc = Boolean(selectedDocId && selectedDocStatus === "ready");
  const extractedText = selectedDoc?.extractedText?.trim() || "";
  const paragraphs = extractedText ? splitParagraphs(extractedText) :[];

  const switchToDocumentsMode = useCallback(() => {
    router.push("/documents");
  }, [router]);

  const switchToChatMode = useCallback(
    (chatId?: string | null) => {
      const nextChatId = chatId ?? activeChatId ?? null;
      setWorkspaceMode("chat-private");
      setSidebarPanel("history");
      if (nextChatId) {
        router.replace(`/chat?chatId=${encodeURIComponent(nextChatId)}`);
        return;
      }
      router.replace("/chat");
    },
    [activeChatId, router],
  );

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  },[loading, user, router]);

  useEffect(() => {
    setWorkspaceMode(requestedMode);
    setSidebarPanel("history");
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
        :[];

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

  async function loadOrgMembers() {
    if (!user) return;
    setOrgMembersLoading(true);
    try {
      const res = await authedFetch("/api/org/members?limit=500");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load org members");

      const rows = Array.isArray(data?.members) ? (data.members as Array<Record<string, unknown>>) : [];
      const members = rows
        .map((row) => {
          const uid = typeof row.uid === "string" ? row.uid.trim() : "";
          if (!uid) return null;
          const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "active";
          const name = typeof row.name === "string" ? row.name.trim() : "";
          const email = typeof row.email === "string" ? row.email.trim() : "";
          const label = name && email ? `${name} (${email})` : name || email || uid;
          return {
            uid,
            label,
            status,
          } satisfies OrgMemberOption;
        })
        .filter((member): member is OrgMemberOption => Boolean(member))
        .sort((a, b) => a.label.localeCompare(b.label));
      setOrgMembers(members);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load org members");
    } finally {
      setOrgMembersLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && user) void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loading, user]);

  useEffect(() => {
    if (!loading && user) void loadOrgMembers();
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
  },[detailAnchorQuery, detailOffset, fetchDocumentDetail, selectedDocId, user]);

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
  },[authedFetch, user]);

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
          :[];
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
  },[activeChatId, authedFetch]);

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
      setChatList((current) =>[nextChat, ...current.filter((chat) => chat.id !== nextChat.id)]);
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
    setChatList((current) =>[nextChat, ...current.filter((chat) => chat.id !== nextChat.id)]);
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
    setAssistantTyping(true);
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
      const nextMessages =[userMessage, assistantMessage].filter(
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
      setAssistantTyping(false);
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
  }, [selectedDocId]);

  useEffect(() => {
    if (!docLoading && selectedDocId && effectiveHighlightQuery && firstMatchRef.current) {
      firstMatchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  },[docLoading, selectedDocId, extractedText, effectiveHighlightQuery]);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior });
  },[]);
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
  },[chatLoading, chatMessages, chatSending, isChatMode, scrollChatToBottom]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 2000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    setUploadAllowedMemberUids((current) =>
      current.filter((uid) => activeOrgMemberUidSet.has(uid)),
    );
  }, [activeOrgMemberUidSet]);

  useEffect(() => {
    if (uploadAccessMode !== "restricted" && uploadAllowedMemberUids.length > 0) {
      setUploadAllowedMemberUids([]);
    }
  }, [uploadAccessMode, uploadAllowedMemberUids.length]);

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
          docPermissions: {
            accessMode: uploadAccessMode,
            allowedMemberUids:
              uploadAccessMode === "restricted" ? uploadAllowedMemberUids : [],
            ragEnabled: uploadRagEnabled,
          },
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
    const next = new URLSearchParams();
    next.set("docId", citation.docId);
    if (citation.chunkId) next.set("highlight", citation.chunkId);
    router.push(`/documents?${next.toString()}`);
  }

  async function handleDownloadDocument(docIdInput?: string | null) {
    const docId = (docIdInput || selectedDocId || "").trim();
    if (!docId) return;

    setError(null);
    setMessage(null);
    setDownloadingDocId(docId);

    try {
      const res = await authedFetch(`/api/documents/${encodeURIComponent(docId)}/download`);
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

  useEffect(() => {
    if (!sourcesModalMessageId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSourcesModalMessageId(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sourcesModalMessageId]);

  if (loading || !user) {
    return (
      <main className="workspace-page-fill workspace-page-no-top-gap min-h-screen bg-white [font-family:var(--font-geist-sans)]">
        <div className="w-full min-h-screen bg-white p-3 sm:p-4">
          <div className="h-12 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 grid grid-cols-1 gap-0 lg:grid-cols-[224px_minmax(0,1fr)]">
            <aside className="p-4">
              <ListSkeleton />
            </aside>
            <section className="p-6">
              <ViewerSkeleton />
            </section>
          </div>
        </div>
      </main>
    );
  }

  let firstMatchAssigned = false;

  return (
    <main className="workspace-page-fill workspace-page-no-top-gap workspace-page-no-bottom-gap h-[calc(100dvh-56px)] overflow-hidden bg-white [font-family:var(--font-geist-sans)]">
      <a
        href="#chat-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900"
      >
        Skip to main content
      </a>
      <div className="h-full w-full bg-white pt-0">
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

        <div className="grid h-full grid-cols-1 gap-0 lg:grid-cols-[224px_minmax(0,1fr)]">
          <aside
            className="sticky top-0 self-start h-full overflow-y-auto border-r border-slate-100 bg-slate-50 p-4 lg:order-1"
            aria-label="Left sidebar"
          >
            <div className="flex w-full items-center justify-between gap-2 pb-2 pl-1">
              <div className="flex items-center gap-2">
                <ChatIcon />
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Workspace
                </h2>
              </div>
              {sidebarPanel === "history" ? (
                <button
                  type="button"
                  onClick={() => void loadChats()}
                  className="rounded px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-200"
                >
                  Refresh
                </button>
              ) : null}
            </div>

            {sidebarPanel === "documents" ? (
              <div className="mt-4 space-y-4">
                <section className="p-1">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Upload New File
                  </h2>
                  <div className="space-y-2">
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
                    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Doc permissions
                      </p>
                      <label className="mt-2 block text-[11px] font-medium text-slate-700">
                        Who can open
                      </label>
                      <select
                        value={uploadAccessMode}
                        onChange={(event) =>
                          setUploadAccessMode(
                            event.target.value === "restricted" ? "restricted" : "org",
                          )
                        }
                        className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                      >
                        <option value="org">Everyone in org (default)</option>
                        <option value="restricted">Specific members</option>
                      </select>
                      {uploadAccessMode === "restricted" ? (
                        <div className="mt-2">
                          <select
                            multiple
                            value={uploadAllowedMemberUids}
                            onChange={(event) =>
                              setUploadAllowedMemberUids(parseSelectMultipleValues(event))
                            }
                            className="min-h-[90px] w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                          >
                            {activeOrgMembers.map((member) => (
                              <option key={member.uid} value={member.uid}>
                                {member.label}
                              </option>
                            ))}
                          </select>
                          {orgMembersLoading ? (
                            <p className="mt-1 text-[11px] text-slate-500">Loading members...</p>
                          ) : null}
                        </div>
                      ) : null}
                      <label className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={uploadRagEnabled}
                          onChange={(event) => setUploadRagEnabled(event.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                        Allow this doc in AI/RAG answers
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={!uploadFile || !uploadTitle.trim() || uploading}
                      className="w-full cursor-pointer rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void handleUpload()}
                    >
                      {uploading ? "Uploading..." : "Upload"}
                    </button>
                    {uploadProgress !== null ? (
                      <p className="text-[11px] text-slate-500">Upload progress: {uploadProgress}%</p>
                    ) : null}
                  </div>
                </section>

                <div className="px-1">
                  <button
                    type="button"
                    onClick={() => void loadDocuments()}
                    className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Refresh Documents
                  </button>
                </div>

                <section className="px-1">
                  <button
                    type="button"
                    onClick={() => setDocFiltersOpen((current) => !current)}
                    className="flex w-full items-center justify-between text-left transition hover:bg-slate-200/50 rounded-md p-1 -mx-1"
                    aria-expanded={docFiltersOpen}
                    aria-controls="chat-filter-panel"
                  >
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Filter Docs
                    </h2>
                    <span className="text-[11px] font-semibold text-slate-600">
                      {docFiltersOpen ? "Hide" : "Show"}
                    </span>
                  </button>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Active: <span className="font-medium text-slate-700">{activeFilterLabel}</span>
                  </p>
                  {docFiltersOpen ? (
                    <div id="chat-filter-panel" className="mt-3 space-y-3">
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
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Most recent
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveFolderId("all");
                            if (!normalizedLeftFilter) setShowAllDocs(false);
                          }}
                          className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                            activeFolderId === "all"
                              ? "bg-slate-200 text-slate-900"
                              : "bg-transparent text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          Recent uploads
                        </button>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          By status
                        </p>
                        <div className="grid grid-cols-1 gap-0.5">
                          {[
                            { id: "ready", label: "Text Ready" },
                            { id: "processing", label: "Processing" },
                            { id: "failed", label: "Needs Attention" },
                          ].map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setActiveFolderId(option.id);
                                setShowAllDocs(true);
                              }}
                              className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                                activeFolderId === option.id
                                  ? "bg-slate-200 text-slate-900"
                                  : "bg-transparent text-slate-700 hover:bg-slate-200"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          By folders
                        </p>
                        <div className="grid grid-cols-1 gap-0.5">
                          {[
                            { id: "governance", label: "Governance" },
                            { id: "operations", label: "Operations" },
                            { id: "fundraising", label: "Fundraising" },
                          ].map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setActiveFolderId(option.id);
                                setShowAllDocs(true);
                              }}
                              className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                                activeFolderId === option.id
                                  ? "bg-slate-200 text-slate-900"
                                  : "bg-transparent text-slate-700 hover:bg-slate-200"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                <div>
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Documents
                    </h2>
                    {activeFolderId === "all" &&
                    !normalizedLeftFilter &&
                    visibleDocs.length > RECENT_DOCS_DEFAULT_LIMIT ? (
                      <button
                        type="button"
                        onClick={() => setShowAllDocs((current) => !current)}
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-200"
                      >
                        {showAllDocs ? "Top 10" : "Show all"}
                      </button>
                    ) : null}
                  </div>
                  <p className="mb-2 px-1 text-[11px] text-slate-500">
                    {showingRecentOnly
                      ? `Showing top ${Math.min(RECENT_DOCS_DEFAULT_LIMIT, displayedDocs.length)} most recent uploads`
                      : `Showing ${displayedDocs.length} matching document(s)`}
                  </p>
                  <div className="space-y-0.5">
                    {docsLoading ? (
                      <div className="px-1"><ListSkeleton /></div>
                    ) : visibleDocs.length === 0 ? (
                      <p className="mx-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        No documents found.
                      </p>
                    ) : (
                      displayedDocs.map((doc) => {
                        const selected = doc.id === selectedDocId;
                        return (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => openDocument(doc.id)}
                            className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left transition-colors ${
                              selected
                                ? "bg-slate-200 text-slate-900"
                                : "bg-transparent text-slate-700 hover:bg-slate-200"
                            }`}
                          >
                            <p className={`truncate text-sm ${selected ? "font-semibold" : "font-medium"}`}>{doc.title}</p>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <span
                                className={`text-[10px] ${selected ? "text-slate-700" : "text-slate-500"}`}
                              >
                                {doc.textStatus}
                              </span>
                              <span
                                className={`text-[10px] ${selected ? "text-slate-700" : "text-slate-500"}`}
                              >
                                {formatDate(doc.updatedAt || doc.createdAt)}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="px-1">
                  <button
                    type="button"
                    onClick={() => void handleNewChat()}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    New chat
                  </button>
                </div>
                <div className="space-y-0.5">
                  {chatsLoading ? (
                    <div className="px-1"><ListSkeleton /></div>
                  ) : activeChats.length === 0 ? (
                    <p className="mx-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
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
                          className={`w-full rounded-lg px-3 py-2 text-left transition-colors duration-150 ${
                            selected
                              ? "bg-slate-200 text-slate-900"
                              : "bg-transparent text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          <p className={`truncate text-[13px] ${selected ? "font-semibold" : "font-medium"}`}>{chat.title}</p>
                          <p className={`mt-0.5 text-[10px] ${selected ? "text-slate-700" : "text-slate-500"}`}>
                            Updated {formatDate(chat.updatedAt || chat.lastMessageAt || chat.createdAt)}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </aside>

          <section
            id="chat-main-content"
            className="flex min-w-0 flex-col bg-white lg:order-2 lg:h-full"
          >
            {workspaceMode === "documents" ? (
              <div className="h-full overflow-y-auto p-5 md:p-8">
              {!selectedDocId ? (
                <div className="flex min-h-[68vh] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <div className="space-y-2">
                    <p className="text-base font-semibold text-slate-900">Select a document to view it</p>
                    <p className="text-sm text-slate-500">
                      Choose a file from the right sidebar. Upload a file if your library is empty.
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
                      <button
                        type="button"
                        onClick={closeDocument}
                        className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Close document
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadDocument(selectedDocId)}
                        disabled={!canDownloadSelectedDoc || downloadingDocId === selectedDocId}
                        className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {downloadingDocId === selectedDocId ? "Downloading..." : "Download current"}
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
                  </div>

                  <div className="min-h-[60vh] border border-slate-200 bg-white p-4">
                    {paragraphs.length === 0 ? (
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
              )}
              </div>
            ) : (
              <div className="flex h-full flex-col bg-white">
                <div
                  ref={chatScrollRef}
                  onScroll={onChatScroll}
                  className="flex-1 space-y-6 overflow-y-auto px-4 pb-6 pt-8 md:px-12 lg:px-32 xl:px-48"
                >
                  {chatLoading ? (
                    <ViewerSkeleton />
                  ) : chatMessages.length === 0 ? (
                    <div className="flex h-full min-h-[40vh] items-center justify-center text-center">
                      <div>
                        <p className="text-lg font-semibold text-slate-800">Start a grounded chat</p>
                        <p className="mt-2 text-sm text-slate-500">
                          Ask a question to retrieve org-scoped context from your document library.
                        </p>
                      </div>
                    </div>
                  ) : (
                    chatMessages.map((chatMessage) => {
                      if (chatMessage.role === "assistant") {
                        return (
                          <article
                            key={chatMessage.id}
                            className="flex w-full flex-col items-start pb-4"
                          >
                            <div className="flex w-full max-w-[85%] flex-col">
                              <div className="mb-1 flex items-center gap-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Assistant
                                </p>
                                <p className="text-xs text-slate-400">{formatDateTime(chatMessage.createdAt)}</p>
                                <button
                                  type="button"
                                  onClick={() => void copyAssistantMessage(chatMessage.id, chatMessage.content)}
                                  className="rounded text-[10px] font-semibold text-slate-400 hover:text-slate-600"
                                >
                                  {copiedAssistantMessageId === chatMessage.id ? "Copied" : "Copy"}
                                </button>
                              </div>
                              <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
                                {chatMessage.content}
                              </div>
                              <div className="mt-3 space-y-1">
                                <button
                                  type="button"
                                  onClick={() => setSourcesModalMessageId(chatMessage.id)}
                                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                                >
                                  Response based on {chatMessage.citations.length} source
                                  {chatMessage.citations.length === 1 ? "" : "s"}
                                </button>
                                {chatMessage.contextSummary ? (
                                  <p className="text-xs text-slate-500">{chatMessage.contextSummary}</p>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      }

                      const senderLabel = messageSenderLabel(chatMessage);

                      return (
                        <article key={chatMessage.id} className="flex w-full flex-col items-end pb-4">
                            <div className="flex w-full max-w-[85%] flex-col items-end">
                              <div className="mb-1 flex items-center justify-end gap-2">
                                <p className="text-xs text-slate-400">
                                  {formatDateTime(chatMessage.createdAt)}
                                </p>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  {senderLabel}
                                </p>
                              </div>
                              <div className="rounded-2xl rounded-tr-sm bg-slate-100 px-5 py-3 text-[15px] leading-7 text-slate-900 whitespace-pre-wrap">
                                {chatMessage.content}
                              </div>
                            </div>
                        </article>
                      );
                    })
                  )}
                  {assistantTyping && !chatLoading ? (
                    <article className="flex w-full flex-col items-start pb-4">
                      <div className="inline-flex max-w-[85%] items-center text-sm text-slate-500">
                        Assistant is typing
                        <ThinkingDots />
                      </div>
                    </article>
                  ) : null}
                </div>

                <div className="shrink-0 bg-white px-4 pb-4 pt-2 md:px-12 lg:px-32 xl:px-48">
                  <div className="mx-auto w-full max-w-4xl">
                    <form
                      className="relative flex flex-col rounded-2xl border border-slate-200 bg-slate-50 shadow-sm focus-within:border-slate-300 focus-within:ring-1 focus-within:ring-slate-300"
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
                        className="w-full resize-none border-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                        style={{ outline: "none", boxShadow: "none" }}
                      />
                      <div className="flex items-center justify-between px-4 pb-3 pt-1">
                        <p className="text-xs text-slate-400">
                          {chatInput.trim().length}/{CHAT_MESSAGE_MAX_LENGTH}
                        </p>
                        <button
                          type="submit"
                          disabled={chatSending || !chatInput.trim()}
                          className="inline-flex cursor-pointer items-center rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
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
                    </form>
                    {chatError ? <p className="mt-2 text-sm text-rose-700">{chatError}</p> : null}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {sourcesModalMessageId && activeSourcesMessage ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <button
              type="button"
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              aria-label="Close sources"
              onClick={() => setSourcesModalMessageId(null)}
            />
            <section className="auth-card relative w-full max-w-2xl p-6">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Assistant Sources
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-900">
                    Response based on {activeSourcesMessage.citations.length} source
                    {activeSourcesMessage.citations.length === 1 ? "" : "s"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSourcesModalMessageId(null)}
                  className="btn-secondary px-3 py-1.5 text-sm"
                >
                  Close
                </button>
              </div>

              {activeSourcesMessage.citations.length > 0 ? (
                <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                  {activeSourcesMessage.citations.map((citation, index) => {
                    const citationKey = `${citation.docId}-${citation.chunkId ?? "none"}-${index}`;
                    return (
                      <button
                        key={citationKey}
                        type="button"
                        onClick={() => {
                          setSourcesModalMessageId(null);
                          openCitationInDocument(citation);
                        }}
                        className="w-full border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-100"
                      >
                        <p className="truncate text-sm font-semibold text-slate-900">{citation.docTitle}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          Path: {citation.headingPath || citation.deepLink || "Document root"}
                        </p>
                        <p
                          className="mt-1 text-xs leading-5 text-slate-600"
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
                <p className="mt-4 text-sm text-slate-600">
                  No sources were attached to this response.
                </p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

// "use client";

// import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { useRouter, useSearchParams } from "next/navigation";
// import { ref, uploadBytesResumable } from "firebase/storage";
// import { useAuth } from "@/lib/AuthContext";
// import { storage } from "@/lib/firebaseClient";
// import type { RagCitation } from "@/lib/rag/types";

// type DocStatus = "ready" | "processing" | "failed";
// type TextStatus = "pending" | "processing" | "ready" | "failed";
// type ChatVisibility = "private";
// type WorkspaceMode = "documents" | "chat-private";
// type SidebarPanel = "documents" | "history";

// type DocumentListItem = {
//   id: string;
//   title: string;
//   storagePath: string;
//   fileType: string;
//   size: number;
//   status: DocStatus;
//   textStatus: TextStatus;
//   version: number;
//   createdAt: string | null;
//   createdBy: string | null;
//   textUpdatedAt: string | null;
//   updatedAt: string | null;
//   updatedBy: string | null;
// };

// type DocumentDetail = DocumentListItem & {
//   extractedText: string | null;
//   textWindow?: {
//     offset: number;
//     limit: number;
//     returnedChars: number;
//     totalChars: number;
//     hasMore: boolean;
//     nextOffset: number | null;
//     anchoredQuery: string | null;
//     matchOffset: number | null;
//   };
// };

// type ChatSummary = {
//   id: string;
//   title: string;
//   visibility: ChatVisibility;
//   ownerUid: string | null;
//   ownerName: string | null;
//   createdAt: string | null;
//   updatedAt: string | null;
//   lastMessageAt: string | null;
//   summary: string | null;
// };

// type ChatMessage = {
//   id: string;
//   role: "user" | "assistant";
//   content: string;
//   createdAt: string | null;
//   createdBy: string | null;
//   createdByName: string | null;
//   citations: RagCitation[];
//   supportLabel: string | null;
//   contextSummary: string | null;
// };

// const FOLDER_FILTERS: Record<string, (doc: DocumentListItem) => boolean> = {
//   all: () => true,
//   ready: (doc) => doc.textStatus === "ready",
//   processing: (doc) => doc.status === "processing" || doc.textStatus !== "ready",
//   failed: (doc) => doc.status === "failed" || doc.textStatus === "failed",
//   governance: (doc) =>
//     /policy|govern|board|audit|compliance/i.test(`${doc.title} ${doc.fileType}`),
//   operations: (doc) => /ops|operation|procedure|process|internal/i.test(doc.title),
//   fundraising: (doc) => /fund|grant|donor|campaign|appeal/i.test(doc.title),
// };

// const FILTER_LABELS: Record<string, string> = {
//   all: "Most recent",
//   ready: "Status: Text Ready",
//   processing: "Status: Processing",
//   failed: "Status: Needs Attention",
//   governance: "Folder: Governance",
//   operations: "Folder: Operations",
//   fundraising: "Folder: Fundraising",
// };

// const RAG_SNIPPET_MAX_LENGTH = 200;
// const CHAT_MESSAGE_MAX_LENGTH = 4_000;
// const DOC_WINDOW_LIMIT = 50_000;
// const CHUNK_VIEW_OFFSET_PADDING = 8_000;
// const RECENT_DOCS_DEFAULT_LIMIT = 10;
// const MAX_DOWNLOAD_FILENAME_LENGTH = 220;

// function asOptionalString(value: unknown) {
//   if (typeof value !== "string") return null;
//   const trimmed = value.trim();
//   return trimmed.length ? trimmed : null;
// }

// function formatDate(iso: string | null) {
//   if (!iso) return "N/A";
//   const d = new Date(iso);
//   if (Number.isNaN(d.getTime())) return "N/A";
//   return d.toLocaleDateString(undefined, {
//     month: "short",
//     day: "numeric",
//     year: "numeric",
//   });
// }

// function formatDateTime(iso: string | null) {
//   if (!iso) return "";
//   const d = new Date(iso);
//   if (Number.isNaN(d.getTime())) return "";
//   return d.toLocaleString(undefined, {
//     month: "short",
//     day: "numeric",
//     hour: "numeric",
//     minute: "2-digit",
//   });
// }

// function splitParagraphs(text: string) {
//   return text
//     .split(/\n{2,}/)
//     .map((p) => p.trim())
//     .filter(Boolean);
// }

// function deriveTitle(filename: string) {
//   const noExt = filename.replace(/\.[^.]+$/, "");
//   const cleaned = noExt.trim().replace(/\s+/g, " ");
//   return cleaned || "Untitled Document";
// }

// function parseFilenameFromContentDisposition(contentDisposition: string | null) {
//   if (!contentDisposition) return null;

//   const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
//   if (utf8Match?.[1]) {
//     try {
//       return decodeURIComponent(utf8Match[1].trim());
//     } catch {
//       // Fall through to standard filename parsing.
//     }
//   }

//   const plainMatch = contentDisposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
//   const plainFilename = plainMatch?.[1] || plainMatch?.[2];
//   if (plainFilename) return plainFilename.trim();
//   return null;
// }

// function sanitizeDownloadFilename(raw: string) {
//   const cleaned = raw
//     .trim()
//     .replace(/[\/\\]+/g, "_")
//     .replace(/[\r\n\t]+/g, " ")
//     .replace(/[<>:"|?*\u0000-\u001F]/g, "_")
//     .replace(/\s+/g, " ")
//     .slice(0, MAX_DOWNLOAD_FILENAME_LENGTH)
//     .trim();
//   return cleaned || "document";
// }

// function escapeRegExp(input: string) {
//   return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// }

// function citationPreviewText(snippet: string) {
//   const normalized = snippet.replace(/\r\n/g, "\n").trim();
//   if (!normalized) return "(No snippet)";
//   const lines = normalized
//     .split("\n")
//     .map((line) => line.trim())
//     .filter(Boolean);
//   const preview = (lines.slice(0, 2).join(" ") || normalized).trim();
//   if (preview.length <= RAG_SNIPPET_MAX_LENGTH) return preview;
//   return `${preview.slice(0, RAG_SNIPPET_MAX_LENGTH)}...`;
// }

// function normalizeRagCitations(value: unknown): RagCitation[] {
//   if (!Array.isArray(value)) return [];

//   return value
//     .map((item) => {
//       if (!item || typeof item !== "object") return null;
//       const citation = item as {
//         docId?: unknown;
//         docTitle?: unknown;
//         headingPath?: unknown;
//         chunkId?: unknown;
//         snippet?: unknown;
//         moreContext?: unknown;
//         deepLink?: unknown;
//         similarity?: unknown;
//       };
//       if (typeof citation.docId !== "string" || typeof citation.docTitle !== "string") {
//         return null;
//       }

//       return {
//         docId: citation.docId,
//         docTitle: citation.docTitle,
//         headingPath: typeof citation.headingPath === "string" ? citation.headingPath : null,
//         chunkId: typeof citation.chunkId === "string" ? citation.chunkId : null,
//         snippet: typeof citation.snippet === "string" ? citation.snippet : "",
//         moreContext: typeof citation.moreContext === "string" ? citation.moreContext : null,
//         deepLink: typeof citation.deepLink === "string" ? citation.deepLink : "/documents",
//         similarity:
//           typeof citation.similarity === "number" && Number.isFinite(citation.similarity)
//             ? citation.similarity
//             : 0,
//       };
//     })
//     .filter((citation): citation is RagCitation => Boolean(citation));
// }
// function normalizeChatSummaries(value: unknown): ChatSummary[] {
//   if (!Array.isArray(value)) return [];
//   return value
//     .map((item) => {
//       if (!item || typeof item !== "object") return null;
//       const chat = item as {
//         id?: unknown;
//         title?: unknown;
//         visibility?: unknown;
//         ownerUid?: unknown;
//         ownerName?: unknown;
//         createdAt?: unknown;
//         updatedAt?: unknown;
//         lastMessageAt?: unknown;
//         summary?: unknown;
//       };
//       if (typeof chat.id !== "string") return null;
//       if (chat.visibility !== undefined && chat.visibility !== "private") return null;
//       const visibility: ChatVisibility = "private";
//       return {
//         id: chat.id,
//         title: typeof chat.title === "string" ? chat.title : "New chat",
//         visibility,
//         ownerUid: asOptionalString(chat.ownerUid),
//         ownerName: asOptionalString(chat.ownerName),
//         createdAt: typeof chat.createdAt === "string" ? chat.createdAt : null,
//         updatedAt: typeof chat.updatedAt === "string" ? chat.updatedAt : null,
//         lastMessageAt: typeof chat.lastMessageAt === "string" ? chat.lastMessageAt : null,
//         summary: typeof chat.summary === "string" ? chat.summary : null,
//       } satisfies ChatSummary;
//     })
//     .filter((chat): chat is ChatSummary => Boolean(chat));
// }

// function normalizeChatMessage(value: unknown): ChatMessage | null {
//   if (!value || typeof value !== "object") return null;
//   const message = value as {
//     id?: unknown;
//     role?: unknown;
//     content?: unknown;
//     createdAt?: unknown;
//     createdBy?: unknown;
//     createdByName?: unknown;
//     citations?: unknown;
//     supportLabel?: unknown;
//     contextSummary?: unknown;
//   };
//   if (typeof message.id !== "string") return null;
//   const role = message.role === "assistant" ? "assistant" : "user";
//   return {
//     id: message.id,
//     role,
//     content: typeof message.content === "string" ? message.content : "",
//     createdAt: typeof message.createdAt === "string" ? message.createdAt : null,
//     createdBy: asOptionalString(message.createdBy),
//     createdByName: asOptionalString(message.createdByName),
//     citations: role === "assistant" ? normalizeRagCitations(message.citations) : [],
//     supportLabel:
//       role === "assistant" && typeof message.supportLabel === "string" ? message.supportLabel : null,
//     contextSummary:
//       role === "assistant" && typeof message.contextSummary === "string"
//         ? message.contextSummary
//         : null,
//   };
// }

// function dedupeChatMessages(messages: ChatMessage[]) {
//   const seen = new Set<string>();
//   const next: ChatMessage[] = [];
//   for (const message of messages) {
//     if (!message.id || seen.has(message.id)) continue;
//     seen.add(message.id);
//     next.push(message);
//   }
//   return next;
// }

// function ListSkeleton() {
//   return (
//     <div className="space-y-3">
//       {[...Array.from({ length: 6 })].map((_, i) => (
//         <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
//       ))}
//     </div>
//   );
// }

// function ViewerSkeleton() {
//   return (
//     <div className="space-y-4">
//       <div className="h-8 w-2/5 animate-pulse rounded bg-slate-100" />
//       <div className="h-5 w-3/5 animate-pulse rounded bg-slate-100" />
//       <div className="h-[1px] bg-slate-200" />
//       {[...Array.from({ length: 8 })].map((_, i) => (
//         <div key={i} className="h-4 animate-pulse rounded bg-slate-100" />
//       ))}
//     </div>
//   );
// }

// function ThinkingDots() {
//   return (
//     <span className="ml-1 inline-flex items-end gap-1 align-middle" aria-hidden="true">
//       {[0, 1, 2].map((idx) => (
//         <span
//           key={idx}
//           className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
//           style={{ animationDelay: `${idx * 0.12}s` }}
//         />
//       ))}
//     </span>
//   );
// }

// function ChatIcon() {
//   return (
//     <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
//       <path
//         d="M4 4.5h12v8H9l-3.5 3v-3H4v-8Z"
//         stroke="currentColor"
//         strokeWidth="1.5"
//         strokeLinejoin="round"
//       />
//     </svg>
//   );
// }

// export default function DocumentsPage() {
//   const router = useRouter();
//   const searchParams = useSearchParams();
//   const { user, loading, authedFetch, me } = useAuth();

//   const requestedMode = useMemo<WorkspaceMode>(() => "chat-private", []);
//   const requestedChatId = useMemo(
//     () => asOptionalString(searchParams.get("chatId")),
//     [searchParams],
//   );
//   const deepLinkDocId = searchParams.get("docId");
//   const deepLinkHighlight = searchParams.get("highlight");

//   const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(requestedMode);
//   const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("history");
//   const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);

//   const [docs, setDocs] = useState<DocumentListItem[]>([]);
//   const [docsLoading, setDocsLoading] = useState(true);
//   const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
//   const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
//   const [docLoading, setDocLoading] = useState(false);
//   const [loadingMoreText, setLoadingMoreText] = useState(false);
//   const [leftFilter, setLeftFilter] = useState("");
//   const [activeFolderId, setActiveFolderId] = useState("all");
//   const [docFiltersOpen, setDocFiltersOpen] = useState(false);
//   const [showAllDocs, setShowAllDocs] = useState(false);
//   const [detailAnchorQuery, setDetailAnchorQuery] = useState<string | null>(null);
//   const [detailOffset, setDetailOffset] = useState<number | null>(null);
//   const [viewerHighlightQuery, setViewerHighlightQuery] = useState<string | null>(null);
//   const [statusInfoOpen, setStatusInfoOpen] = useState(false);

//   const [uploadFile, setUploadFile] = useState<File | null>(null);
//   const [uploadTitle, setUploadTitle] = useState("");
//   const [uploading, setUploading] = useState(false);
//   const [uploadProgress, setUploadProgress] = useState<number | null>(null);
//   const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);

//   const [chatList, setChatList] = useState<ChatSummary[]>([]);
//   const [chatListLoading, setChatListLoading] = useState(false);
//   const [activeChatId, setActiveChatId] = useState<string | null>(
//     requestedMode === "chat-private" ? requestedChatId : null,
//   );
//   const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
//   const [chatLoading, setChatLoading] = useState(false);
//   const [chatSending, setChatSending] = useState(false);
//   const [assistantTyping, setAssistantTyping] = useState(false);
//   const [chatInput, setChatInput] = useState("");
//   const [chatError, setChatError] = useState<string | null>(null);
//   const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
//   const [sourcesModalMessageId, setSourcesModalMessageId] = useState<string | null>(null);

//   const [message, setMessage] = useState<string | null>(null);
//   const [error, setError] = useState<string | null>(null);

//   const firstMatchRef = useRef<HTMLElement | null>(null);
//   const chatScrollRef = useRef<HTMLDivElement | null>(null);
//   const handledDeepLinkRef = useRef<string | null>(null);
//   const chatAutoScrollRef = useRef(true);
//   const chatSendInFlightRef = useRef(false);

//   const displayName = useMemo(() => {
//     const candidate = typeof me?.name === "string" ? me.name.trim() : "";
//     if (candidate) return candidate;
//     const email = user?.email?.trim() || "";
//     if (email) return email;
//     return "You";
//   }, [me?.name, user?.email]);

//   const activeChats = chatList;
//   const chatsLoading = chatListLoading;
//   const isChatMode = workspaceMode === "chat-private";
//   const activeSourcesMessage = useMemo(
//     () =>
//       chatMessages.find(
//         (chatMessage) =>
//           chatMessage.id === sourcesModalMessageId && chatMessage.role === "assistant",
//       ) || null,
//     [chatMessages, sourcesModalMessageId],
//   );

//   const effectiveHighlightQuery = (viewerHighlightQuery || "").trim();
//   const normalizedLeftFilter = leftFilter.trim();

//   const visibleDocs = useMemo(() => {
//     const q = normalizedLeftFilter.toLowerCase();
//     const folderFilter = FOLDER_FILTERS[activeFolderId] || FOLDER_FILTERS.all;
//     return docs.filter((doc) => {
//       if (!folderFilter(doc)) return false;
//       if (!q) return true;
//       return doc.title.toLowerCase().includes(q);
//     });
//   }, [docs, normalizedLeftFilter, activeFolderId]);
//   const showingRecentOnly = activeFolderId === "all" && !normalizedLeftFilter && !showAllDocs;
//   const displayedDocs = useMemo(
//     () => (showingRecentOnly ? visibleDocs.slice(0, RECENT_DOCS_DEFAULT_LIMIT) : visibleDocs),
//     [showingRecentOnly, visibleDocs],
//   );
//   const activeFilterLabel = FILTER_LABELS[activeFolderId] || FILTER_LABELS.all;

//   const selectedMeta = useMemo(
//     () => docs.find((d) => d.id === selectedDocId) || null,
//     [docs, selectedDocId],
//   );
//   const selectedDocStatus = selectedDoc?.status || selectedMeta?.status || "processing";
//   const canDownloadSelectedDoc = Boolean(selectedDocId && selectedDocStatus === "ready");
//   const extractedText = selectedDoc?.extractedText?.trim() || "";
//   const paragraphs = extractedText ? splitParagraphs(extractedText) : [];

//   const switchToDocumentsMode = useCallback(() => {
//     router.push("/documents");
//   }, [router]);

//   const switchToChatMode = useCallback(
//     (chatId?: string | null) => {
//       const nextChatId = chatId ?? activeChatId ?? null;
//       setWorkspaceMode("chat-private");
//       setSidebarPanel("history");
//       if (nextChatId) {
//         router.replace(`/chat?chatId=${encodeURIComponent(nextChatId)}`);
//         return;
//       }
//       router.replace("/chat");
//     },
//     [activeChatId, router],
//   );

//   useEffect(() => {
//     if (!loading && !user) router.push("/login");
//   }, [loading, user, router]);

//   useEffect(() => {
//     setWorkspaceMode(requestedMode);
//     setSidebarPanel("history");
//     if (requestedMode === "chat-private" && requestedChatId) {
//       setActiveChatId(requestedChatId);
//     }
//   }, [requestedChatId, requestedMode]);

//   async function loadDocuments() {
//     if (!user) return;
//     setDocsLoading(true);
//     setError(null);

//     try {
//       const res = await authedFetch("/api/documents");
//       const data = await res.json().catch(() => ({}));
//       if (!res.ok) throw new Error(data?.error || "Failed to load documents");

//       const documents = Array.isArray(data?.documents)
//         ? (data.documents as DocumentListItem[])
//         : [];

//       setDocs(documents);
//       setSelectedDocId((current) => {
//         if (documents.length === 0) return null;
//         if (current && documents.some((d) => d.id === current)) return current;
//         return null;
//       });
//     } catch (err: unknown) {
//       if (err instanceof Error) setError(err.message);
//       else setError("Failed to load documents");
//     } finally {
//       setDocsLoading(false);
//     }
//   }

//   useEffect(() => {
//     if (!loading && user) void loadDocuments();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [loading, user]);

//   const fetchDocumentDetail = useCallback(
//     async (args: { docId: string; offset?: number; anchorQuery?: string | null }) => {
//       const { docId, offset, anchorQuery } = args;
//       const params = new URLSearchParams();
//       params.set("limit", String(DOC_WINDOW_LIMIT));
//       if (typeof offset === "number" && Number.isFinite(offset) && offset >= 0) {
//         params.set("offset", String(Math.floor(offset)));
//       }

//       const q = anchorQuery?.trim();
//       if (q) params.set("q", q);

//       const res = await authedFetch(`/api/documents/${docId}?${params.toString()}`);
//       const data = await res.json().catch(() => ({}));
//       if (!res.ok) throw new Error(data?.error || "Failed to load document");
//       const doc = data?.document as DocumentDetail | undefined;
//       if (!doc?.id) throw new Error("Invalid document response");
//       return doc;
//     },
//     [authedFetch],
//   );

//   useEffect(() => {
//     if (!selectedDocId || !user) {
//       setSelectedDoc(null);
//       return;
//     }

//     let cancelled = false;
//     const loadDetail = async () => {
//       setDocLoading(true);
//       setError(null);
//       try {
//         const doc = await fetchDocumentDetail({
//           docId: selectedDocId,
//           offset: detailOffset ?? undefined,
//           anchorQuery: detailAnchorQuery,
//         });
//         if (!cancelled) setSelectedDoc(doc);
//       } catch (err: unknown) {
//         if (!cancelled) {
//           setSelectedDoc(null);
//           if (err instanceof Error) setError(err.message);
//           else setError("Failed to load document");
//         }
//       } finally {
//         if (!cancelled) setDocLoading(false);
//       }
//     };

//     void loadDetail();

//     return () => {
//       cancelled = true;
//     };
//   }, [detailAnchorQuery, detailOffset, fetchDocumentDetail, selectedDocId, user]);

//   async function loadMoreExtractedText() {
//     if (!selectedDocId || !selectedDoc?.textWindow?.hasMore || loadingMoreText) return;

//     setLoadingMoreText(true);
//     setError(null);
//     try {
//       const doc = await fetchDocumentDetail({
//         docId: selectedDocId,
//         offset: selectedDoc.textWindow.nextOffset ?? 0,
//       });
//       setSelectedDoc((current) => {
//         if (!current || current.id !== doc.id) return doc;
//         const existing = current.extractedText || "";
//         const incoming = doc.extractedText || "";
//         return {
//           ...doc,
//           extractedText: `${existing}${incoming}` || null,
//         };
//       });
//     } catch (err: unknown) {
//       if (err instanceof Error) setError(err.message);
//       else setError("Failed to load more text");
//     } finally {
//       setLoadingMoreText(false);
//     }
//   }

//   const loadChats = useCallback(async () => {
//     if (!user) return;
//     setChatListLoading(true);
//     setChatError(null);
//     try {
//       const res = await authedFetch("/api/chats?limit=25&visibility=private");
//       const data = await res.json().catch(() => ({}));
//       if (!res.ok) throw new Error(data?.error || "Failed to load chats");
//       const nextChats = normalizeChatSummaries(data?.chats).filter(
//         (chat) => chat.visibility === "private",
//       );
//       setChatList(nextChats);
//       setActiveChatId((current) => {
//         if (current && nextChats.some((chat) => chat.id === current)) return current;
//         return nextChats[0]?.id || null;
//       });
//     } catch (err: unknown) {
//       if (err instanceof Error) setChatError(err.message);
//       else setChatError("Failed to load chats");
//     } finally {
//       setChatListLoading(false);
//     }
//   }, [authedFetch, user]);

//   useEffect(() => {
//     if (loading || !user) return;
//     void loadChats();
//   }, [loadChats, loading, user]);

//   useEffect(() => {
//     if (requestedMode !== "chat-private") return;
//     if (!requestedChatId) return;
//     if (!chatList.some((chat) => chat.id === requestedChatId)) return;
//     setActiveChatId(requestedChatId);
//   }, [chatList, requestedChatId, requestedMode]);

//   useEffect(() => {
//     if (!activeChatId) {
//       setChatMessages([]);
//       return;
//     }
//     let cancelled = false;
//     const loadChatDetail = async () => {
//       setChatLoading(true);
//       setChatError(null);
//       try {
//         const res = await authedFetch(`/api/chats/${activeChatId}?limit=60`);
//         const data = await res.json().catch(() => ({}));
//         if (!res.ok) throw new Error(data?.error || "Failed to load chat");
//         const messages = Array.isArray(data?.messages)
//           ? data.messages
//               .map((item: unknown) => normalizeChatMessage(item))
//               .filter((item: ChatMessage | null): item is ChatMessage => Boolean(item))
//           : [];
//         if (cancelled) return;
//         setChatMessages(dedupeChatMessages(messages));
//       } catch (err: unknown) {
//         if (!cancelled) {
//           setChatMessages([]);
//           if (err instanceof Error) setChatError(err.message);
//           else setChatError("Failed to load chat");
//         }
//       } finally {
//         if (!cancelled) setChatLoading(false);
//       }
//     };

//     void loadChatDetail();

//     return () => {
//       cancelled = true;
//     };
//   }, [activeChatId, authedFetch]);

//   const createChat = useCallback(
//     async (title?: string) => {
//       const res = await authedFetch("/api/chats", {
//         method: "POST",
//         body: JSON.stringify({ title: title?.trim() || "New chat", visibility: "private" }),
//       });
//       const data = await res.json().catch(() => ({}));
//       if (!res.ok) throw new Error(data?.error || "Failed to create chat");
//       const next = normalizeChatSummaries([data?.chat])[0];
//       if (!next) throw new Error("Invalid chat response");
//       return next;
//     },
//     [authedFetch],
//   );

//   async function handleNewChat() {
//     setChatError(null);
//     try {
//       const nextChat = await createChat("New chat");
//       setChatList((current) => [nextChat, ...current.filter((chat) => chat.id !== nextChat.id)]);
//       setActiveChatId(nextChat.id);
//       setChatMessages([]);
//       switchToChatMode(nextChat.id);
//     } catch (err: unknown) {
//       if (err instanceof Error) setChatError(err.message);
//       else setChatError("Failed to create chat");
//     }
//   }

//   async function ensureActiveChatId(seedTitle: string) {
//     if (activeChatId) return activeChatId;
//     const nextChat = await createChat(seedTitle);
//     setChatList((current) => [nextChat, ...current.filter((chat) => chat.id !== nextChat.id)]);
//     setActiveChatId(nextChat.id);
//     return nextChat.id;
//   }

//   async function handleSendChatMessage() {
//     const content = chatInput.trim();
//     if (!content || chatSending || chatSendInFlightRef.current) return;
//     if (content.length > CHAT_MESSAGE_MAX_LENGTH) {
//       setChatError(`Message too long (${CHAT_MESSAGE_MAX_LENGTH} char max).`);
//       return;
//     }

//     chatSendInFlightRef.current = true;
//     setChatSending(true);
//     setAssistantTyping(true);
//     setChatError(null);

//     try {
//       const chatId = await ensureActiveChatId(content);
//       switchToChatMode(chatId);
//       const res = await authedFetch(`/api/chats/${chatId}/messages`, {
//         method: "POST",
//         body: JSON.stringify({ content }),
//       });
//       const data = await res.json().catch(() => ({}));
//       if (!res.ok) throw new Error(data?.error || "Failed to send message");

//       const userMessage = normalizeChatMessage(data?.userMessage);
//       const assistantMessage = normalizeChatMessage(data?.assistantMessage);
//       const nextMessages = [userMessage, assistantMessage].filter(
//         (item): item is ChatMessage => Boolean(item),
//       );

//       setChatMessages((current) => dedupeChatMessages([...current, ...nextMessages]));
//       setChatInput("");
//       await loadChats();
//     } catch (err: unknown) {
//       if (err instanceof Error) setChatError(err.message);
//       else setChatError("Failed to send message");
//     } finally {
//       chatSendInFlightRef.current = false;
//       setChatSending(false);
//       setAssistantTyping(false);
//     }
//   }

//   const resolveHighlightToAnchor = useCallback(
//     async (docId: string, chunkId: string) => {
//       try {
//         const res = await authedFetch(
//           `/api/documents/${encodeURIComponent(docId)}/chunk-context?chunkId=${encodeURIComponent(chunkId)}`,
//         );
//         const data = await res.json().catch(() => ({}));
//         if (!res.ok) return;
//         const anchor = typeof data?.anchorQuery === "string" ? data.anchorQuery.trim() : "";
//         const highlightText =
//           typeof data?.highlightText === "string" ? data.highlightText.trim() : "";
//         const chunkStartOffset =
//           typeof data?.startOffset === "number" && Number.isFinite(data.startOffset)
//             ? Math.max(0, Math.floor(data.startOffset))
//             : null;

//         setDetailAnchorQuery(anchor || null);
//         setViewerHighlightQuery(highlightText || anchor || null);
//         setDetailOffset(
//           chunkStartOffset !== null
//             ? Math.max(0, chunkStartOffset - CHUNK_VIEW_OFFSET_PADDING)
//             : null,
//         );
//       } catch {
//         setDetailAnchorQuery(null);
//         setViewerHighlightQuery(null);
//         setDetailOffset(null);
//       }
//     },
//     [authedFetch],
//   );

//   useEffect(() => {
//     if (!deepLinkDocId) {
//       handledDeepLinkRef.current = null;
//       return;
//     }
//     const key = `${deepLinkDocId}:${deepLinkHighlight ?? ""}`;
//     if (handledDeepLinkRef.current === key) return;
//     handledDeepLinkRef.current = key;
//     switchToDocumentsMode();
//     setSelectedDocId(deepLinkDocId);
//     if (deepLinkHighlight) {
//       void resolveHighlightToAnchor(deepLinkDocId, deepLinkHighlight);
//       return;
//     }
//     setDetailOffset(null);
//     setDetailAnchorQuery(null);
//     setViewerHighlightQuery(null);
//   }, [deepLinkDocId, deepLinkHighlight, resolveHighlightToAnchor, switchToDocumentsMode]);

//   useEffect(() => {
//     setStatusInfoOpen(false);
//   }, [selectedDocId]);

//   useEffect(() => {
//     if (!docLoading && selectedDocId && effectiveHighlightQuery && firstMatchRef.current) {
//       firstMatchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
//     }
//   }, [docLoading, selectedDocId, extractedText, effectiveHighlightQuery]);

//   const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
//     if (!chatScrollRef.current) return;
//     chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior });
//   }, []);
//   useEffect(() => {
//     if (!isChatMode) return;
//     chatAutoScrollRef.current = true;
//     const id = requestAnimationFrame(() => scrollChatToBottom("auto"));
//     return () => cancelAnimationFrame(id);
//   }, [activeChatId, isChatMode, scrollChatToBottom]);

//   useEffect(() => {
//     if (!isChatMode) return;
//     if (!chatAutoScrollRef.current) return;
//     scrollChatToBottom(chatSending ? "smooth" : "auto");
//   }, [chatLoading, chatMessages, chatSending, isChatMode, scrollChatToBottom]);

//   useEffect(() => {
//     if (!message) return;
//     const timer = window.setTimeout(() => setMessage(null), 2000);
//     return () => window.clearTimeout(timer);
//   }, [message]);

//   async function handleUpload() {
//     if (!user || !uploadFile || !uploadTitle.trim()) return;
//     setUploading(true);
//     setUploadProgress(0);
//     setError(null);
//     setMessage(null);

//     let docId: string | null = null;
//     let uploadFinalized = false;
//     try {
//       const initRes = await authedFetch("/api/documents/init-upload", {
//         method: "POST",
//         body: JSON.stringify({
//           filename: uploadFile.name,
//           title: uploadTitle.trim(),
//           fileType: uploadFile.type || "application/octet-stream",
//           size: uploadFile.size,
//         }),
//       });
//       const initData = await initRes.json().catch(() => ({}));
//       if (!initRes.ok) throw new Error(initData?.error || "Failed to initialize upload");

//       docId = String(initData.docId || "");
//       const storagePath = String(initData.storagePath || "");
//       if (!docId || !storagePath) throw new Error("Invalid upload initialization response");

//       const storageRef = ref(storage, storagePath);
//       await new Promise<void>((resolve, reject) => {
//         const task = uploadBytesResumable(storageRef, uploadFile, {
//           contentType: uploadFile.type || undefined,
//         });

//         task.on(
//           "state_changed",
//           (snapshot) => {
//             const pct = Math.round(
//               (snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1)) * 100,
//             );
//             setUploadProgress(pct);
//           },
//           (uploadErr) => reject(uploadErr),
//           () => resolve(),
//         );
//       });

//       const finalizeRes = await authedFetch(`/api/documents/${docId}`, {
//         method: "PATCH",
//         body: JSON.stringify({
//           status: "ready",
//           title: uploadTitle.trim(),
//           fileType: uploadFile.type || "application/octet-stream",
//           size: uploadFile.size,
//         }),
//       });
//       const finalizeData = await finalizeRes.json().catch(() => ({}));
//       if (!finalizeRes.ok) throw new Error(finalizeData?.error || "Failed to finalize upload");
//       uploadFinalized = true;

//       const extractRes = await authedFetch(`/api/documents/${docId}/extract-text`, {
//         method: "POST",
//       });
//       const extractData = await extractRes.json().catch(() => ({}));
//       if (!extractRes.ok) {
//         throw new Error(
//           extractData?.error ||
//             "Upload completed, but text extraction failed. Please re-run extraction.",
//         );
//       }

//       await loadDocuments();
//       setUploadFile(null);
//       setUploadTitle("");
//       setUploadProgress(null);
//       setMessage("Upload complete. Select the document from the list to open it.");
//       switchToDocumentsMode();
//     } catch (err: unknown) {
//       if (docId && !uploadFinalized) {
//         try {
//           await authedFetch(`/api/documents/${docId}`, {
//             method: "PATCH",
//             body: JSON.stringify({ status: "failed" }),
//           });
//         } catch {
//           // no-op
//         }
//       }
//       if (uploadFinalized) {
//         await loadDocuments();
//         setUploadFile(null);
//         setUploadTitle("");
//         setUploadProgress(null);
//         switchToDocumentsMode();
//       }
//       if (err instanceof Error) setError(err.message);
//       else setError("Upload failed");
//     } finally {
//       setUploading(false);
//     }
//   }

//   function openDocument(docId: string) {
//     switchToDocumentsMode();
//     setDetailOffset(null);
//     setDetailAnchorQuery(null);
//     setViewerHighlightQuery(null);
//     setSelectedDocId(docId);
//   }

//   function closeDocument() {
//     const next = new URLSearchParams(searchParams.toString());
//     next.delete("docId");
//     next.delete("highlight");
//     next.set("mode", "documents");
//     next.delete("chatId");
//     const nextQuery = next.toString();
//     router.replace(nextQuery ? `/documents?${nextQuery}` : "/documents");
//     handledDeepLinkRef.current = null;
//     setSelectedDocId(null);
//     setSelectedDoc(null);
//     setDetailOffset(null);
//     setDetailAnchorQuery(null);
//     setViewerHighlightQuery(null);
//     setStatusInfoOpen(false);
//   }

//   function openCitationInDocument(citation: RagCitation) {
//     const next = new URLSearchParams();
//     next.set("docId", citation.docId);
//     if (citation.chunkId) next.set("highlight", citation.chunkId);
//     router.push(`/documents?${next.toString()}`);
//   }

//   async function handleDownloadDocument(docIdInput?: string | null) {
//     const docId = (docIdInput || selectedDocId || "").trim();
//     if (!docId) return;

//     setError(null);
//     setMessage(null);
//     setDownloadingDocId(docId);

//     try {
//       const res = await authedFetch(`/api/documents/${encodeURIComponent(docId)}/download`);
//       if (!res.ok) {
//         const data = await res.json().catch(() => ({}));
//         throw new Error(data?.error || "Failed to download document");
//       }

//       const blob = await res.blob();
//       const parsedFilename = parseFilenameFromContentDisposition(
//         res.headers.get("Content-Disposition"),
//       );
//       const fallbackTitle = selectedDoc?.title || selectedMeta?.title || "document";
//       const filename = sanitizeDownloadFilename(parsedFilename || fallbackTitle);
//       const objectUrl = URL.createObjectURL(blob);

//       const anchor = document.createElement("a");
//       anchor.href = objectUrl;
//       anchor.download = filename;
//       document.body.appendChild(anchor);
//       anchor.click();
//       anchor.remove();

//       window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
//       setMessage("Download started.");
//     } catch (err: unknown) {
//       if (err instanceof Error) setError(err.message);
//       else setError("Failed to download document");
//     } finally {
//       setDownloadingDocId(null);
//     }
//   }

//   async function copyAssistantMessage(messageId: string, content: string) {
//     if (!content.trim()) return;
//     try {
//       await navigator.clipboard.writeText(content);
//       setCopiedAssistantMessageId(messageId);
//       setTimeout(() => {
//         setCopiedAssistantMessageId((current) => (current === messageId ? null : current));
//       }, 1200);
//     } catch {
//       setChatError("Unable to copy message.");
//     }
//   }

//   function messageSenderLabel(chatMessage: ChatMessage) {
//     if (chatMessage.role === "assistant") return "Assistant";
//     if (chatMessage.createdBy && user && chatMessage.createdBy === user.uid) return "You";
//     if (chatMessage.createdByName) return chatMessage.createdByName;
//     return displayName;
//   }

//   function onChatScroll() {
//     if (!chatScrollRef.current) return;
//     const el = chatScrollRef.current;
//     const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
//     chatAutoScrollRef.current = distanceFromBottom < 80;
//   }

//   useEffect(() => {
//     if (!sourcesModalMessageId) return;

//     const onKeyDown = (event: KeyboardEvent) => {
//       if (event.key === "Escape") setSourcesModalMessageId(null);
//     };

//     window.addEventListener("keydown", onKeyDown);
//     return () => window.removeEventListener("keydown", onKeyDown);
//   }, [sourcesModalMessageId]);

//   if (loading || !user) {
//     return (
//       <main className="workspace-page-fill workspace-page-no-top-gap min-h-screen bg-slate-50 [font-family:var(--font-geist-sans)]">
//         <div className="w-full min-h-screen bg-slate-50 p-3 sm:p-4">
//           <div className="h-12 animate-pulse border border-slate-200 bg-white/90" />
//           <div className="grid grid-cols-1 gap-0 lg:grid-cols-[224px_minmax(0,1fr)]">
//             <aside className="border border-slate-200 bg-white/90 p-4">
//               <ListSkeleton />
//             </aside>
//             <section className="border border-slate-200 bg-white/90 p-6">
//               <ViewerSkeleton />
//             </section>
//           </div>
//         </div>
//       </main>
//     );
//   }

//   let firstMatchAssigned = false;

//   return (
//     <main className="workspace-page-fill workspace-page-no-top-gap min-h-screen bg-slate-50 [font-family:var(--font-geist-sans)]">
//       <a
//         href="#chat-main-content"
//         className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900"
//       >
//         Skip to main content
//       </a>
//       <div className="w-full min-h-screen bg-slate-50 pt-0">
//         {error || message ? (
//           <div className="space-y-2 px-3 pb-2 sm:px-4">
//             {error ? (
//               <p
//                 className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm"
//                 role="alert"
//               >
//                 {error}
//               </p>
//             ) : null}
//             {message ? (
//               <p
//                 className="rounded-xl border border-emerald-300/70 bg-emerald-100/60 px-3 py-2 text-sm text-emerald-800 shadow-sm"
//                 role="status"
//                 aria-live="polite"
//               >
//                 {message}
//               </p>
//             ) : null}
//           </div>
//         ) : null}

//         <div
//           className={`grid min-h-[100dvh] grid-cols-1 gap-0 ${
//             leftSidebarCollapsed
//               ? "lg:grid-cols-[56px_minmax(0,1fr)]"
//               : "lg:grid-cols-[224px_minmax(0,1fr)]"
//           }`}
//         >
//           <aside
//             className={`sticky top-0 self-start border-r border-slate-200 bg-slate-50 lg:order-1 ${
//               leftSidebarCollapsed
//                 ? "h-[100dvh] p-2"
//                 : "h-[100dvh] overflow-y-auto p-4"
//             }`}
//             onClick={leftSidebarCollapsed ? () => setLeftSidebarCollapsed(false) : undefined}
//             role={leftSidebarCollapsed ? "button" : undefined}
//             tabIndex={leftSidebarCollapsed ? 0 : undefined}
//             aria-label={leftSidebarCollapsed ? "Expand left sidebar" : "Left sidebar"}
//             onKeyDown={
//               leftSidebarCollapsed
//                 ? (event) => {
//                     if (event.key === "Enter" || event.key === " ") {
//                       event.preventDefault();
//                       setLeftSidebarCollapsed(false);
//                     }
//                   }
//                 : undefined
//             }
//           >
//             {leftSidebarCollapsed ? (
//               <div className="flex h-full min-h-0 flex-col justify-start gap-2 rounded-xl border border-slate-200 bg-slate-100 p-2">
//                 <button
//                   type="button"
//                   onClick={(event) => {
//                     event.stopPropagation();
//                     setSidebarPanel("history");
//                     setLeftSidebarCollapsed(false);
//                   }}
//                   className={`inline-flex h-10 items-center justify-center rounded-lg border transition ${
//                     sidebarPanel === "history"
//                       ? "border-emerald-200 bg-emerald-100 text-emerald-700"
//                       : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
//                   }`}
//                   aria-label="Open history panel"
//                 >
//                   <ChatIcon />
//                 </button>
//               </div>
//             ) : (
//               <>
//             <div className="mb-2 flex items-center justify-end">
//               <button
//                 type="button"
//                 onClick={() => setLeftSidebarCollapsed(true)}
//                 className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
//                 aria-label="Collapse sidebar"
//                 aria-expanded={!leftSidebarCollapsed}
//                 title="Collapse sidebar"
//               >
//                 {"<"}
//               </button>
//             </div>
//             <div className="flex w-full items-center gap-2 border-b border-slate-200 pb-2">
//               <ChatIcon />
//               <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
//                 Chat History
//               </h2>
//             </div>

//             {sidebarPanel === "documents" ? (
//               <div className="mt-4 space-y-3">
//                 <section className="rounded-xl border border-slate-200 bg-slate-100 p-3">
//                   <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
//                     Upload New File
//                   </h2>
//                   <div className="mt-2 space-y-2">
//                     <input
//                       type="file"
//                       onChange={(e) => {
//                         const file = e.target.files?.[0] ?? null;
//                         setUploadFile(file);
//                         setUploadTitle(file ? deriveTitle(file.name) : "");
//                       }}
//                       className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
//                     />
//                     <input
//                       value={uploadTitle}
//                       onChange={(e) => setUploadTitle(e.target.value)}
//                       placeholder="Document title"
//                       className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
//                     />
//                     <button
//                       type="button"
//                       disabled={!uploadFile || !uploadTitle.trim() || uploading}
//                       onClick={() => void handleUpload()}
//                       className="w-full cursor-pointer rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
//                     >
//                       {uploading ? "Uploading..." : "Upload"}
//                     </button>
//                     {uploadProgress !== null ? (
//                       <p className="text-[11px] text-slate-500">Upload progress: {uploadProgress}%</p>
//                     ) : null}
//                   </div>
//                 </section>

//                 <button
//                   type="button"
//                   onClick={() => void loadDocuments()}
//                   className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
//                 >
//                   Refresh Documents
//                 </button>

//                 <section className="rounded-xl border border-slate-200 bg-slate-100 p-3">
//                   <button
//                     type="button"
//                     onClick={() => setDocFiltersOpen((current) => !current)}
//                     className="flex w-full items-center justify-between text-left"
//                     aria-expanded={docFiltersOpen}
//                     aria-controls="chat-filter-panel"
//                   >
//                     <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
//                       Filter Docs
//                     </h2>
//                     <span className="text-xs font-semibold text-slate-600">
//                       {docFiltersOpen ? "Hide" : "Show"}
//                     </span>
//                   </button>
//                   <p className="mt-1 text-[11px] text-slate-500">
//                     Active: <span className="font-medium text-slate-700">{activeFilterLabel}</span>
//                   </p>
//                   {docFiltersOpen ? (
//                     <div id="chat-filter-panel" className="mt-3 space-y-3">
//                       <input
//                         value={leftFilter}
//                         onChange={(e) => {
//                           const nextValue = e.target.value;
//                           setLeftFilter(nextValue);
//                           if (nextValue.trim()) setShowAllDocs(true);
//                           else if (activeFolderId === "all") setShowAllDocs(false);
//                         }}
//                         placeholder="Search document titles..."
//                         className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
//                       />
//                       <div>
//                         <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
//                           Most recent
//                         </p>
//                         <button
//                           type="button"
//                           onClick={() => {
//                             setActiveFolderId("all");
//                             if (!normalizedLeftFilter) setShowAllDocs(false);
//                           }}
//                           className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition ${
//                             activeFolderId === "all"
//                               ? "border-slate-900 bg-slate-900 text-white"
//                               : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
//                           }`}
//                         >
//                           Recent uploads
//                         </button>
//                       </div>
//                       <div>
//                         <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
//                           By status
//                         </p>
//                         <div className="mt-1 grid grid-cols-1 gap-1">
//                           {[
//                             { id: "ready", label: "Text Ready" },
//                             { id: "processing", label: "Processing" },
//                             { id: "failed", label: "Needs Attention" },
//                           ].map((option) => (
//                             <button
//                               key={option.id}
//                               type="button"
//                               onClick={() => {
//                                 setActiveFolderId(option.id);
//                                 setShowAllDocs(true);
//                               }}
//                               className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition ${
//                                 activeFolderId === option.id
//                                   ? "border-slate-900 bg-slate-900 text-white"
//                                   : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
//                               }`}
//                             >
//                               {option.label}
//                             </button>
//                           ))}
//                         </div>
//                       </div>
//                       <div>
//                         <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
//                           By folders
//                         </p>
//                         <div className="mt-1 grid grid-cols-1 gap-1">
//                           {[
//                             { id: "governance", label: "Governance" },
//                             { id: "operations", label: "Operations" },
//                             { id: "fundraising", label: "Fundraising" },
//                           ].map((option) => (
//                             <button
//                               key={option.id}
//                               type="button"
//                               onClick={() => {
//                                 setActiveFolderId(option.id);
//                                 setShowAllDocs(true);
//                               }}
//                               className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition ${
//                                 activeFolderId === option.id
//                                   ? "border-slate-900 bg-slate-900 text-white"
//                                   : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
//                               }`}
//                             >
//                               {option.label}
//                             </button>
//                           ))}
//                         </div>
//                       </div>
//                     </div>
//                   ) : null}
//                 </section>

//                 <div>
//                   <div className="flex items-center justify-between">
//                     <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
//                       Documents
//                     </h2>
//                     {activeFolderId === "all" &&
//                     !normalizedLeftFilter &&
//                     visibleDocs.length > RECENT_DOCS_DEFAULT_LIMIT ? (
//                       <button
//                         type="button"
//                         onClick={() => setShowAllDocs((current) => !current)}
//                         className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
//                       >
//                         {showAllDocs ? "Top 10" : "Show all"}
//                       </button>
//                     ) : null}
//                   </div>
//                   <p className="mt-1 text-[11px] text-slate-500">
//                     {showingRecentOnly
//                       ? `Showing top ${Math.min(RECENT_DOCS_DEFAULT_LIMIT, displayedDocs.length)} most recent uploads`
//                       : `Showing ${displayedDocs.length} matching document(s)`}
//                   </p>
//                   <div className="mt-3 max-h-[44vh] space-y-2 overflow-y-auto pr-1">
//                     {docsLoading ? (
//                       <ListSkeleton />
//                     ) : visibleDocs.length === 0 ? (
//                       <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
//                         No documents found.
//                       </p>
//                     ) : (
//                       displayedDocs.map((doc) => {
//                         const selected = doc.id === selectedDocId;
//                         return (
//                           <button
//                             key={doc.id}
//                             type="button"
//                             onClick={() => openDocument(doc.id)}
//                             className={`w-full cursor-pointer rounded-xl border px-3 py-2 text-left transition ${
//                               selected
//                                 ? "border-slate-900 bg-slate-900 text-white"
//                                 : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
//                             }`}
//                           >
//                             <p className="truncate text-sm font-medium">{doc.title}</p>
//                             <div className="mt-1 flex items-center justify-between gap-2">
//                               <span
//                                 className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
//                                   selected
//                                     ? "border-emerald-200/50 bg-emerald-400/20 text-emerald-100"
//                                     : "border-emerald-200 bg-emerald-50 text-emerald-700"
//                                 }`}
//                               >
//                                 {doc.textStatus}
//                               </span>
//                               <span
//                                 className={`text-[11px] ${selected ? "text-white/80" : "text-slate-500"}`}
//                               >
//                                 {formatDate(doc.updatedAt || doc.createdAt)}
//                               </span>
//                             </div>
//                           </button>
//                         );
//                       })
//                     )}
//                   </div>
//                 </div>
//               </div>
//             ) : (
//               <div className="mt-4 space-y-3">
//                 <div className="flex items-center justify-between gap-2">
//                   <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
//                     Chat History
//                   </h2>
//                   <button
//                     type="button"
//                     onClick={() => void loadChats()}
//                     className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
//                   >
//                     Refresh
//                   </button>
//                 </div>
//                 <button
//                   type="button"
//                   onClick={() => void handleNewChat()}
//                   className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
//                 >
//                   New chat
//                 </button>
//                 <div className="max-h-[64vh] space-y-2 overflow-y-auto pr-1">
//                   {chatsLoading ? (
//                     <ListSkeleton />
//                   ) : activeChats.length === 0 ? (
//                     <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
//                       No chats yet. Start a new chat.
//                     </p>
//                   ) : (
//                     activeChats.map((chat) => {
//                       const selected = activeChatId === chat.id;
//                       return (
//                         <button
//                           key={chat.id}
//                           type="button"
//                           onClick={() => {
//                             setActiveChatId(chat.id);
//                             switchToChatMode(chat.id);
//                           }}
//                           className={`w-full rounded-lg border px-3 py-2 text-left transition ${
//                             selected
//                               ? "border-slate-900 bg-slate-900 text-white"
//                               : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-100"
//                           }`}
//                         >
//                           <p className="truncate text-[13px] font-semibold">{chat.title}</p>
//                           <p className={`mt-1 text-[10px] ${selected ? "text-white/80" : "text-slate-500"}`}>
//                             Updated {formatDate(chat.updatedAt || chat.lastMessageAt || chat.createdAt)}
//                           </p>
//                         </button>
//                       );
//                     })
//                   )}
//                 </div>
//               </div>
//             )}
//               </>
//             )}
//           </aside>

//           <section
//             id="chat-main-content"
//             className="min-w-0 bg-slate-50 p-5 lg:order-2 lg:min-h-[100dvh]"
//           >
//             {workspaceMode === "documents" ? (
//               !selectedDocId ? (
//                 <div className="flex min-h-[68vh] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
//                   <div className="space-y-2">
//                     <p className="text-base font-semibold text-slate-900">Select a document to view it</p>
//                     <p className="text-sm text-slate-500">
//                       Choose a file from the right sidebar. Upload a file if your library is empty.
//                     </p>
//                   </div>
//                 </div>
//               ) : docLoading || docsLoading ? (
//                 <ViewerSkeleton />
//               ) : (
//                 <div className="space-y-4">
//                   <div>
//                     <h2 className="text-2xl font-bold text-slate-900">
//                       {selectedDoc?.title || selectedMeta?.title || "Untitled"}
//                     </h2>
//                     <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
//                       <button
//                         type="button"
//                         onClick={() => setStatusInfoOpen((prev) => !prev)}
//                         className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 transition hover:bg-emerald-100"
//                       >
//                         Status
//                       </button>
//                       <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
//                         Updated {formatDate(selectedDoc?.updatedAt || selectedMeta?.updatedAt || null)}
//                       </span>
//                       <button
//                         type="button"
//                         onClick={closeDocument}
//                         className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
//                       >
//                         Close document
//                       </button>
//                       <button
//                         type="button"
//                         onClick={() => void handleDownloadDocument(selectedDocId)}
//                         disabled={!canDownloadSelectedDoc || downloadingDocId === selectedDocId}
//                         className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
//                       >
//                         {downloadingDocId === selectedDocId ? "Downloading..." : "Download current"}
//                       </button>
//                     </div>
//                     {statusInfoOpen ? (
//                       <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
//                         <p>
//                           File type:{" "}
//                           <span className="font-semibold">
//                             {selectedDoc?.fileType || selectedMeta?.fileType || "application/octet-stream"}
//                           </span>
//                         </p>
//                         <p className="mt-1">
//                           Text index:{" "}
//                           <span className="font-semibold">
//                             {selectedDoc?.textStatus || selectedMeta?.textStatus || "pending"}
//                           </span>
//                         </p>
//                       </div>
//                     ) : null}
//                     {selectedDoc?.textWindow ? (
//                       <p className="mt-2 text-xs text-slate-500">
//                         Loaded {selectedDoc.textWindow.returnedChars.toLocaleString()} of{" "}
//                         {selectedDoc.textWindow.totalChars.toLocaleString()} characters
//                         {selectedDoc.textWindow.anchoredQuery
//                           ? ` (anchored to "${selectedDoc.textWindow.anchoredQuery}")`
//                           : ""}
//                       </p>
//                     ) : null}
//                   </div>

//                   <div className="min-h-[60vh] border border-slate-200 bg-white p-4">
//                     {paragraphs.length === 0 ? (
//                       <div className="flex h-full min-h-[48vh] items-center justify-center text-center">
//                         <div className="space-y-3">
//                           <p className="text-base font-semibold text-slate-800">Text not available yet</p>
//                           <p className="text-sm text-slate-500">
//                             This file has not been extracted yet, or extraction returned no readable text.
//                           </p>
//                         </div>
//                       </div>
//                     ) : effectiveHighlightQuery ? (
//                       <article className="space-y-4 text-[15px] leading-7 text-slate-700">
//                         {paragraphs.map((paragraph, idx) => {
//                           const regex = new RegExp(`(${escapeRegExp(effectiveHighlightQuery)})`, "ig");
//                           const parts = paragraph.split(regex);
//                           return (
//                             <p key={`${selectedDocId}-${idx}`} className="whitespace-pre-wrap">
//                               {parts.map((part, partIdx) => {
//                                 const isMatch = part.toLowerCase() === effectiveHighlightQuery.toLowerCase();
//                                 if (!isMatch) return <span key={`${idx}-${partIdx}`}>{part}</span>;
//                                 const attachFirstRef = !firstMatchAssigned;
//                                 if (attachFirstRef) firstMatchAssigned = true;
//                                 return (
//                                   <mark
//                                     key={`${idx}-${partIdx}`}
//                                     ref={attachFirstRef ? firstMatchRef : undefined}
//                                     className="rounded bg-amber-200 px-0.5 text-slate-900"
//                                   >
//                                     {part}
//                                   </mark>
//                                 );
//                               })}
//                             </p>
//                           );
//                         })}
//                       </article>
//                     ) : (
//                       <article className="space-y-4 text-[15px] leading-7 text-slate-700">
//                         {paragraphs.map((paragraph, idx) => (
//                           <p key={`${selectedDocId}-${idx}`} className="whitespace-pre-wrap">
//                             {paragraph}
//                           </p>
//                         ))}
//                       </article>
//                     )}

//                     {selectedDoc?.textWindow?.hasMore ? (
//                       <div className="mt-4 border-t border-slate-200 pt-4">
//                         <button
//                           type="button"
//                           onClick={() => void loadMoreExtractedText()}
//                           disabled={loadingMoreText}
//                           className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
//                         >
//                           {loadingMoreText ? "Loading more..." : "Load more text"}
//                         </button>
//                       </div>
//                     ) : null}
//                   </div>
//                 </div>
//               )
//             ) : (
//               <div className="flex min-h-[72vh] flex-col border border-slate-200 bg-white p-4 shadow-sm">
//                 <div
//                   ref={chatScrollRef}
//                   onScroll={onChatScroll}
//                   className="flex-1 space-y-6 overflow-y-auto px-2 pb-6"
//                 >
//                   {chatLoading ? (
//                     <ViewerSkeleton />
//                   ) : chatMessages.length === 0 ? (
//                     <div className="flex h-full min-h-[40vh] items-center justify-center border border-dashed border-slate-300 bg-slate-50/70 text-center">
//                       <div>
//                         <p className="text-base font-semibold text-slate-800">Start a grounded chat</p>
//                         <p className="mt-1 text-sm text-slate-500">
//                           Ask a question to retrieve org-scoped context from your document library.
//                         </p>
//                       </div>
//                     </div>
//                   ) : (
//                     chatMessages.map((chatMessage) => {
//                       if (chatMessage.role === "assistant") {
//                         return (
//                           <article
//                             key={chatMessage.id}
//                             className="border-b border-slate-200 pb-6"
//                           >
//                             <div className="min-w-0">
//                               <div className="flex items-center justify-between gap-3">
//                                 <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
//                                   Assistant
//                                 </p>
//                                 <div className="flex items-center gap-2">
//                                   <p className="text-xs text-slate-500">{formatDateTime(chatMessage.createdAt)}</p>
//                                   <button
//                                     type="button"
//                                     onClick={() => void copyAssistantMessage(chatMessage.id, chatMessage.content)}
//                                     className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
//                                   >
//                                     {copiedAssistantMessageId === chatMessage.id ? "Copied" : "Copy"}
//                                   </button>
//                                 </div>
//                               </div>
//                               <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
//                                 {chatMessage.content}
//                               </p>
//                               <div className="mt-3 space-y-1">
//                                 <button
//                                   type="button"
//                                   onClick={() => setSourcesModalMessageId(chatMessage.id)}
//                                   className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-slate-600 transition hover:border-slate-200 hover:bg-slate-100"
//                                 >
//                                   Response based on {chatMessage.citations.length} source
//                                   {chatMessage.citations.length === 1 ? "" : "s"}
//                                 </button>
//                                 {chatMessage.contextSummary ? (
//                                   <p className="text-xs text-slate-500">{chatMessage.contextSummary}</p>
//                                 ) : null}
//                               </div>
//                             </div>
//                           </article>
//                         );
//                       }

//                       const senderLabel = messageSenderLabel(chatMessage);

//                       return (
//                         <article key={chatMessage.id} className="border-b border-slate-200 pb-5">
//                             <div className="flex items-center justify-between gap-2">
//                               <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
//                                 {senderLabel}
//                               </p>
//                               <p className="text-xs text-slate-500">
//                                 {formatDateTime(chatMessage.createdAt)}
//                               </p>
//                             </div>
//                             <p className="mt-1 whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
//                               {chatMessage.content}
//                             </p>
//                         </article>
//                       );
//                     })
//                   )}
//                   {assistantTyping && !chatLoading ? (
//                     <div className="border-b border-slate-200 pb-5">
//                       <article className="inline-flex max-w-[75%] items-center px-1 text-sm text-slate-600">
//                         Assistant is typing
//                         <ThinkingDots />
//                       </article>
//                     </div>
//                   ) : null}
//                 </div>

//                 <form
//                   className="mt-3 space-y-2 border-t border-slate-200 bg-white pt-4"
//                   onSubmit={(event) => {
//                     event.preventDefault();
//                     void handleSendChatMessage();
//                   }}
//                 >
//                   <textarea
//                     value={chatInput}
//                     onChange={(event) => setChatInput(event.target.value)}
//                     rows={3}
//                     placeholder="Ask a question about your organization documents..."
//                     className="w-full border border-slate-300 bg-white px-3 py-2 text-sm"
//                   />
//                   <div className="flex items-center justify-between gap-3">
//                     <p className="text-xs text-slate-500">
//                       {chatInput.trim().length}/{CHAT_MESSAGE_MAX_LENGTH}
//                     </p>
//                     <button
//                       type="submit"
//                       disabled={chatSending || !chatInput.trim()}
//                       className="inline-flex cursor-pointer items-center rounded-full bg-sky-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
//                     >
//                       {chatSending ? (
//                         <>
//                           Thinking
//                           <ThinkingDots />
//                         </>
//                       ) : (
//                         "Send"
//                       )}
//                     </button>
//                   </div>
//                   {chatSending ? (
//                     <p className="inline-flex items-center text-xs font-medium text-slate-500">
//                       Thinking
//                       <ThinkingDots />
//                     </p>
//                   ) : null}
//                 </form>
//                 {chatError ? <p className="mt-2 text-sm text-rose-700">{chatError}</p> : null}
//               </div>
//             )}
//           </section>
//         </div>

//         {sourcesModalMessageId && activeSourcesMessage ? (
//           <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
//             <button
//               type="button"
//               className="absolute inset-0 bg-black/30 backdrop-blur-sm"
//               aria-label="Close sources"
//               onClick={() => setSourcesModalMessageId(null)}
//             />
//             <section className="auth-card relative w-full max-w-2xl p-6">
//               <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
//                 <div>
//                   <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
//                     Assistant Sources
//                   </p>
//                   <h3 className="mt-1 text-xl font-semibold text-slate-900">
//                     Response based on {activeSourcesMessage.citations.length} source
//                     {activeSourcesMessage.citations.length === 1 ? "" : "s"}
//                   </h3>
//                 </div>
//                 <button
//                   type="button"
//                   onClick={() => setSourcesModalMessageId(null)}
//                   className="btn-secondary px-3 py-1.5 text-sm"
//                 >
//                   Close
//                 </button>
//               </div>

//               {activeSourcesMessage.citations.length > 0 ? (
//                 <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
//                   {activeSourcesMessage.citations.map((citation, index) => {
//                     const citationKey = `${citation.docId}-${citation.chunkId ?? "none"}-${index}`;
//                     return (
//                       <button
//                         key={citationKey}
//                         type="button"
//                         onClick={() => {
//                           setSourcesModalMessageId(null);
//                           openCitationInDocument(citation);
//                         }}
//                         className="w-full border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-100"
//                       >
//                         <p className="truncate text-sm font-semibold text-slate-900">{citation.docTitle}</p>
//                         <p className="mt-0.5 truncate text-[11px] text-slate-500">
//                           Path: {citation.headingPath || citation.deepLink || "Document root"}
//                         </p>
//                         <p
//                           className="mt-1 text-xs leading-5 text-slate-600"
//                           style={{
//                             display: "-webkit-box",
//                             WebkitLineClamp: 2,
//                             WebkitBoxOrient: "vertical",
//                             overflow: "hidden",
//                           }}
//                         >
//                           {citationPreviewText(citation.snippet)}
//                         </p>
//                       </button>
//                     );
//                   })}
//                 </div>
//               ) : (
//                 <p className="mt-4 text-sm text-slate-600">
//                   No sources were attached to this response.
//                 </p>
//               )}
//             </section>
//           </div>
//         ) : null}
//       </div>
//     </main>
//   );
// }
