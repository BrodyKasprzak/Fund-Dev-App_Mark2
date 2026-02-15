"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ref, uploadBytesResumable } from "firebase/storage";
import { useAuth } from "@/lib/AuthContext";
import { storage } from "@/lib/firebaseClient";
import type { RagAnswerResponse, RagCitation } from "@/lib/rag/types";

type DocStatus = "ready" | "processing" | "failed";
type TextStatus = "pending" | "processing" | "ready" | "failed";

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
    id: "collections",
    name: "Collections",
    note: "Mock structure for future folders",
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
  collections: () => true,
  ready: (doc) => doc.textStatus === "ready",
  processing: (doc) => doc.status === "processing" || doc.textStatus !== "ready",
  failed: (doc) => doc.status === "failed" || doc.textStatus === "failed",
  governance: (doc) =>
    /policy|govern|board|audit|compliance/i.test(`${doc.title} ${doc.fileType}`),
  operations: (doc) => /ops|operation|procedure|process|internal/i.test(doc.title),
  fundraising: (doc) => /fund|grant|donor|campaign|appeal/i.test(doc.title),
};

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

function textStatusClasses(status: TextStatus) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "failed") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "processing") return "bg-sky-50 text-sky-700 border-sky-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
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

const RAG_TOP_K = 8;
const RAG_SNIPPET_MAX_LENGTH = 200;

function normalizeRagCitations(value: unknown): RagCitation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const citation = item as {
        docId?: unknown;
        chunkId?: unknown;
        snippet?: unknown;
        similarity?: unknown;
      };
      if (typeof citation.docId !== "string" || typeof citation.chunkId !== "string") {
        return null;
      }

      return {
        docId: citation.docId,
        chunkId: citation.chunkId,
        snippet: typeof citation.snippet === "string" ? citation.snippet : "",
        similarity:
          typeof citation.similarity === "number" && Number.isFinite(citation.similarity)
            ? citation.similarity
            : 0,
      };
    })
    .filter((citation): citation is RagCitation => Boolean(citation));
}

