import { embedText } from "@/lib/embeddings";
import { adminDb } from "@/lib/firebaseAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";
import type { RagChunk } from "@/lib/rag/types";

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;

type MatchChunkRow = {
  id: string;
  content: string;
  doc_id: string;
  chunk_id: string;
  version: number;
  similarity: number;
};

type ChunkMetadataRow = {
  doc_id: string;
  chunk_id: string;
  version: number;
  metadata: unknown;
};

type SupabaseRpcError = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

type DocumentVersionRecord = {
  version?: unknown;
  currentVersionNumber?: unknown;
  status?: unknown;
  textStatus?: unknown;
  chunkStatus?: unknown;
};

function normalizeTopK(topK: number) {
  if (!Number.isFinite(topK)) return DEFAULT_TOP_K;
  return Math.max(1, Math.min(MAX_TOP_K, Math.floor(topK)));
}

function assertNonEmptyString(value: string, fieldName: string) {
  if (!value.trim()) {
    throw new Error(`Invalid ${fieldName}`);
  }
}

function metadataKey(docId: string, chunkId: string, version: number) {
  return `${docId}:${chunkId}:${version}`;
}

function normalizeVersion(value: unknown, fallback = 1) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function parseHeadingPath(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(raw)) {
    const parts = raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" > ");
  }
  return null;
}

function headingPathFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as {
    headingPath?: unknown;
    headings?: unknown;
    heading?: unknown;
  };
  return (
    parseHeadingPath(record.headingPath) ||
    parseHeadingPath(record.headings) ||
    parseHeadingPath(record.heading)
  );
}

async function loadChunkMetadata(orgId: string, rows: MatchChunkRow[]) {
  if (rows.length === 0) return new Map<string, string | null>();

  const uniqueDocIds = [...new Set(rows.map((row) => String(row.doc_id)))];
  const uniqueChunkIds = [...new Set(rows.map((row) => String(row.chunk_id)))];

  const { data, error } = await supabaseAdmin
    .from("document_chunks")
    .select("doc_id, chunk_id, version, metadata")
    .eq("org_id", orgId)
    .in("doc_id", uniqueDocIds)
    .in("chunk_id", uniqueChunkIds);

  if (error) {
    throw new Error(`Chunk metadata lookup failed: ${error.message}`);
  }

  const rowsWithMetadata = Array.isArray(data) ? (data as ChunkMetadataRow[]) : [];
  const metadataByKey = new Map<string, string | null>();
  for (const row of rowsWithMetadata) {
    const key = metadataKey(String(row.doc_id), String(row.chunk_id), Number(row.version) || 1);
    metadataByKey.set(key, headingPathFromMetadata(row.metadata));
  }

  return metadataByKey;
}

async function getOrgIndexedChunkCount(orgId: string) {
  const { count, error } = await supabaseAdmin
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Vector index count check failed: ${error.message}`);
  }

  return typeof count === "number" ? count : 0;
}

async function loadCurrentIndexedVersionByDocId(orgId: string, docIds: string[]) {
  const uniqueDocIds = [...new Set(docIds.filter((value) => value.trim().length > 0))];
  if (uniqueDocIds.length === 0) return new Map<string, number>();

  const refs = uniqueDocIds.map((docId) =>
    adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId),
  );
  const snaps = await adminDb.getAll(...refs);

  const versionByDocId = new Map<string, number>();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = (snap.data() ?? {}) as DocumentVersionRecord;
    const status = typeof data.status === "string" ? data.status : "processing";
    const textStatus = typeof data.textStatus === "string" ? data.textStatus : "pending";
    const chunkStatus = typeof data.chunkStatus === "string" ? data.chunkStatus : "pending";

    if (status !== "ready" || textStatus !== "ready" || chunkStatus !== "ready") {
      continue;
    }

    versionByDocId.set(
      snap.id,
      normalizeVersion(data.currentVersionNumber, normalizeVersion(data.version, 1)),
    );
  }

  return versionByDocId;
}

export async function retrieveChunks(
  orgId: string,
  query: string,
  topK: number,
): Promise<RagChunk[]> {
  assertNonEmptyString(orgId, "orgId");
  assertNonEmptyString(query, "query");

  const normalizedTopK = normalizeTopK(topK);
  const queryEmbedding = await embedText(query);

  const rpcInputs = [
    {
      query_embedding: queryEmbedding,
      match_count: normalizedTopK,
      org_id_input: orgId,
    },
    {
      query_embedding: queryEmbedding,
      match_count: normalizedTopK,
      org_id: orgId,
    },
  ];

  let data: unknown = null;
  let lastError: SupabaseRpcError | null = null;

  for (const input of rpcInputs) {
    const result = await supabaseAdmin.rpc("match_chunks", input);
    if (!result.error) {
      data = result.data;
      lastError = null;
      break;
    }
    lastError = result.error as SupabaseRpcError;
  }

  if (lastError) {
    const parts = [lastError.message];
    if (lastError.code) parts.push(`code=${lastError.code}`);
    if (lastError.hint) parts.push(`hint=${lastError.hint}`);
    if (lastError.details) parts.push(`details=${lastError.details}`);
    throw new Error(`Vector retrieval failed: ${parts.join(" | ")}`);
  }

  const rows = Array.isArray(data) ? (data as MatchChunkRow[]) : [];
  if (rows.length === 0) {
    const indexedCount = await getOrgIndexedChunkCount(orgId);
    if (indexedCount === 0) {
      throw new Error(
        "No vector-indexed chunks found for this organization. Re-run document extraction to sync chunks into Supabase.",
      );
    }
  }

  const currentVersionByDocId = await loadCurrentIndexedVersionByDocId(
    orgId,
    rows.map((row) => String(row.doc_id)),
  );
  const currentRows = rows.filter((row) => {
    const docId = String(row.doc_id);
    const activeVersion = currentVersionByDocId.get(docId);
    if (!activeVersion) return false;
    return normalizeVersion(row.version, 1) === activeVersion;
  });

  const headingPathByChunkKey = await loadChunkMetadata(orgId, currentRows);

  return currentRows
    .filter((row) => typeof row?.content === "string" && row.content.trim().length > 0)
    .map((row) => ({
      id: String(row.id),
      docId: String(row.doc_id),
      chunkId: String(row.chunk_id),
      version:
        typeof row.version === "number" && Number.isFinite(row.version)
          ? row.version
          : 1,
      content: row.content,
      similarity:
        typeof row.similarity === "number" && Number.isFinite(row.similarity)
          ? row.similarity
          : 0,
      headingPath:
        headingPathByChunkKey.get(
          metadataKey(String(row.doc_id), String(row.chunk_id), Number(row.version) || 1),
        ) ?? null,
    }));
}
