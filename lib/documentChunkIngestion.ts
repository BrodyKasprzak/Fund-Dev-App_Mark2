import { adminDb } from "@/lib/firebaseAdmin";
import { buildDocumentChunks, CHUNKER_VERSION } from "@/lib/documentChunking";
import { syncChunksToSupabase } from "@/lib/rag/syncChunksToSupabase";

type IngestDocumentChunksInput = {
  orgId: string;
  docId: string;
  version: number;
  extractedText: string;
  actorUid: string;
};

export type IngestDocumentChunksResult = {
  chunkCount: number;
  totalChars: number;
  totalTokensEstimate: number;
  chunkVersion: string;
  version: number;
};

const FIRESTORE_BATCH_MAX_WRITES = 450;

function assertNonEmpty(value: string, field: string) {
  if (!value.trim()) throw new Error(`Invalid ${field}`);
}

async function deleteChunkDocsInBatches(
  docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[],
) {
  for (let i = 0; i < docs.length; i += FIRESTORE_BATCH_MAX_WRITES) {
    const batch = adminDb.batch();
    for (const snap of docs.slice(i, i + FIRESTORE_BATCH_MAX_WRITES)) {
      batch.delete(snap.ref);
    }
    await batch.commit();
  }
}

export type ChunkWritePayload = {
  chunkId: string;
  orgId: string;
  docId: string;
  version: number;
  ordinal: number;
  heading: string | null;
  text: string;
  charCount: number;
  tokenEstimate: number;
  startOffset: number;
  endOffset: number;
  chunkVersion: string;
};

async function writeChunksInBatches(args: {
  chunksRef: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
  chunks: ChunkWritePayload[];
  now: Date;
  actorUid: string;
}) {
  const { chunksRef, chunks, now, actorUid } = args;

  for (let i = 0; i < chunks.length; i += FIRESTORE_BATCH_MAX_WRITES) {
    const batch = adminDb.batch();
    for (const chunk of chunks.slice(i, i + FIRESTORE_BATCH_MAX_WRITES)) {
      batch.set(chunksRef.doc(chunk.chunkId), {
        ...chunk,
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      });
    }
    await batch.commit();
  }
}

export async function ingestDocumentChunks(
  input: IngestDocumentChunksInput,
): Promise<IngestDocumentChunksResult> {
  const { orgId, docId, version, extractedText, actorUid } = input;
  assertNonEmpty(orgId, "orgId");
  assertNonEmpty(docId, "docId");
  assertNonEmpty(actorUid, "actorUid");

  const normalizedVersion =
    Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
  const now = new Date();

  const docRef = adminDb
    .collection("organizations")
    .doc(orgId)
    .collection("documents")
    .doc(docId);
  const chunksRef = docRef.collection("chunks");

  const chunks = buildDocumentChunks({
    orgId,
    docId,
    version: normalizedVersion,
    extractedText,
  });

  const existing = await chunksRef.get();
  if (!existing.empty) {
    await deleteChunkDocsInBatches(existing.docs);
  }

  if (chunks.length > 0) {
    await writeChunksInBatches({
      chunksRef,
      chunks,
      now,
      actorUid,
    });
  }

  await syncChunksToSupabase({
    orgId,
    docId,
    version: normalizedVersion,
    chunks,
  });

  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  const totalTokensEstimate = chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);

  return {
    chunkCount: chunks.length,
    totalChars,
    totalTokensEstimate,
    chunkVersion: CHUNKER_VERSION,
    version: normalizedVersion,
  };
}