function citationSnippet(snippet: string) {
  const trimmed = snippet.trim();
  if (trimmed.length <= RAG_SNIPPET_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, RAG_SNIPPET_MAX_LENGTH)}...`;
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
  const { user, loading, activeOrgId, authedFetch } = useAuth();

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
    status: true,
    collections: true,
  });
  const [detailAnchorQuery, setDetailAnchorQuery] = useState<string | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchSnippet, setSearchSnippet] = useState<string | null>(null);

  const [ragQuery, setRagQuery] = useState("");
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);
  const [ragAnswer, setRagAnswer] = useState<string | null>(null);
  const [ragCitations, setRagCitations] = useState<RagCitation[]>([]);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstMatchRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

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
      params.set("limit", "50000");
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
  }, [selectedDocId, user, fetchDocumentDetail, detailAnchorQuery]);

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

  const askRagQuestion = useCallback(
    async (query: string): Promise<RagAnswerResponse> => {
      if (!user) throw new Error("Not authenticated");
      if (!activeOrgId?.trim()) throw new Error("Missing active org context");

      const idToken = await user.getIdToken();
      const response = await fetch("/api/rag/answer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "x-org-id": activeOrgId.trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          topK: RAG_TOP_K,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string" ? data.error : "Failed to get assistant answer";
        throw new Error(message);
      }

      return {
        answer:
          typeof data?.answer === "string" && data.answer.trim().length > 0
            ? data.answer
            : "I don't know based on the provided context.",
        citations: normalizeRagCitations(data?.citations),
      };
    },
    [user, activeOrgId],
  );

  async function handleAskRag() {
    const query = ragQuery.trim();
    if (!query || ragLoading) return;

    setRagLoading(true);
    setRagError(null);

    try {
      const response = await askRagQuestion(query);
      setRagAnswer(response.answer);
      setRagCitations(response.citations);
    } catch (err: unknown) {
      setRagAnswer(null);
      setRagCitations([]);
      if (err instanceof Error) setRagError(err.message);
      else setRagError("Failed to get assistant answer");
    } finally {
      setRagLoading(false);
    }
  }

  const normalizedSearchQuery = searchQuery.trim();
  useEffect(() => {
    if (!user) return;
    if (!normalizedSearchQuery) {
      setSearchResults([]);
      setSearchSnippet(null);
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
  }, [normalizedSearchQuery, user, authedFetch]);

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

  useEffect(() => {
    if (!docLoading && selectedDocId && normalizedSearchQuery && firstMatchRef.current) {
      firstMatchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [docLoading, selectedDocId, extractedText, normalizedSearchQuery]);

  if (loading || docsLoading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
        <div className="mx-auto max-w-[1400px] space-y-4">
          <div className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)_320px]">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <ListSkeleton />
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <ViewerSkeleton />
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="space-y-3">
                {[...Array.from({ length: 4 })].map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  if (!user) return null;

  if (docs.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
        <div className="mx-auto max-w-4xl space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Upload New Document</h2>
            <p className="mt-1 text-sm text-slate-600">
              Start by uploading your first file. It will be indexed for workspace search.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">File</label>
                <input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setUploadFile(file);
                    setUploadTitle(file ? deriveTitle(file.name) : "");
                  }}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Title</label>
                <input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Document title"
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={!uploadFile || !uploadTitle.trim() || uploading}
                onClick={handleUpload}
                className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
            {uploadProgress !== null ? (
              <p className="mt-2 text-xs text-slate-500">Upload progress: {uploadProgress}%</p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-2xl font-bold text-slate-900">Document Workspace</h1>
            <p className="mt-2 text-sm text-slate-600">
              Your organization does not have any documents yet.
            </p>
            {message ? <p className="mt-3 text-sm text-amber-700">{message}</p> : null}
            {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          </section>
        </div>
      </main>
    );
  }

  let firstMatchAssigned = false;

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Document Workspace</h1>
              <p className="mt-1 text-sm text-slate-600">
                Upload, search across all documents, and open matched content instantly.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Active Org: <span className="font-semibold text-slate-800">{activeOrgId ?? "auto"}</span>
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          {message ? <p className="mt-3 text-sm text-amber-700">{message}</p> : null}
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Upload New File
              </label>
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setUploadFile(file);
                  setUploadTitle(file ? deriveTitle(file.name) : "");
                }}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Title</label>
              <input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Document title"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              disabled={!uploadFile || !uploadTitle.trim() || uploading}
              onClick={handleUpload}
              className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
          {uploadProgress !== null ? (
            <p className="mt-2 text-xs text-slate-500">Upload progress: {uploadProgress}%</p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Cross-Document Search</h2>
            <p className="text-xs text-slate-500">Searches title and extracted text across files</p>
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search across all documents..."
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          {normalizedSearchQuery ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">
                {searching
                  ? "Searching..."
                  : `Found ${searchResults.length} result(s) for "${normalizedSearchQuery}"`}
              </p>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => {
                      setSelectedDocId(result.id);
                      setDetailAnchorQuery(normalizedSearchQuery);
                      setSearchSnippet(result.match?.snippet || null);
                    }}
                    className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <p className="text-sm font-semibold text-slate-900">{result.title}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {result.match?.snippet || "Match found in this document. Open to view context."}
                    </p>
                  </button>
                ))}
                {!searching && searchResults.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">
                    No matches found.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)_320px]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Folders</h2>
            <ul className="mt-3 space-y-2">
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

            <div className="mt-6 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Documents</h2>
              <button
                type="button"
                onClick={() => void loadDocuments()}
                className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Showing {visibleDocs.length} of {docs.length} in{" "}
              <span className="font-medium text-slate-700">{activeFolderId}</span>
            </p>

            <input
              value={leftFilter}
              onChange={(e) => setLeftFilter(e.target.value)}
              placeholder="Filter docs"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />

            <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto pr-1 md:max-h-[65vh]">
              {visibleDocs.map((doc) => {
                const selected = doc.id === selectedDocId;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => {
                      setDetailAnchorQuery(null);
                      setSearchSnippet(null);
                      setSelectedDocId(doc.id);
                    }}
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
                          selected ? "border-white/40 bg-white/15 text-white" : textStatusClasses(doc.textStatus)
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
              })}
            </div>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {!selectedDocId ? (
              <div className="flex min-h-[60vh] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div>
                  <p className="text-base font-medium text-slate-800">Select a document to view it</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Choose a file from the left panel or search results.
                  </p>
                </div>
              </div>
            ) : docLoading ? (
              <ViewerSkeleton />
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    {selectedDoc?.title || selectedMeta?.title || "Untitled"}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                      {selectedDoc?.fileType || selectedMeta?.fileType || "application/octet-stream"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                      Updated {formatDate(selectedDoc?.updatedAt || selectedMeta?.updatedAt || null)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                      Text index {selectedDoc?.textStatus || selectedMeta?.textStatus || "pending"}
                    </span>
                  </div>
                  {searchSnippet ? (
                    <p className="mt-2 rounded-lg border border-slate-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Matching context: {searchSnippet}
                    </p>
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

                <div className="min-h-[60vh] rounded-xl border border-slate-200 bg-slate-50 p-4">
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
                          className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          {reindexing ? "Re-indexing..." : "Re-run extraction"}
                        </button>
                      </div>
                    </div>
                  ) : normalizedSearchQuery ? (
                    <article className="space-y-4 text-[15px] leading-7 text-slate-700">
                      {paragraphs.map((paragraph, idx) => {
                        const regex = new RegExp(`(${escapeRegExp(normalizedSearchQuery)})`, "ig");
                        const parts = paragraph.split(regex);
                        return (
                          <p key={`${selectedDocId}-${idx}`} className="whitespace-pre-wrap">
                            {parts.map((part, partIdx) => {
                              const isMatch =
                                part.toLowerCase() === normalizedSearchQuery.toLowerCase();
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
                        className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loadingMoreText ? "Loading more..." : "Load more text"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Assistant</h2>
            <p className="mt-1 text-sm text-slate-600">
              Ask organization-scoped questions grounded in indexed document chunks.
            </p>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAskRag();
              }}
            >
              <textarea
                value={ragQuery}
                onChange={(event) => setRagQuery(event.target.value)}
                placeholder="Ask a question about your organization documents..."
                rows={4}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={ragLoading || !ragQuery.trim()}
                className="w-full cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ragLoading ? "Thinking..." : "Ask"}
              </button>
            </form>

            {ragError ? <p className="mt-3 text-sm text-rose-700">{ragError}</p> : null}

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Answer</p>
              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                {ragAnswer || "Submit a question to get a grounded answer."}
              </div>

              <div className="mt-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Citations</p>
                <div className="mt-2 space-y-2">
                  {ragCitations.length > 0 ? (
                    ragCitations.map((citation, index) => (
                      <div
                        key={`${citation.docId}-${citation.chunkId}-${index}`}
                        className="rounded-lg border border-slate-200 bg-white p-3"
                      >
                        <p className="text-xs font-semibold text-slate-800">
                          docId: {citation.docId}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          Similarity: {citation.similarity.toFixed(4)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          chunkId: {citation.chunkId}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {citationSnippet(citation.snippet) || "(No snippet)"}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">
                      No citations yet.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Suggested Prompts</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  "What is our policy on volunteer onboarding?",
                  "Summarize our fundraising guidance.",
                  "Where do we define board approval requirements?",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setRagQuery(prompt)}
                    className="cursor-pointer rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 transition hover:bg-slate-100"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
