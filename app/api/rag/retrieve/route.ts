import { NextResponse } from "next/server";
import { errorToResponse, requireDocumentReadAccess } from "@/lib/serverAuth";
import { retrieveChunks } from "@/lib/rag/retrieveChunks";
import type { RagRetrieveResponse } from "@/lib/rag/types";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;
const RAG_RETRIEVE_LIMIT_PER_10_MIN = 120;
const RAG_RETRIEVE_IP_LIMIT_PER_10_MIN = 240;

type RetrieveBody = {
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
    const { orgId, uid, role } = await requireDocumentReadAccess(req);
    const body = (await req.json().catch(() => ({}))) as RetrieveBody;

    await enforceRateLimit({
      scope: "rag_retrieve_user",
      key: `${orgId}:${uid}`,
      limit: RAG_RETRIEVE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "rag_retrieve_ip",
      key: getRequestIp(req),
      limit: RAG_RETRIEVE_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const query = parseQuery(body.query);
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const topK = normalizeTopK(body.topK);
    const chunks = await retrieveChunks(orgId, query, topK, {
      viewer: { uid, role },
      requireRagEnabled: true,
    });

    const response: RagRetrieveResponse = {
      chunks,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }
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
