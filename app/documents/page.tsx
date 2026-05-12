"use client";

import { type ChangeEvent, type DragEvent, type FormEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ref, uploadBytesResumable } from "firebase/storage";
import { useAuth } from "@/lib/AuthContext";
import { storage } from "@/lib/firebaseClient";
import type { RagCitation } from "@/lib/rag/types";
import { LexicalReadOnlyViewer } from "@/components/editor/LexicalReadOnlyViewer";
import { LEXICAL_EDITOR_FORMAT } from "@/lib/documents/versionMetadata";

type DocStatus = "ready" | "processing" | "failed";
type TextStatus = "pending" | "processing" | "ready" | "failed";
type ChatVisibility = "private";
type WorkspaceMode = "documents" | "chat-private";
type VersionLoadMode = "current" | "all";
type DocAccessMode = "org" | "restricted";

type DocPermissions = {
  accessMode: DocAccessMode;
  allowedMemberUids: string[];
  ragEnabled: boolean;
};

type OrgMemberOption = {
  uid: string;
  label: string;
  status: string;
};

type DocStatusPopoverState = {
  docId: string;
  x: number;
  y: number;
  docReady: boolean;
  aiImplemented: boolean;
} | null;

type DocumentListItem = {
  id: string;
  title: string;
  storagePath: string;
  fileType: string;
  size: number;
  folderId?: string | null;
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
  docPermissions: DocPermissions;
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

type UploadQueueStatus =
  | "queued"
  | "initializing"
  | "uploading"
  | "finalizing"
  | "extracting"
  | "completed"
  | "failed";

type UploadQueueItem = {
  id: string;
  fileName: string;
  title: string;
  size: number;
  status: UploadQueueStatus;
  progress: number | null;
  detail: string | null;
  error: string | null;
};

type DesktopFolderItem = {
  id: string;
  name: string;
  createdAt: string | null;
  createdAtMs: number;
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
const RECENT_DOCS_DEFAULT_LIMIT = 10;
const MAX_DOWNLOAD_FILENAME_LENGTH = 220;
const MAX_RICH_PREVIEW_PLAIN_TEXT_CHARS = 80_000;
const FILE_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const NETWORK_REQUEST_TIMEOUT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_RETRYABLE_REQUEST_RETRIES = 2;
const MAX_VISIBLE_UPLOAD_TOASTS = 5;
const DEFAULT_DOC_PERMISSIONS: DocPermissions = {
  accessMode: "org",
  allowedMemberUids: [],
  ragEnabled: true,
};

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

function normalizeFolderIdValue(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeDocAccessModeValue(value: unknown): DocAccessMode {
  if (typeof value === "string" && value.trim().toLowerCase() === "restricted") {
    return "restricted";
  }
  return "org";
}

function normalizeUidArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const uid = entry.trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    output.push(uid);
  }
  return output;
}

function normalizeDocPermissionsValue(value: unknown): DocPermissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_DOC_PERMISSIONS;
  }
  const record = value as {
    accessMode?: unknown;
    allowedMemberUids?: unknown;
    ragEnabled?: unknown;
  };
  const accessMode = normalizeDocAccessModeValue(record.accessMode);
  const allowedMemberUids =
    accessMode === "restricted" ? normalizeUidArray(record.allowedMemberUids) : [];
  return {
    accessMode,
    allowedMemberUids,
    ragEnabled: record.ragEnabled !== false,
  };
}

function parseSelectMultipleValues(event: ChangeEvent<HTMLSelectElement>) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
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

function formatFileTypeLabel(fileType: string) {
  const normalized = (fileType || "").trim().toLowerCase();
  if (!normalized) return "FILE";
  if (normalized.includes("/")) {
    const [, subtype = "file"] = normalized.split("/");
    return subtype.replace(/[+.-]/g, " ").trim().slice(0, 16).toUpperCase();
  }
  return normalized.replace(/[+.-]/g, " ").trim().slice(0, 16).toUpperCase();
}

