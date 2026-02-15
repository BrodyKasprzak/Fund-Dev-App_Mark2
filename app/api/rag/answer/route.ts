import { NextResponse } from "next/server";
import { openai } from "@/lib/ai/openai";
import { retrieveChunks } from "@/lib/rag/retrieveChunks";
import type { RagAnswerResponse, RagChunk, RagCitation } from "@/lib/rag/types";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;
const PROMPT_CHUNK_LIMIT = 6;
const PROMPT_CHAR_BUDGET = 10_000;
const CITATION_SNIPPET_LENGTH = 200;

type AnswerBody = {
  query?: unknown;
  topK?: unknown;
};

function normalizeTopK(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TOP_K;
  return Math.max(1, Math.min(MAX_TOP_K, Math.floor(parsed)));
}

function parseQuery(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePromptContext(chunks: RagChunk[]) {
  const selected: RagChunk[] = [];
  let usedChars = 0;

  for (const chunk of chunks) {
    if (selected.length >= PROMPT_CHUNK_LIMIT) break;
    const nextUsed = usedChars + chunk.content.length;
    if (selected.length > 0 && nextUsed > PROMPT_CHAR_BUDGET) break;
    selected.push(chunk);
    usedChars = nextUsed;
  }

  return selected;
}

function buildContextBlock(chunks: RagChunk[]) {
  return chunks
    .map((chunk, index) => {
      return [
        `[Chunk ${index + 1}]`,
        `docId: ${chunk.docId}`,
        `chunkId: ${chunk.chunkId}`,
        `similarity: ${chunk.similarity.toFixed(4)}`,
        `content: ${chunk.content}`,
      ].join("\n");
    })
    .join("\n\n");
}

function toCitation(chunk: RagChunk): RagCitation {
  return {
    docId: chunk.docId,
    chunkId: chunk.chunkId,
    snippet: chunk.content.slice(0, CITATION_SNIPPET_LENGTH),
    similarity: chunk.similarity,
  };
}

function parseAnswerText(output: unknown) {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    const text = output
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        if (!("type" in part) || !("text" in part)) return "";
        const typedPart = part as { type?: unknown; text?: unknown };
        return typedPart.type === "text" && typeof typedPart.text === "string"
          ? typedPart.text
          : "";
      })
      .join("")
      .trim();
    return text;
  }
  return "";
}

function isMissingMatchChunksFunctionError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return err.message.includes("code=PGRST202") && err.message.includes("match_chunks");
}

function isNoIndexedChunksError(err: unknown) {
  return (
    err instanceof Error &&
    err.message.includes("No vector-indexed chunks found for this organization")
  );
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireOrgContext(req);
    const body = (await req.json().catch(() => ({}))) as AnswerBody;

    const query = parseQuery(body.query);
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const topK = normalizeTopK(body.topK);
    const retrievedChunks = await retrieveChunks(orgId, query, topK);
    const promptChunks = sanitizePromptContext(retrievedChunks);
    const citations = promptChunks.map(toCitation);

    if (promptChunks.length === 0) {
      const emptyResponse: RagAnswerResponse = {
        answer: "I don't know based on the provided context.",
        citations: [],
      };
      return NextResponse.json(emptyResponse);
    }

    const contextBlock = buildContextBlock(promptChunks);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are an assistant for a nonprofit organization. Answer only using the provided context. If the answer is not present, say you don't know.",
        },
        {
          role: "user",
          content: `CONTEXT:\n${contextBlock}\n\nQUESTION:\n${query}`,
        },
      ],
    });

    const answer =
      parseAnswerText(completion.choices[0]?.message?.content) ||
      "I don't know based on the provided context.";

    const response: RagAnswerResponse = {
      answer,
      citations,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    if (isMissingMatchChunksFunctionError(err)) {
      return NextResponse.json(
        {
          error:
            "RAG is not initialized in Supabase. Run supabase/sql/rag_setup.sql, then re-run document extraction to index vectors.",
        },
        { status: 503 },
      );
    }
    if (isNoIndexedChunksError(err)) {
      return NextResponse.json(
        {
          error:
            "No indexed vectors found for this org yet. Re-run extraction on your documents to populate Supabase document_chunks.",
        },
        { status: 409 },
      );
    }

    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
