import { randomUUID } from "crypto";
import { embedTexts } from "@/lib/embeddings";
import { supabaseAdmin } from "@/lib/supabaseServer";

const EMBEDDING_BATCH_SIZE = 32;
const UPSERT_BATCH_SIZE = 100;

type ChunkForSync = {
  chunkId: string;
  ordinal: number;
  heading: string | null;
  text: string;
  charCount: number;
  tokenEstimate: number;
  startOffset: number;
  endOffset: number;
  chunkVersion: string;
};

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function syncChunksToSupabase(args: {
  orgId: string;
  docId: string;
  version: number;
  chunks: ChunkForSync[];
}) {
  const { orgId, docId, version, chunks } = args;

  const { error: deleteError } = await supabaseAdmin
    .from("document_chunks")
    .delete()
    .eq("org_id", orgId)
    .eq("doc_id", docId);

  if (deleteError) {
    const parts = [deleteError.message];
    if (deleteError.code) parts.push(`code=${deleteError.code}`);
    if (deleteError.hint) parts.push(`hint=${deleteError.hint}`);
    if (deleteError.details) parts.push(`details=${deleteError.details}`);
    throw new Error(`Failed deleting prior vector rows: ${parts.join(" | ")}`);
  }

  if (chunks.length === 0) return;

  const embeddingChunks = chunkArray(chunks, EMBEDDING_BATCH_SIZE);
  const rowsToInsert: Array<{
    id: string;
    org_id: string;
    doc_id: string;
    chunk_id: string;
    version: number;
    content: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }> = [];

  for (const group of embeddingChunks) {
    const vectors = await embedTexts(group.map((item) => item.text));
    group.forEach((chunk, index) => {
      rowsToInsert.push({
        id: randomUUID(),
        org_id: orgId,
        doc_id: docId,
        chunk_id: chunk.chunkId,
        version,
        content: chunk.text,
        embedding: vectors[index],
        metadata: {
          ordinal: chunk.ordinal,
          heading: chunk.heading,
          charCount: chunk.charCount,
          tokenEstimate: chunk.tokenEstimate,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          chunkVersion: chunk.chunkVersion,
        },
      });
    });
  }

  for (const batch of chunkArray(rowsToInsert, UPSERT_BATCH_SIZE)) {
    const { error: insertError } = await supabaseAdmin.from("document_chunks").insert(batch);
    if (insertError) {
      const parts = [insertError.message];
      if (insertError.code) parts.push(`code=${insertError.code}`);
      if (insertError.hint) parts.push(`hint=${insertError.hint}`);
      if (insertError.details) parts.push(`details=${insertError.details}`);
      throw new Error(`Failed inserting vector rows: ${parts.join(" | ")}`);
    }
  }
}
