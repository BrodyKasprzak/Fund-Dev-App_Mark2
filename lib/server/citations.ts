import { adminDb } from "@/lib/firebaseAdmin";
import type { RagChunk, RagCitation } from "@/lib/rag/types";

const MAX_SNIPPET_LENGTH = 260;
const MAX_MORE_CONTEXT_BYTES = 1_600;
const CONTEXT_PARAGRAPH_RADIUS = 2;

type DocRecord = {
  title?: unknown;
  extractedText?: unknown;
};

type ResolvedDocMetadata = {
  title: string;
  extractedText: string | null;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function snippetFromContent(content: string) {
  const normalized = normalizeText(content);
  if (!normalized) return "";
  if (normalized.length <= MAX_SNIPPET_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_SNIPPET_LENGTH)}...`;
}

function capByBytes(value: string, maxBytes: number) {
  let output = value;
  while (Buffer.byteLength(output, "utf8") > maxBytes && output.length > 0) {
    output = output.slice(0, -1);
  }
  return output.trim();
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function chooseAnchorTerm(snippet: string, headingPath: string | null) {
  if (snippet.trim()) return snippet.trim().slice(0, 120).toLowerCase();
  if (headingPath?.trim()) return headingPath.trim().slice(0, 120).toLowerCase();
  return "";
}

function paragraphWindow(paragraphs: string[], index: number, radius: number) {
  const start = Math.max(0, index - radius);
  const end = Math.min(paragraphs.length - 1, index + radius);
  return paragraphs.slice(start, end + 1).join("\n\n");
}

function deriveMoreContext(args: {
  extractedText: string | null;
  chunkContent: string;
  snippet: string;
  headingPath: string | null;
}) {
  const { extractedText, chunkContent, snippet, headingPath } = args;
  const anchor = chooseAnchorTerm(snippet, headingPath);

  if (extractedText?.trim()) {
    const paragraphs = splitParagraphs(extractedText);
    if (paragraphs.length > 0) {
      const targetIdx = anchor
        ? paragraphs.findIndex((paragraph) => paragraph.toLowerCase().includes(anchor))
        : -1;
      const idx = targetIdx >= 0 ? targetIdx : 0;
      const candidate = paragraphWindow(paragraphs, idx, CONTEXT_PARAGRAPH_RADIUS);
      const capped = capByBytes(candidate, MAX_MORE_CONTEXT_BYTES);
      if (capped) return capped;
    }
  }

  const chunkParagraphs = splitParagraphs(chunkContent);
  const fallback = chunkParagraphs.slice(0, CONTEXT_PARAGRAPH_RADIUS * 2 + 1).join("\n\n");
  return capByBytes(fallback || snippet || "", MAX_MORE_CONTEXT_BYTES);
}

function headingPathFromChunk(chunk: RagChunk) {
  if (!chunk.headingPath || typeof chunk.headingPath !== "string") return null;
  const value = chunk.headingPath.trim();
  return value || null;
}

async function resolveDocMetadata(orgId: string, docIds: string[]) {
  const uniqueDocIds = [...new Set(docIds.map((docId) => docId.trim()).filter(Boolean))];
  if (uniqueDocIds.length === 0) {
    return new Map<string, ResolvedDocMetadata>();
  }

  const documentsRef = adminDb.collection("organizations").doc(orgId).collection("documents");
  const refs = uniqueDocIds.map((docId) => documentsRef.doc(docId));
  const snapshots = await adminDb.getAll(...refs);

  const metadata = new Map<string, ResolvedDocMetadata>();
  snapshots.forEach((snapshot, idx) => {
    const docId = uniqueDocIds[idx];
    if (!snapshot.exists) {
      metadata.set(docId, { title: "Untitled Document", extractedText: null });
      return;
    }
    const data = snapshot.data() as DocRecord | undefined;
    const title = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : "Untitled Document";
    const extractedText =
      typeof data?.extractedText === "string" && data.extractedText.trim()
        ? data.extractedText
        : null;
    metadata.set(docId, { title, extractedText });
  });

  return metadata;
}

export async function resolveDocTitles(orgId: string, docIds: string[]) {
  const metadata = await resolveDocMetadata(orgId, docIds);
  const output: Record<string, string> = {};
  for (const [docId, item] of metadata.entries()) {
    output[docId] = item.title;
  }
  return output;
}

export function citationDeepLink(docId: string, chunkId: string) {
  const params = new URLSearchParams({
    docId,
    highlight: chunkId,
  });
  return `/documents?${params.toString()}`;
}

export async function buildCitationsFromChunks(args: {
  orgId: string;
  chunks: RagChunk[];
  maxCitations: number;
}) {
  const { orgId, chunks, maxCitations } = args;
  const capped = chunks.slice(0, Math.max(0, maxCitations));
  if (capped.length === 0) return [] as RagCitation[];

  const docMetadata = await resolveDocMetadata(
    orgId,
    capped.map((chunk) => chunk.docId),
  );

  return capped.map((chunk) => {
    const snippet = snippetFromContent(chunk.content);
    const headingPath = headingPathFromChunk(chunk);
    const docMeta = docMetadata.get(chunk.docId);
    const moreContext = deriveMoreContext({
      extractedText: docMeta?.extractedText ?? null,
      chunkContent: chunk.content,
      snippet,
      headingPath,
    });

    return {
      docId: chunk.docId,
      docTitle: docMeta?.title ?? "Untitled Document",
      headingPath,
      chunkId: chunk.chunkId,
      snippet,
      moreContext,
      deepLink: citationDeepLink(chunk.docId, chunk.chunkId),
      similarity: chunk.similarity,
    } satisfies RagCitation;
  });
}
