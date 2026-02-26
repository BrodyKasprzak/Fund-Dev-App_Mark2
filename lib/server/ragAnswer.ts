import { openai } from "@/lib/ai/openai";
import { adminDb } from "@/lib/firebaseAdmin";
import { retrieveChunks } from "@/lib/rag/retrieveChunks";
import type { RagAnswerResponse, RagChunk } from "@/lib/rag/types";
import { buildCitationsFromChunks } from "@/lib/server/citations";

const DEFAULT_TOP_K = 8;
const PROMPT_CHUNK_LIMIT = 6;
const PROMPT_CHAR_BUDGET = 10_000;
const MAX_CITATIONS = 6;

const NO_SOURCE_DISCLOSURE =
  "No supporting sources were found in your organization documents. The guidance below is general and not organization-specific.";
const LOW_SOURCE_DISCLOSURE =
  "Only limited supporting sources were found in your organization documents. I used available sources and supplemented with general guidance where needed.";
const GENERIC_FALLBACK =
  "I can share general nonprofit best-practice guidance, but this response is not based on your organization documents.";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

type OrgOnboardingContext = {
  organization_name: string | null;
  mission_statement: string | null;
  year_founded: number | null;
  num_employees: number | null;
};

type GenerateGroundedAnswerArgs = {
  orgId: string;
  query: string;
  topK?: number;
  history?: ChatTurn[];
};

export function supportLabelForCitationCount(citationCount: number) {
  if (citationCount >= 3) return `Supported by ${citationCount} sources`;
  if (citationCount >= 1) {
    return `Low source support (${citationCount} source${citationCount === 1 ? "" : "s"})`;
  }
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

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadOrgOnboardingContext(orgId: string): Promise<OrgOnboardingContext | null> {
  const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
  if (!orgSnap.exists) return null;
  const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
  return {
    organization_name: asNonEmptyString(org.name),
    mission_statement: asNonEmptyString(org.mission),
    year_founded: asFiniteNumber(org.foundedYear),
    num_employees: asFiniteNumber(org.numEmployees),
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

function sourceStatusForCitationCount(citationCount: number) {
  if (citationCount >= 3) return "strong";
  if (citationCount >= 1) return "low";
  return "none";
}

function fallbackAnswerForSourceStatus(sourceStatus: "strong" | "low" | "none") {
  if (sourceStatus === "none") {
    return `${NO_SOURCE_DISCLOSURE}\n\n${GENERIC_FALLBACK}`;
  }
  if (sourceStatus === "low") {
    return `${LOW_SOURCE_DISCLOSURE}\n\n${GENERIC_FALLBACK}`;
  }
  return GENERIC_FALLBACK;
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
    answer: `${NO_SOURCE_DISCLOSURE}\n\n${GENERIC_FALLBACK}`,
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
  let retrievalIssue: string | null = null;
  try {
    retrievedChunks = await retrieveChunks(orgId, normalizedQuery, topK);
  } catch (err: unknown) {
    if (isNoIndexedChunksError(err)) {
      retrievalIssue = "No indexed chunks available for this organization.";
      retrievedChunks = [];
    } else {
      throw err;
    }
  }

  const promptChunks = sanitizePromptContext(retrievedChunks);
  let citations = [] as RagAnswerResponse["citations"];
  if (promptChunks.length > 0) {
    citations = await buildCitationsFromChunks({
      orgId,
      chunks: promptChunks,
      maxCitations: MAX_CITATIONS,
    });
  }

  const contextBlock =
    promptChunks.length > 0 ? buildContextBlock(promptChunks) : "(none)";
  const orgOnboarding = await loadOrgOnboardingContext(orgId);
  const history = compactHistory(args.history ?? []);
  const historyMessages = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
  const sourceCount = citations.length;
  const sourceStatus = sourceStatusForCitationCount(sourceCount);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          [
            "You are an assistant for a nonprofit organization.",
            "Prioritize organization-specific context from CONTEXT chunks and ORG_ONBOARDING when available.",
            "If support is limited or absent, still answer helpfully using general nonprofit/fundraising best practices.",
            "Never invent organization-specific facts.",
            "Disclosure rule:",
            "- If SOURCE_STATUS is 'none', start with: " +
              `"${NO_SOURCE_DISCLOSURE}"`,
            "- If SOURCE_STATUS is 'low', start with: " +
              `"${LOW_SOURCE_DISCLOSURE}"`,
            "- If SOURCE_STATUS is 'strong', do not add a source disclaimer.",
            "Keep the answer concise, practical, and directly responsive.",
          ].join("\n"),
      },
      ...historyMessages,
      {
        role: "user",
        content: `ORG_ONBOARDING:\n${JSON.stringify(
          orgOnboarding ?? {
            organization_name: null,
            mission_statement: null,
            year_founded: null,
            num_employees: null,
          },
          null,
          2,
        )}\n\nSOURCE_STATUS: ${sourceStatus}\nSOURCE_CITATION_COUNT: ${sourceCount}\n\nCONTEXT:\n${contextBlock}\n\nQUESTION:\n${normalizedQuery}`,
      },
    ],
  });

  const answer =
    parseAnswerText(completion.choices[0]?.message?.content) ||
    fallbackAnswerForSourceStatus(sourceStatus);
  const uniqueDocCount = new Set(citations.map((citation) => citation.docId)).size;
  const contextSummaryParts = [
    `Retrieved ${promptChunks.length} chunk(s) and ${sourceCount} citation(s) from ${uniqueDocCount} document(s).`,
  ];
  if (sourceStatus === "low") {
    contextSummaryParts.push("Limited source support, so response includes general guidance.");
  } else if (sourceStatus === "none") {
    contextSummaryParts.push("No supporting sources found, so response is general guidance.");
  }
  if (retrievalIssue) {
    contextSummaryParts.push(retrievalIssue);
  }

  return {
    answer,
    citations,
    supportLabel: supportLabelForCitationCount(sourceCount),
    contextSummary: contextSummaryParts.join(" "),
  };
}