function docStatusFlags(doc: DocumentListItem) {
  const docReady = doc.status === "ready" && doc.textStatus === "ready";
  const aiImplemented = doc.docPermissions?.ragEnabled === true && docReady;
  return { docReady, aiImplemented };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function documentSortTimestamp(doc: DocumentListItem) {
  return Date.parse(doc.updatedAt || doc.textUpdatedAt || doc.createdAt || "") || 0;
}

function parseRetryAfterMs(rawHeader: string | null) {
  if (!rawHeader) return null;
  const asNumber = Number(rawHeader);
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber * 1000;

  const asDate = Date.parse(rawHeader);
  if (Number.isFinite(asDate)) {
    const diff = asDate - Date.now();
    if (diff > 0) return diff;
  }
  return null;
}

function isRetryableHttpStatus(status: number) {
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

function createUploadQueueId(file: File, index: number) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${index}-${file.name}-${file.lastModified}`;
}

function fileIdentity(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function mergeUniqueFiles(currentFiles: File[], incomingFiles: File[]) {
  if (incomingFiles.length === 0) return currentFiles;
  const seen = new Set(currentFiles.map(fileIdentity));
  const merged = [...currentFiles];
  for (const incoming of incomingFiles) {
    const key = fileIdentity(incoming);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(incoming);
  }
  return merged;
}

function isTerminalUploadStatus(status: UploadQueueStatus) {
  return status === "completed" || status === "failed";
}

function uploadStatusLabel(status: UploadQueueStatus) {
  if (status === "queued") return "Queued";
  if (status === "initializing") return "Preparing";
  if (status === "uploading") return "Uploading";
  if (status === "finalizing") return "Finalizing";
  if (status === "extracting") return "Extracting";
  if (status === "completed") return "Done";
  return "Failed";
}

function uploadStatusClasses(status: UploadQueueStatus) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "uploading" || status === "extracting" || status === "finalizing") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
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

function DesktopFolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M2.75 6A1.75 1.75 0 0 1 4.5 4.25h3.25l1.25 1.5H15.5A1.75 1.75 0 0 1 17.25 7.5v6A2.25 2.25 0 0 1 15 15.75H5A2.25 2.25 0 0 1 2.75 13.5V6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M2.75 8h14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function DocumentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, authedFetch, me, activeOrgId, orgs } = useAuth();

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

  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [loadingMoreText, setLoadingMoreText] = useState(false);
  const [leftFilter, setLeftFilter] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [showAllDocs, setShowAllDocs] = useState(true);
  const [detailAnchorQuery, setDetailAnchorQuery] = useState<string | null>(null);
  const [detailOffset, setDetailOffset] = useState<number | null>(null);
  const [viewerHighlightQuery, setViewerHighlightQuery] = useState<string | null>(null);
  const [forceFormattedPreview, setForceFormattedPreview] = useState(false);
  const [statusInfoOpen, setStatusInfoOpen] = useState(false);

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadAccessMode, setUploadAccessMode] = useState<DocAccessMode>("org");
  const [uploadAllowedMemberUids, setUploadAllowedMemberUids] = useState<string[]>([]);
  const [uploadRagEnabled, setUploadRagEnabled] = useState(true);
  const [desktopFolders, setDesktopFolders] = useState<DesktopFolderItem[]>([]);
  const [desktopFoldersLoading, setDesktopFoldersLoading] = useState(false);
  const [activeDesktopFolderId, setActiveDesktopFolderId] = useState<string | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [movingDocId, setMovingDocId] = useState<string | null>(null);
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null>(null);
  const [rootDropTargetActive, setRootDropTargetActive] = useState(false);
  const [isMainDropzoneActive, setIsMainDropzoneActive] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [downloadAllConfirmOpen, setDownloadAllConfirmOpen] = useState(false);
  const [downloadingAllDocs, setDownloadingAllDocs] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);
  const [loadedVersionMode, setLoadedVersionMode] = useState<VersionLoadMode | null>(null);
  const [regeneratingVersion, setRegeneratingVersion] = useState<number | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMemberOption[]>([]);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);
  const [permissionsEditorDocId, setPermissionsEditorDocId] = useState<string | null>(null);
  const [permissionsEditorTitle, setPermissionsEditorTitle] = useState("Untitled");
  const [permissionsEditorAccessMode, setPermissionsEditorAccessMode] =
    useState<DocAccessMode>("org");
  const [permissionsEditorAllowedMemberUids, setPermissionsEditorAllowedMemberUids] = useState<string[]>([]);
  const [permissionsEditorRagEnabled, setPermissionsEditorRagEnabled] = useState(true);
  const [permissionsEditorSaving, setPermissionsEditorSaving] = useState(false);
  const [docStatusPopover, setDocStatusPopover] = useState<DocStatusPopoverState>(null);

  const [chatList, setChatList] = useState<ChatSummary[]>([]);
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
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const docStatusPopoverRef = useRef<HTMLDivElement | null>(null);
  const mainDropDepthRef = useRef(0);
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
  const activeOrgMembership = useMemo(
    () => orgs.find((org) => org.orgId === activeOrgId) ?? null,
    [activeOrgId, orgs],
  );
  const effectiveRole = (activeOrgMembership?.role ?? me?.role ?? "").trim().toLowerCase();
  const isAdmin = effectiveRole === "admin";

  const isChatMode = workspaceMode === "chat-private";
  const activeDesktopFolder = useMemo(
    () => desktopFolders.find((folder) => folder.id === activeDesktopFolderId) || null,
    [activeDesktopFolderId, desktopFolders],
  );
  const activeOrgMembers = useMemo(
    () => orgMembers.filter((member) => member.status === "active"),
    [orgMembers],
  );
  const activeOrgMemberUidSet = useMemo(
    () => new Set(activeOrgMembers.map((member) => member.uid)),
    [activeOrgMembers],
  );

  const effectiveHighlightQuery = (viewerHighlightQuery || "").trim();
  const normalizedLeftFilter = leftFilter.trim();
  const selectedUploadPreview = useMemo(() => uploadFiles.slice(0, 3), [uploadFiles]);
  const visibleUploadToasts = useMemo(
    () => uploadQueue.slice(-MAX_VISIBLE_UPLOAD_TOASTS),
    [uploadQueue],
  );
  const hasActiveUploadQueueItems = useMemo(
    () => uploadQueue.some((item) => !isTerminalUploadStatus(item.status)),
    [uploadQueue],
  );

  useEffect(() => {
    setUploadAllowedMemberUids((current) =>
      current.filter((uid) => activeOrgMemberUidSet.has(uid)),
    );
  }, [activeOrgMemberUidSet]);

  useEffect(() => {
    setPermissionsEditorAllowedMemberUids((current) =>
      current.filter((uid) => activeOrgMemberUidSet.has(uid)),
    );
  }, [activeOrgMemberUidSet]);

  useEffect(() => {
    if (uploadAccessMode !== "restricted" && uploadAllowedMemberUids.length > 0) {
      setUploadAllowedMemberUids([]);
    }
  }, [uploadAccessMode, uploadAllowedMemberUids.length]);

  useEffect(() => {
    if (
      permissionsEditorAccessMode !== "restricted" &&
      permissionsEditorAllowedMemberUids.length > 0
    ) {
      setPermissionsEditorAllowedMemberUids([]);
    }
  }, [permissionsEditorAccessMode, permissionsEditorAllowedMemberUids.length]);

  const visibleDocs = useMemo(() => {
    const q = normalizedLeftFilter.toLowerCase();
    const folderFilter = FOLDER_FILTERS[activeFolderId] || FOLDER_FILTERS.all;
    const filtered = docs.filter((doc) => {
      if (!folderFilter(doc)) return false;
      if (!q) return true;
      return doc.title.toLowerCase().includes(q);
    });
    return filtered.sort((a, b) => documentSortTimestamp(b) - documentSortTimestamp(a));
  }, [docs, normalizedLeftFilter, activeFolderId]);
  const showingRecentOnly = activeFolderId === "all" && !normalizedLeftFilter && !showAllDocs;
  const visibleDesktopItems = useMemo(() => {
    const q = normalizedLeftFilter.toLowerCase();
    const folderEntries =
      !activeDesktopFolderId && activeFolderId === "all"
        ? desktopFolders
            .filter((folder) => (!q ? true : folder.name.toLowerCase().includes(q)))
            .map((folder) => ({
              kind: "folder" as const,
              id: folder.id,
              sortTime: folder.createdAtMs,
              folder,
            }))
        : [];

    const documentEntries = visibleDocs.map((doc) => ({
      kind: "document" as const,
      id: doc.id,
      sortTime: documentSortTimestamp(doc),
      doc,
    }));

    return [...folderEntries, ...documentEntries].sort((a, b) => b.sortTime - a.sortTime);
  }, [activeDesktopFolderId, activeFolderId, desktopFolders, normalizedLeftFilter, visibleDocs]);
  const displayedDesktopItems = useMemo(
    () =>
      showingRecentOnly
        ? visibleDesktopItems.slice(0, RECENT_DOCS_DEFAULT_LIMIT)
        : visibleDesktopItems,
    [showingRecentOnly, visibleDesktopItems],
  );
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
  const richPreviewForcedByUser = richPreviewTooLarge && forceFormattedPreview;
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
    setForceFormattedPreview(false);
  }, [selectedDocId, selectedDocVersion]);

  useEffect(() => {
    setWorkspaceMode(requestedMode);
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

  const loadFolders = useCallback(async () => {
    if (!user) return;
    setDesktopFoldersLoading(true);
    try {
      const res = await authedFetch("/api/document-folders");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load folders");
      const folders = Array.isArray(data?.folders)
        ? (data.folders as Array<{ id?: unknown; name?: unknown; createdAt?: unknown }>)
            .map((item) => {
              const id = asOptionalString(item.id);
              const name = asOptionalString(item.name) || "Untitled Folder";
              const createdAt =
                typeof item.createdAt === "string" && item.createdAt.trim()
                  ? item.createdAt
                  : null;
              if (!id) return null;
              return {
                id,
                name,
                createdAt,
                createdAtMs: createdAt ? Date.parse(createdAt) || 0 : 0,
              } as DesktopFolderItem;
            })
            .filter((item): item is DesktopFolderItem => Boolean(item))
        : [];
      setDesktopFolders(folders);
      setActiveDesktopFolderId((current) =>
        current && folders.some((folder) => folder.id === current) ? current : null,
      );
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load folders");
    } finally {
      setDesktopFoldersLoading(false);
    }
  }, [authedFetch, user]);

  const loadOrgMembers = useCallback(async () => {
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
  }, [authedFetch, user]);

  const loadDocuments = useCallback(
    async (folderId: string | null) => {
      if (!user) return;
      setDocsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("folderId", folderId || "root");
        const res = await authedFetch(`/api/documents?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load documents");

        const documents = Array.isArray(data?.documents)
          ? (
              data.documents as Array<
                Omit<DocumentListItem, "docPermissions"> & {
                  folderId?: unknown;
                  docPermissions?: unknown;
                }
              >
            ).map((doc) => ({
              ...doc,
              folderId: normalizeFolderIdValue(doc.folderId),
              docPermissions: normalizeDocPermissionsValue(doc.docPermissions),
            }))
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
    },
    [authedFetch, user],
  );

  useEffect(() => {
    if (loading || !user) return;
    void loadFolders();
  }, [loadFolders, loading, user]);

  useEffect(() => {
    if (loading || !user) return;
    void loadOrgMembers();
  }, [loadOrgMembers, loading, user]);

  useEffect(() => {
    if (loading || !user) return;
    void loadDocuments(activeDesktopFolderId);
  }, [activeDesktopFolderId, loadDocuments, loading, user]);

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
      const doc = data?.document as
        | (Omit<DocumentDetail, "docPermissions"> & { docPermissions?: unknown })
        | undefined;
      if (!doc?.id) throw new Error("Invalid document response");
      return {
        ...doc,
        docPermissions: normalizeDocPermissionsValue(doc.docPermissions),
      } satisfies DocumentDetail;
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

  useEffect(() => {
    if (loading || !user || !deepLinkDocId) return;
    const key = `${deepLinkDocId}:${deepLinkHighlight ?? ""}`;
    if (handledDeepLinkRef.current === key) return;
    handledDeepLinkRef.current = key;
    const next = new URLSearchParams();
    if (deepLinkHighlight) next.set("highlight", deepLinkHighlight);
    const nextQuery = next.toString();
    router.replace(
      `/documents/${encodeURIComponent(deepLinkDocId)}/edit${nextQuery ? `?${nextQuery}` : ""}`,
    );
  }, [deepLinkDocId, deepLinkHighlight, loading, router, user]);

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

  useEffect(() => {
    if (!docStatusPopover) return;

    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && docStatusPopoverRef.current?.contains(target)) return;
      setDocStatusPopover(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDocStatusPopover(null);
      }
    }

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [docStatusPopover]);

  useEffect(() => {
    if (!newMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!newMenuRef.current) return;
      if (newMenuRef.current.contains(event.target as Node)) return;
      setNewMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [newMenuOpen]);

  useEffect(() => {
    if (!createFolderOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateFolderOpen(false);
        setNewFolderName("");
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createFolderOpen]);

  const addUploadFiles = useCallback((incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;
    setUploadFiles((current) => mergeUniqueFiles(current, incomingFiles));
  }, []);

  function openFilePickerFromNewMenu() {
    setNewMenuOpen(false);
    uploadFileInputRef.current?.click();
  }

  function openCreateFolderModal() {
    setNewMenuOpen(false);
    setError(null);
    setNewFolderName("");
    setCreateFolderOpen(true);
  }

  async function createDesktopFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      setError("Please enter a folder name.");
      return;
    }
    try {
      const res = await authedFetch("/api/document-folders", {
        method: "POST",
        body: JSON.stringify({ name: trimmedName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create folder");

      const created = data?.folder as { id?: unknown; name?: unknown; createdAt?: unknown } | undefined;
      const createdId = asOptionalString(created?.id);
      const createdName = asOptionalString(created?.name) || trimmedName;
      const createdAt =
        typeof created?.createdAt === "string" && created.createdAt.trim()
          ? created.createdAt
          : new Date().toISOString();
      if (!createdId) throw new Error("Invalid folder response");

      setDesktopFolders((current) =>
        [
          {
            id: createdId,
            name: createdName,
            createdAt,
            createdAtMs: Date.parse(createdAt) || Date.now(),
          },
          ...current.filter((folder) => folder.id !== createdId),
        ].sort((a, b) => b.createdAtMs - a.createdAtMs),
      );
      setCreateFolderOpen(false);
      setNewFolderName("");
      setError(null);
      setMessage(`Folder "${createdName}" created.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to create folder");
    }
  }

  function openDesktopFolder(folderId: string) {
    setNewMenuOpen(false);
    setActiveDesktopFolderId(folderId);
    setSelectedDocId(null);
    setSelectedDoc(null);
    setDetailOffset(null);
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);
    setStatusInfoOpen(false);
  }

  function returnToDesktopRoot() {
    setNewMenuOpen(false);
    setActiveDesktopFolderId(null);
    setSelectedDocId(null);
    setSelectedDoc(null);
    setDetailOffset(null);
    setDetailAnchorQuery(null);
    setViewerHighlightQuery(null);
    setStatusInfoOpen(false);
  }

  async function moveDocumentToFolder(docId: string, folderId: string | null) {
    if (!docId.trim()) return;
    setMovingDocId(docId);
    setFolderDropTargetId(null);
    setRootDropTargetActive(false);
    try {
      const res = await authedFetch(`/api/documents/${encodeURIComponent(docId)}/move`, {
        method: "POST",
        body: JSON.stringify({ folderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to move document");
      setMessage(folderId ? "Document moved to folder." : "Document moved to desktop.");
      await loadDocuments(activeDesktopFolderId);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to move document");
    } finally {
      setMovingDocId(null);
      setDraggingDocId(null);
    }
  }

  function handleDocumentDragStart(event: DragEvent<HTMLElement>, docId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/document-id", docId);
    setDraggingDocId(docId);
  }

  function handleDocumentDragEnd() {
    setDraggingDocId(null);
    setFolderDropTargetId(null);
    setRootDropTargetActive(false);
  }

  function handleFolderDragOver(event: DragEvent<HTMLElement>, folderId: string) {
    if (!draggingDocId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setFolderDropTargetId(folderId);
  }

  function handleFolderDragLeave(folderId: string) {
    setFolderDropTargetId((current) => (current === folderId ? null : current));
  }

  function handleFolderDrop(event: DragEvent<HTMLElement>, folderId: string) {
    event.preventDefault();
    event.stopPropagation();
    const droppedDocId = event.dataTransfer.getData("text/document-id") || draggingDocId;
    if (!droppedDocId) return;
    void moveDocumentToFolder(droppedDocId, folderId);
  }

  function handleRootDragOver(event: DragEvent<HTMLElement>) {
    if (!draggingDocId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setRootDropTargetActive(true);
  }

  function handleRootDragLeave() {
    setRootDropTargetActive(false);
  }

  function handleRootDrop(event: DragEvent<HTMLElement>) {
    if (!draggingDocId) return;
    event.preventDefault();
    event.stopPropagation();
    const droppedDocId = event.dataTransfer.getData("text/document-id") || draggingDocId;
    if (!droppedDocId) return;
    void moveDocumentToFolder(droppedDocId, null);
  }

  const isDraggingFiles = useCallback((event: DragEvent<HTMLElement>) => {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes("Files");
  }, []);

  const handleMainDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (workspaceMode !== "documents" || uploading) return;
      if (!isDraggingFiles(event)) return;
      event.preventDefault();
      mainDropDepthRef.current += 1;
      setIsMainDropzoneActive(true);
    },
    [isDraggingFiles, uploading, workspaceMode],
  );

  const handleMainDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (workspaceMode !== "documents" || uploading) return;
      if (!isDraggingFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsMainDropzoneActive(true);
    },
    [isDraggingFiles, uploading, workspaceMode],
  );

  const handleMainDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (workspaceMode !== "documents") return;
      if (!isDraggingFiles(event)) return;
      event.preventDefault();
      mainDropDepthRef.current = Math.max(0, mainDropDepthRef.current - 1);
      if (mainDropDepthRef.current === 0) setIsMainDropzoneActive(false);
    },
    [isDraggingFiles, workspaceMode],
  );

  const handleMainDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (workspaceMode !== "documents") return;
      if (!isDraggingFiles(event)) return;
      event.preventDefault();
      mainDropDepthRef.current = 0;
      setIsMainDropzoneActive(false);
      if (uploading) return;

      const droppedFiles = Array.from(event.dataTransfer.files ?? []);
      if (droppedFiles.length === 0) return;
      addUploadFiles(droppedFiles);
      setError(null);
      setMessage(
        `${droppedFiles.length} file${droppedFiles.length === 1 ? "" : "s"} added. Click Start Upload.`,
      );
    },
    [addUploadFiles, isDraggingFiles, uploading, workspaceMode],
  );

  useEffect(() => {
    if (workspaceMode === "documents" && !uploading) return;
    mainDropDepthRef.current = 0;
    setIsMainDropzoneActive(false);
  }, [uploading, workspaceMode]);

  const updateUploadQueueItem = useCallback(
    (
      id: string,
      patch: Partial<UploadQueueItem> | ((current: UploadQueueItem) => Partial<UploadQueueItem>),
    ) => {
      setUploadQueue((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          const resolvedPatch = typeof patch === "function" ? patch(item) : patch;
          return {
            ...item,
            ...resolvedPatch,
          };
        }),
      );
    },
    [],
  );

  const clearCompletedUploads = useCallback(() => {
    setUploadQueue((current) =>
      current.filter((item) => !isTerminalUploadStatus(item.status)),
    );
  }, []);

  const runAuthedRequestWithRetry = useCallback(
    async (args: {
      url: string;
      init?: RequestInit;
      deadlineAt: number;
      timeoutErrorMessage: string;
      onRetryWait?: (waitMs: number, reason: "rate_limit" | "transient") => void;
    }) => {
      const { url, init, deadlineAt, timeoutErrorMessage, onRetryWait } = args;
      let retryCount = 0;
      let rateLimitRetryCount = 0;

      while (true) {
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) throw new Error(timeoutErrorMessage);

        const controller = new AbortController();
        const requestTimeoutMs = Math.max(1, Math.min(NETWORK_REQUEST_TIMEOUT_MS, remainingMs));
        const requestTimeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);

        try {
          const response = await authedFetch(url, {
            ...(init || {}),
            signal: controller.signal,
          });

          if (response.status === 429 && rateLimitRetryCount < MAX_RATE_LIMIT_RETRIES) {
            const retryAfterMs =
              parseRetryAfterMs(response.headers.get("Retry-After")) ??
              Math.min(30_000, 1_000 * 2 ** (rateLimitRetryCount + 1));
            if (Date.now() + retryAfterMs < deadlineAt) {
              onRetryWait?.(retryAfterMs, "rate_limit");
              rateLimitRetryCount += 1;
              await sleep(retryAfterMs);
              continue;
            }
          }

          if (
            !response.ok &&
            isRetryableHttpStatus(response.status) &&
            retryCount < MAX_RETRYABLE_REQUEST_RETRIES
          ) {
            const waitMs = Math.min(10_000, 800 * 2 ** (retryCount + 1));
            if (Date.now() + waitMs < deadlineAt) {
              onRetryWait?.(waitMs, "transient");
              retryCount += 1;
              await sleep(waitMs);
              continue;
            }
          }

          return response;
        } catch (err: unknown) {
          const asError = err instanceof Error ? err : new Error("Network request failed");
          if (Date.now() >= deadlineAt) {
            throw new Error(timeoutErrorMessage);
          }
          if (retryCount < MAX_RETRYABLE_REQUEST_RETRIES) {
            const waitMs = Math.min(10_000, 800 * 2 ** (retryCount + 1));
            if (Date.now() + waitMs < deadlineAt) {
              onRetryWait?.(waitMs, "transient");
              retryCount += 1;
              await sleep(waitMs);
              continue;
            }
          }
          if (asError.name === "AbortError") {
            throw new Error(timeoutErrorMessage);
          }
          throw asError;
        } finally {
          window.clearTimeout(requestTimeoutId);
        }
      }
    },
    [authedFetch],
  );

  const uploadFileToStorageWithDeadline = useCallback(
    async (args: {
      file: File;
      storagePath: string;
      deadlineAt: number;
      onProgress?: (progress: number) => void;
      timeoutErrorMessage: string;
    }) => {
      const { file, storagePath, deadlineAt, onProgress, timeoutErrorMessage } = args;
      const storageRef = ref(storage, storagePath);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file, {
          contentType: file.type || undefined,
        });

        let settled = false;
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
          task.cancel();
          reject(new Error(timeoutErrorMessage));
          return;
        }

        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          task.cancel();
          reject(new Error(timeoutErrorMessage));
        }, remainingMs);

        task.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round(
              (snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1)) * 100,
            );
            onProgress?.(progress);
          },
          (uploadErr) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            reject(uploadErr);
          },
          () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            resolve();
          },
        );
      });
    },
    [],
  );

  async function handleUpload() {
    if (!user || uploading || uploadFiles.length === 0) return;

    const queuedUploads = uploadFiles.map((file, index) => {
      const id = createUploadQueueId(file, index);
      return {
        id,
        file,
        title: deriveTitle(file.name),
      };
    });

    setUploading(true);
    setError(null);
    setMessage(null);
    setUploadQueue(
      queuedUploads.map(({ id, file, title }) => ({
        id,
        fileName: file.name,
        title,
        size: file.size,
        status: "queued",
        progress: 0,
        detail: null,
        error: null,
      })),
    );

    let completedCount = 0;
    let failedCount = 0;
    const failedDetails: string[] = [];

    try {
      for (const queuedUpload of queuedUploads) {
        const { id, file, title } = queuedUpload;
        const deadlineAt = Date.now() + FILE_UPLOAD_TIMEOUT_MS;
        const timeoutErrorPrefix = `Timed out after 5 minutes while processing "${file.name}"`;
        let docId: string | null = null;
        let uploadFinalized = false;

        updateUploadQueueItem(id, {
          status: "initializing",
          progress: 0,
          detail: null,
          error: null,
        });

        try {
          const initRes = await runAuthedRequestWithRetry({
            url: "/api/documents/init-upload",
            init: {
              method: "POST",
              body: JSON.stringify({
                filename: file.name,
                title,
                fileType: file.type || "application/octet-stream",
                size: file.size,
                folderId: activeDesktopFolderId,
                docPermissions: {
                  accessMode: uploadAccessMode,
                  allowedMemberUids:
                    uploadAccessMode === "restricted" ? uploadAllowedMemberUids : [],
                  ragEnabled: uploadRagEnabled,
                },
              }),
            },
            deadlineAt,
            timeoutErrorMessage: `${timeoutErrorPrefix} (initialization).`,
            onRetryWait: (waitMs, reason) => {
              updateUploadQueueItem(id, {
                detail:
                  reason === "rate_limit"
                    ? `Rate limit hit. Retrying in ${Math.ceil(waitMs / 1000)}s...`
                    : `Temporary issue. Retrying in ${Math.ceil(waitMs / 1000)}s...`,
              });
            },
          });
          const initData = await initRes.json().catch(() => ({}));
          if (!initRes.ok) throw new Error(initData?.error || "Failed to initialize upload");

          docId = String(initData.docId || "");
          const storagePath = String(initData.storagePath || "");
          if (!docId || !storagePath) throw new Error("Invalid upload initialization response");

          updateUploadQueueItem(id, {
            status: "uploading",
            progress: 0,
            detail: null,
            error: null,
          });

          await uploadFileToStorageWithDeadline({
            file,
            storagePath,
            deadlineAt,
            timeoutErrorMessage: `${timeoutErrorPrefix} (upload).`,
            onProgress: (progress) => {
              updateUploadQueueItem(id, {
                status: "uploading",
                progress,
              });
            },
          });

          updateUploadQueueItem(id, {
            status: "finalizing",
            progress: 100,
            detail: null,
          });

          const finalizeRes = await runAuthedRequestWithRetry({
            url: `/api/documents/${docId}`,
            init: {
              method: "PATCH",
              body: JSON.stringify({
                status: "ready",
                title,
                fileType: file.type || "application/octet-stream",
                size: file.size,
              }),
            },
            deadlineAt,
            timeoutErrorMessage: `${timeoutErrorPrefix} (finalization).`,
            onRetryWait: (waitMs, reason) => {
              updateUploadQueueItem(id, {
                detail:
                  reason === "rate_limit"
                    ? `Rate limit hit. Retrying in ${Math.ceil(waitMs / 1000)}s...`
                    : `Temporary issue. Retrying in ${Math.ceil(waitMs / 1000)}s...`,
              });
            },
          });
          const finalizeData = await finalizeRes.json().catch(() => ({}));
          if (!finalizeRes.ok) throw new Error(finalizeData?.error || "Failed to finalize upload");
          uploadFinalized = true;

          updateUploadQueueItem(id, {
            status: "extracting",
            progress: 100,
            detail: null,
          });

          const extractRes = await runAuthedRequestWithRetry({
            url: `/api/documents/${docId}/extract-text`,
            init: { method: "POST" },
            deadlineAt,
            timeoutErrorMessage: `${timeoutErrorPrefix} (text extraction).`,
            onRetryWait: (waitMs, reason) => {
              updateUploadQueueItem(id, {
                detail:
                  reason === "rate_limit"
                    ? `Rate limit hit. Retrying in ${Math.ceil(waitMs / 1000)}s...`
                    : `Temporary issue. Retrying in ${Math.ceil(waitMs / 1000)}s...`,
              });
            },
          });
          const extractData = await extractRes.json().catch(() => ({}));
          if (!extractRes.ok) {
            throw new Error(
              extractData?.error ||
                "Upload completed, but text extraction failed. Please re-run extraction.",
            );
          }

          updateUploadQueueItem(id, {
            status: "completed",
            progress: 100,
            detail: null,
            error: null,
          });
          completedCount += 1;
        } catch (err: unknown) {
          if (docId && !uploadFinalized) {
            try {
              await runAuthedRequestWithRetry({
                url: `/api/documents/${docId}`,
                init: {
                  method: "PATCH",
                  body: JSON.stringify({ status: "failed" }),
                },
                deadlineAt: Date.now() + 30_000,
                timeoutErrorMessage: "Timed out while marking failed upload.",
              });
            } catch {
              // no-op
            }
          }

          const messageText =
            err instanceof Error && err.message ? err.message : "Upload failed";
          updateUploadQueueItem(id, {
            status: "failed",
            detail: null,
            error: messageText,
          });
          failedDetails.push(`${file.name}: ${messageText}`);
          failedCount += 1;
        }
      }

      await loadDocuments(activeDesktopFolderId);
      setUploadFiles([]);
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
      switchToDocumentsMode();

      if (completedCount > 0) {
        setMessage(
          failedCount > 0
            ? `${completedCount} documents uploaded. ${failedCount} failed.`
            : `${completedCount} documents uploaded successfully.`,
        );
      }
      if (failedCount > 0) {
        const preview = failedDetails.slice(0, 2).join(" | ");
        setError(
          failedCount > 2
            ? `${failedCount} uploads failed. ${preview} | ...`
            : `${failedCount} uploads failed. ${preview}`,
        );
      }
    } finally {
      setUploading(false);
    }
  }

  function closePermissionsEditor() {
    setPermissionsEditorDocId(null);
    setPermissionsEditorTitle("Untitled");
    setPermissionsEditorAccessMode("org");
    setPermissionsEditorAllowedMemberUids([]);
    setPermissionsEditorRagEnabled(true);
    setPermissionsEditorSaving(false);
  }

  function openPermissionsEditor(doc: DocumentListItem) {
    if (!isAdmin) return;
    setPermissionsEditorDocId(doc.id);
    setPermissionsEditorTitle(doc.title || "Untitled");
    setPermissionsEditorAccessMode(doc.docPermissions.accessMode);
    setPermissionsEditorAllowedMemberUids(doc.docPermissions.allowedMemberUids);
    setPermissionsEditorRagEnabled(doc.docPermissions.ragEnabled);
  }

  function openDocStatusPopover(args: {
    event: ReactMouseEvent<HTMLButtonElement>;
    doc: DocumentListItem;
  }) {
    const { event, doc } = args;
    event.preventDefault();
    event.stopPropagation();
    const { docReady, aiImplemented } = docStatusFlags(doc);
    setDocStatusPopover({
      docId: doc.id,
      x: event.clientX,
      y: event.clientY,
      docReady,
      aiImplemented,
    });
  }

  async function saveDocPermissions() {
    if (!permissionsEditorDocId || !isAdmin || permissionsEditorSaving) return;
    setPermissionsEditorSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        accessMode: permissionsEditorAccessMode,
        allowedMemberUids:
          permissionsEditorAccessMode === "restricted" ? permissionsEditorAllowedMemberUids : [],
        ragEnabled: permissionsEditorRagEnabled,
      };
      const res = await authedFetch(`/api/documents/${permissionsEditorDocId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update document permissions");
      const nextPermissions = normalizeDocPermissionsValue(data?.docPermissions);

      setDocs((current) =>
        current.map((doc) =>
          doc.id === permissionsEditorDocId ? { ...doc, docPermissions: nextPermissions } : doc,
        ),
      );
      setSelectedDoc((current) =>
        current && current.id === permissionsEditorDocId
          ? { ...current, docPermissions: nextPermissions }
          : current,
      );
      setMessage("Document permissions updated.");
      closePermissionsEditor();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to update document permissions");
      setPermissionsEditorSaving(false);
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

  async function handleDownloadAllDocuments() {
    setError(null);
    setMessage(null);
    setDownloadingAllDocs(true);
    try {
      const res = await authedFetch("/api/documents/download-all", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to download all documents");
      }

      const blob = await res.blob();
      const parsedFilename = parseFilenameFromContentDisposition(
        res.headers.get("Content-Disposition"),
      );
      const fallbackName = `documents-offboard-${new Date().toISOString().slice(0, 10)}.zip`;
      const filename = sanitizeDownloadFilename(parsedFilename || fallbackName);
      const objectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setMessage("Download all started.");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to download all documents");
    } finally {
      setDownloadingAllDocs(false);
      setDownloadAllConfirmOpen(false);
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

  function openDocument(docId: string, highlightChunkId?: string | null) {
    const cleanedDocId = docId.trim();
    if (!cleanedDocId) return;
    const next = new URLSearchParams();
    const chunkId = (highlightChunkId || "").trim();
    if (chunkId) next.set("highlight", chunkId);
    const nextQuery = next.toString();
    router.push(
      `/documents/${encodeURIComponent(cleanedDocId)}/edit${nextQuery ? `?${nextQuery}` : ""}`,
    );
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
    openDocument(citation.docId, citation.chunkId || null);
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
      <main className="workspace-page-fill workspace-page-no-top-gap min-h-screen bg-[#e3e8ee] [font-family:var(--font-geist-sans)]">
        <div className="w-full min-h-screen bg-[#e9eef3] p-3 sm:p-4">
          <div className="h-12 animate-pulse rounded-2xl border border-slate-200 bg-white/90" />
          <section className="mt-3 rounded-2xl border border-slate-200 bg-white/90 p-6">
            <ViewerSkeleton />
          </section>
        </div>
      </main>
    );
  }

  let firstMatchAssigned = false;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 720;
  const statusPopoverLeft = docStatusPopover
    ? Math.max(8, Math.min(docStatusPopover.x + 10, viewportWidth - 250))
    : 8;
  const statusPopoverTop = docStatusPopover
    ? Math.max(8, Math.min(docStatusPopover.y + 10, viewportHeight - 120))
    : 8;

  return (
    <main className="workspace-page-fill workspace-page-no-top-gap min-h-screen bg-[#e3e8ee] [font-family:var(--font-geist-sans)]">
      <a
        href="#documents-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900"
      >
        Skip to main content
      </a>
      <div className="w-full min-h-screen bg-[#e9eef3] pt-0">
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

        <div className="min-h-[100dvh]">
          <section
            id="documents-main-content"
            className={`relative min-w-0 bg-[#e9eef3] p-4 sm:p-5 lg:min-h-[100dvh] ${
              isMainDropzoneActive ? "ring-2 ring-inset ring-sky-400/80" : ""
            }`}
            onDragEnter={handleMainDragEnter}
            onDragOver={handleMainDragOver}
            onDragLeave={handleMainDragLeave}
            onDrop={handleMainDrop}
          >
            <input
              type="file"
              ref={uploadFileInputRef}
              multiple
              disabled={uploading}
              onChange={(event) => {
                const nextFiles = Array.from(event.target.files ?? []);
                addUploadFiles(nextFiles);
                if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
                setError(null);
                setMessage(
                  nextFiles.length > 0
                    ? `${nextFiles.length} file${nextFiles.length === 1 ? "" : "s"} added. Click Start Upload.`
                    : null,
                );
              }}
              className="sr-only"
              aria-label="Upload documents"
            />
            {workspaceMode === "documents" && isMainDropzoneActive ? (
              <div className="pointer-events-none absolute inset-5 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-sky-500 bg-sky-100/80">
                <p className="rounded-lg border border-sky-300 bg-white/80 px-4 py-2 text-sm font-semibold text-sky-800 shadow-sm">
                  Drop files here to add them for upload
                </p>
              </div>
            ) : null}
            {workspaceMode === "documents" ? (
              !selectedDocId ? (
                docsLoading ? (
                  <ViewerSkeleton />
                ) : (
                  <div className="min-h-[74vh]">
                    <div
                      className={`mb-2 inline-flex items-center gap-2 rounded-full px-2 py-1 ${
                        rootDropTargetActive ? "ring-2 ring-sky-400/80" : ""
                      }`}
                      onDragOver={handleRootDragOver}
                      onDragLeave={handleRootDragLeave}
                      onDrop={handleRootDrop}
                    >
                      <button
                        type="button"
                        onClick={returnToDesktopRoot}
                        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:text-slate-900"
                      >
                        Document Desktop
                      </button>
                      {activeDesktopFolder ? (
                        <>
                          <span className="text-[11px] font-semibold text-slate-400">/</span>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {activeDesktopFolder.name}
                          </span>
                        </>
                      ) : null}
                      {desktopFoldersLoading ? (
                        <span className="text-[10px] text-slate-500">Loading folders...</span>
                      ) : null}
                    </div>

                    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                      <div ref={newMenuRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setNewMenuOpen((current) => !current)}
                          className="inline-flex items-center rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 font-semibold text-white transition hover:bg-slate-700"
                          aria-expanded={newMenuOpen}
                          aria-haspopup="menu"
                        >
                          New +
                        </button>
                        {newMenuOpen ? (
                          <div
                            role="menu"
                            className="absolute left-0 top-full z-30 mt-1.5 min-w-[172px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_32px_rgba(15,23,42,0.14)]"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={openFilePickerFromNewMenu}
                              className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Upload documents
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={openCreateFolderModal}
                              className="block w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Create folder
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveFolderId("all");
                          setLeftFilter("");
                          setShowAllDocs(true);
                        }}
                        className="rounded-full border border-slate-400/80 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Most recent
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFolderId("all");
                          setLeftFilter("");
                          setShowAllDocs(false);
                        }}
                        className={`rounded-full border px-2.5 py-1 font-semibold transition ${
                          activeFolderId === "all" && !normalizedLeftFilter && !showAllDocs
                            ? "border-slate-500 bg-slate-700 text-white"
                            : "border-slate-400/80 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        Top 10
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFolderId("all");
                          setLeftFilter("");
                          setShowAllDocs(true);
                        }}
                        className={`rounded-full border px-2.5 py-1 font-semibold transition ${
                          activeFolderId === "all" && !normalizedLeftFilter && showAllDocs
                            ? "border-slate-500 bg-slate-700 text-white"
                            : "border-slate-400/80 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        Show all
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadDocuments(activeDesktopFolderId)}
                        className="rounded-full border border-slate-400/80 bg-white px-2.5 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => setDownloadAllConfirmOpen(true)}
                        disabled={downloadingAllDocs}
                        className="rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {downloadingAllDocs ? "Preparing..." : "Download all"}
                      </button>
                      {uploadFiles.length > 0 ? (
                        <button
                          type="button"
                          disabled={uploading}
                          onClick={() => void handleUpload()}
                          className="rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {uploading
                            ? `Uploading ${uploadFiles.length}...`
                            : `Start ${uploadFiles.length} upload${uploadFiles.length === 1 ? "" : "s"}`}
                        </button>
                      ) : null}
                      <input
                        value={leftFilter}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setLeftFilter(nextValue);
                          if (nextValue.trim()) setShowAllDocs(true);
                          else if (activeFolderId === "all") setShowAllDocs(true);
                        }}
                        placeholder="Search desktop..."
                        className="min-w-[170px] flex-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 sm:max-w-[280px]"
                      />
                      <select
                        value={activeFolderId}
                        onChange={(event) => {
                          const nextFilterId = event.target.value;
                          setActiveFolderId(nextFilterId);
                          if (nextFilterId !== "all") setShowAllDocs(true);
                          else if (!normalizedLeftFilter) setShowAllDocs(true);
                        }}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                        aria-label="Filter documents"
                      >
                        {Object.entries(FILTER_LABELS).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <span className="rounded-full border border-slate-300/90 bg-white/90 px-2.5 py-1 font-medium text-slate-700">
                        {showingRecentOnly
                          ? `Top ${Math.min(RECENT_DOCS_DEFAULT_LIMIT, displayedDesktopItems.length)}`
                          : `${displayedDesktopItems.length} shown`}
                      </span>
                    </div>
                    {uploadFiles.length > 0 ? (
                      <div className="mb-4 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-[11px] text-slate-600">
                        <p className="font-medium text-slate-700">
                          {uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} selected
                        </p>
                        <p className="mt-1 truncate">
                          {selectedUploadPreview.map((file) => file.name).join(", ")}
                        </p>
                        {uploadFiles.length > selectedUploadPreview.length ? (
                          <p className="mt-1 text-slate-500">
                            +{uploadFiles.length - selectedUploadPreview.length} more
                          </p>
                        ) : null}
                        <div className="mt-3 grid gap-2 border-t border-slate-200 pt-2 text-xs">
                          <p className="font-semibold text-slate-700">Doc permissions (new uploads)</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="font-medium text-slate-700">Who can open:</label>
                            <select
                              value={uploadAccessMode}
                              onChange={(event) =>
                                setUploadAccessMode(
                                  event.target.value === "restricted" ? "restricted" : "org",
                                )
                              }
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                            >
                              <option value="org">Everyone in org (default)</option>
                              <option value="restricted">Specific members</option>
                            </select>
                          </div>
                          {uploadAccessMode === "restricted" ? (
                            <div className="space-y-1">
                              <p className="text-[11px] text-slate-500">
                                Select active members who can view these uploaded documents.
                              </p>
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
                                <p className="text-[11px] text-slate-500">Loading members...</p>
                              ) : null}
                              {!orgMembersLoading && activeOrgMembers.length === 0 ? (
                                <p className="text-[11px] text-amber-700">
                                  No active members found; admins will still have access.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={uploadRagEnabled}
                              onChange={(event) => setUploadRagEnabled(event.target.checked)}
                              className="h-3.5 w-3.5 rounded border-slate-300"
                            />
                            Allow these uploaded docs in AI/RAG answers
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {visibleDesktopItems.length === 0 ? (
                      <div className="flex min-h-[62vh] items-center justify-center border border-dashed border-slate-400/70 bg-white/85 p-8 text-center">
                        <div className="space-y-2">
                          <p className="text-base font-semibold text-slate-900">No documents match this view</p>
                          <p className="text-sm text-slate-600">
                            Try changing the filter, add a folder, or upload a file.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
                        {displayedDesktopItems.map((item) => {
                          if (item.kind === "folder") {
                            return (
                              <button
                                key={`folder-${item.folder.id}`}
                                type="button"
                                onClick={() => openDesktopFolder(item.folder.id)}
                                onDragOver={(event) => handleFolderDragOver(event, item.folder.id)}
                                onDragLeave={() => handleFolderDragLeave(item.folder.id)}
                                onDrop={(event) => handleFolderDrop(event, item.folder.id)}
                                className={`group min-h-[136px] rounded-2xl border bg-gradient-to-br from-amber-50 to-yellow-50 p-3 text-left shadow-[0_10px_25px_rgba(15,23,42,0.09)] transition hover:border-amber-400 hover:shadow-[0_14px_30px_rgba(15,23,42,0.14)] sm:min-h-[150px] sm:p-4 ${
                                  folderDropTargetId === item.folder.id
                                    ? "border-sky-400 ring-2 ring-sky-300/90"
                                    : "border-amber-300/90"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-100 text-amber-700">
                                    <DesktopFolderIcon />
                                  </span>
                                  <span className="inline-flex rounded-full border border-amber-200 bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                    Folder
                                  </span>
                                </div>
                                <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
                                  {item.folder.name}
                                </p>
                                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                  <span className="truncate">
                                    Created {formatDate(item.folder.createdAt)}
                                  </span>
                                  <span className="truncate font-semibold text-amber-700">Desktop</span>
                                </div>
                              </button>
                            );
                          }

                          const doc = item.doc;
                          const { docReady } = docStatusFlags(doc);
                          const iconClassName = docReady
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700";
                          return (
                            <div
                              key={doc.id}
                              draggable={movingDocId !== doc.id}
                              onDragStart={(event) => handleDocumentDragStart(event, doc.id)}
                              onDragEnd={handleDocumentDragEnd}
                              className={`group relative min-h-[136px] rounded-2xl border border-slate-300/90 bg-white/95 p-3 text-left shadow-[0_10px_25px_rgba(15,23,42,0.09)] transition hover:border-slate-400 hover:shadow-[0_14px_30px_rgba(15,23,42,0.14)] sm:min-h-[150px] sm:p-4 ${
                                movingDocId === doc.id ? "opacity-70" : ""
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => openDocument(doc.id)}
                                disabled={movingDocId === doc.id}
                                className="absolute inset-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                                aria-label={`Open document ${doc.title}`}
                              />
                              <div className="relative z-10">
                                <div className="flex items-start justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={(event) => openDocStatusPopover({ event, doc })}
                                    className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition hover:ring-2 hover:ring-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${iconClassName}`}
                                    aria-label="Show document status"
                                  >
                                    <DocumentIcon />
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openDocument(doc.id)}
                                  disabled={movingDocId === doc.id}
                                  className="mt-3 w-full text-left"
                                >
                                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
                                    {doc.title}
                                  </p>
                                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                    <span className="truncate">{formatDate(doc.updatedAt || doc.createdAt)}</span>
                                    <span className="truncate font-semibold text-slate-600">
                                      {formatFileTypeLabel(doc.fileType)}
                                    </span>
                                  </div>
                                </button>
                              </div>
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => openPermissionsEditor(doc)}
                                  className="relative z-20 mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
                                >
                                  Doc permissions
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
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
                        <p className="mt-1">
                          Access:{" "}
                          <span className="font-semibold">
                            {(selectedDoc?.docPermissions || selectedMeta?.docPermissions || DEFAULT_DOC_PERMISSIONS)
                              .accessMode === "restricted"
                              ? "Specific members"
                              : "Everyone in org"}
                          </span>
                        </p>
                        <p className="mt-1">
                          AI/RAG:{" "}
                          <span className="font-semibold">
                            {(selectedDoc?.docPermissions || selectedMeta?.docPermissions || DEFAULT_DOC_PERMISSIONS)
                              .ragEnabled
                              ? "Allowed"
                              : "Not allowed"}
                          </span>
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
                    {richPreviewTooLarge ? (
                      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {richPreviewBlockedBySize ? (
                          <>
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
                          </>
                        ) : richPreviewForcedByUser ? (
                          <>
                            <p>
                              Formatted preview is enabled for this large document and may be slower.
                              Switch back to plain preview anytime.
                            </p>
                            <button
                              type="button"
                              onClick={() => setForceFormattedPreview(false)}
                              className="mt-2 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-200"
                            >
                              Switch to plain preview
                            </button>
                          </>
                        ) : null}
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
      {downloadAllConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_30px_60px_rgba(15,23,42,0.28)]">
            <p className="text-sm font-semibold text-slate-900">Download All Documents</p>
            <p className="mt-2 text-sm text-slate-600">
              This will download the newest versions of all documents and their appropriate folders.
              Are you sure you want to download?
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={downloadingAllDocs}
                onClick={() => setDownloadAllConfirmOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={downloadingAllDocs}
                onClick={() => void handleDownloadAllDocuments()}
                className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloadingAllDocs ? "Preparing..." : "Yes, download"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {createFolderOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <form
            onSubmit={createDesktopFolder}
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_30px_60px_rgba(15,23,42,0.28)]"
          >
            <p className="text-sm font-semibold text-slate-900">Create Folder</p>
            <p className="mt-1 text-xs text-slate-600">Choose a folder name for your document desktop.</p>
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="Folder name"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateFolderOpen(false);
                  setNewFolderName("");
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Create Folder
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {permissionsEditorDocId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_30px_60px_rgba(15,23,42,0.28)]">
            <p className="text-sm font-semibold text-slate-900">Doc permissions</p>
            <p className="mt-1 text-xs text-slate-600">{permissionsEditorTitle}</p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Who can open this doc
                </label>
                <select
                  value={permissionsEditorAccessMode}
                  onChange={(event) =>
                    setPermissionsEditorAccessMode(
                      event.target.value === "restricted" ? "restricted" : "org",
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  <option value="org">Everyone in org</option>
                  <option value="restricted">Specific members</option>
                </select>
              </div>
              {permissionsEditorAccessMode === "restricted" ? (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600">Select active members with doc access.</p>
                  <select
                    multiple
                    value={permissionsEditorAllowedMemberUids}
                    onChange={(event) =>
                      setPermissionsEditorAllowedMemberUids(parseSelectMultipleValues(event))
                    }
                    className="min-h-[120px] w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                  >
                    {activeOrgMembers.map((member) => (
                      <option key={member.uid} value={member.uid}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                  {orgMembersLoading ? (
                    <p className="text-xs text-slate-500">Loading members...</p>
                  ) : null}
                </div>
              ) : null}
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={permissionsEditorRagEnabled}
                  onChange={(event) => setPermissionsEditorRagEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Allow this doc in AI/RAG answers
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={permissionsEditorSaving}
                onClick={closePermissionsEditor}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={permissionsEditorSaving}
                onClick={() => void saveDocPermissions()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {permissionsEditorSaving ? "Saving..." : "Save permissions"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {docStatusPopover ? (
        <div
          ref={docStatusPopoverRef}
          className="fixed z-50 w-[240px] rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700 shadow-[0_18px_35px_rgba(15,23,42,0.20)]"
          style={{ left: statusPopoverLeft, top: statusPopoverTop }}
          role="status"
          aria-live="polite"
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                docStatusPopover.docReady ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-hidden="true"
            />
            Doc status: {docStatusPopover.docReady ? "Doc ready" : "Doc not ready"}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 font-semibold">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                docStatusPopover.aiImplemented ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-hidden="true"
            />
            Doc AI status: {docStatusPopover.aiImplemented ? "Implemented" : "Not implemented"}
          </p>
        </div>
      ) : null}
      {visibleUploadToasts.length > 0 ? (
        <aside className="pointer-events-none fixed bottom-4 right-4 z-50 w-[min(92vw,360px)] space-y-2">
          <div className="pointer-events-auto flex items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Uploads</p>
            {!hasActiveUploadQueueItems ? (
              <button
                type="button"
                onClick={clearCompletedUploads}
                className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Clear
              </button>
            ) : null}
          </div>
          {visibleUploadToasts
            .slice()
            .reverse()
            .map((uploadRow) => (
              <article
                key={uploadRow.id}
                className="pointer-events-auto rounded-xl border border-slate-300 bg-white p-3 shadow-lg"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-slate-800">
                    {uploadRow.title}
                  </p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${uploadStatusClasses(uploadRow.status)}`}
                  >
                    {uploadStatusLabel(uploadRow.status)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">{uploadRow.fileName}</p>
                {uploadRow.error ? (
                  <p className="mt-2 text-[11px] text-rose-700">{uploadRow.error}</p>
                ) : uploadRow.detail ? (
                  <p className="mt-2 text-[11px] text-slate-600">{uploadRow.detail}</p>
                ) : null}
                {uploadRow.progress !== null && uploadRow.status !== "failed" ? (
                  <div className="mt-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full transition-all ${
                          uploadRow.status === "completed" ? "bg-emerald-500" : "bg-sky-600"
                        }`}
                        style={{ width: `${Math.max(0, Math.min(uploadRow.progress, 100))}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right text-[10px] text-slate-500">
                      {Math.max(0, Math.min(uploadRow.progress, 100))}%
                    </p>
                  </div>
                ) : null}
              </article>
            ))}
        </aside>
      ) : null}
    </main>
  );
}
