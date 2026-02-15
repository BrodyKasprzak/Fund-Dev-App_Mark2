import { openai } from "@/lib/ai/openai";

const EMBEDDING_MODEL = "text-embedding-3-small";

function normalizeEmbeddingInput(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("Text for embedding must be a non-empty string");
  }
  return normalized;
}

export async function embedText(text: string): Promise<number[]> {
  const input = normalizeEmbeddingInput(text);
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  const vector = response.data[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Failed to generate embedding");
  }

  return vector;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const input = texts.map((text) => normalizeEmbeddingInput(text));

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  const vectors = response.data.map((row) => row.embedding).filter(Array.isArray);
  if (vectors.length !== input.length) {
    throw new Error("Failed to generate embeddings for all chunks");
  }
  return vectors;
}
