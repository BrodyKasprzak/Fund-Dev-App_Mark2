import { openai } from "@/lib/ai/openai";
import { retrieveChunks } from "@/lib/rag/retrieveChunks";
import type { RagAnswerResponse, RagChunk } from "@/lib/rag/types";
import { buildCitationsFromChunks } from "@/lib/server/citations";

const DEFAULT_TOP_K = 8;
const PROMPT_CHUNK_LIMIT = 6;
const PROMPT_CHAR_BUDGET = 10_000;
const MAX_CITATIONS = 6;

const NO_SOURCE_ANSWER =
  "I couldn't find supporting sources in your indexed organization documents. Upload documents or wait for extraction/indexing, then try again.";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

type GenerateGroundedAnswerArgs = {
  orgId: string;
  query: string;
  topK?: number;
  history?: ChatTurn[];
};

export function supportLabelForCitationCount(citationCount: number) {
  if (citationCount >= 3) return `Supported by ${citationCount} sources`;
  if (citationCount >= 1) return "Partial support";
  return "No supporting sources found";
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
      const lines = [
        `[Chunk ${index + 1}]`,
        `docId: ${chunk.docId}`,
        `chunkId: ${chunk.chunkId}`,
        `similarity: ${chunk.similarity.toFixed(4)}`,
      ];
      if (chunk.headingPath) {
        lines.push(`heading: ${chunk.headingPath}`);
      }
      lines.push(`content: ${chunk.content}`);
      return lines.join("\n");
    })
    .join("\n\n");
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

function compactHistory(history: ChatTurn[]) {
  const cleaned = history
    .map((turn) => ({
      role: turn.role,
      content: typeof turn.content === "string" ? turn.content.trim() : "",
    }))
    .filter((turn) => turn.content.length > 0);
  return cleaned.slice(-8);
}

function noSourceResponse(contextSummary: string | null = null): RagAnswerResponse {
  return {
    answer: NO_SOURCE_ANSWER,
    citations: [],
    supportLabel: supportLabelForCitationCount(0),
    contextSummary,
  };
}

function isNoIndexedChunksError(err: unknown) {
  return (
    err instanceof Error &&
    err.message.includes("No vector-indexed chunks found for this organization")
  );
}

export function isMissingMatchChunksFunctionError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return err.message.includes("code=PGRST202") && err.message.includes("match_chunks");
}

export async function generateGroundedAnswer(
  args: GenerateGroundedAnswerArgs,
): Promise<RagAnswerResponse> {
  const { orgId, query, topK = DEFAULT_TOP_K } = args;
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return noSourceResponse("Empty query");
  }

  let retrievedChunks: RagChunk[] = [];
  try {
    retrievedChunks = await retrieveChunks(orgId, normalizedQuery, topK);
  } catch (err: unknown) {
    if (isNoIndexedChunksError(err)) {
      return noSourceResponse("No indexed chunks available for this organization.");
    }
    throw err;
  }

  const promptChunks = sanitizePromptContext(retrievedChunks);
  if (promptChunks.length === 0) {
    return noSourceResponse("No relevant chunk context found.");
  }

  const citations = await buildCitationsFromChunks({
    orgId,
    chunks: promptChunks,
    maxCitations: MAX_CITATIONS,
  });

  if (citations.length === 0) {
    return noSourceResponse("Chunk retrieval succeeded without citation material.");
  }

  const contextBlock = buildContextBlock(promptChunks);
  const history = compactHistory(args.history ?? []);
  const historyMessages = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You are an assistant for a nonprofit organization. Use only the provided context chunks. If the answer is not in context, state that no supporting sources were found.",
      },
      ...historyMessages,
      {
        role: "user",
        content: `CONTEXT:\n${contextBlock}\n\nQUESTION:\n${normalizedQuery}`,
      },
    ],
  });

  const answer = parseAnswerText(completion.choices[0]?.message?.content) || NO_SOURCE_ANSWER;
  const sourceCount = citations.length;
  const uniqueDocCount = new Set(citations.map((citation) => citation.docId)).size;

  return {
    answer,
    citations,
    supportLabel: supportLabelForCitationCount(sourceCount),
    contextSummary: `Retrieved ${sourceCount} citation chunk(s) from ${uniqueDocCount} document(s).`,
  };
}
