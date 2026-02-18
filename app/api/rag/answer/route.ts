import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { generateGroundedAnswer, isMissingMatchChunksFunctionError } from "@/lib/server/ragAnswer";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;
const RAG_ANSWER_LIMIT_PER_10_MIN = 120;
const RAG_ANSWER_IP_LIMIT_PER_10_MIN = 240;

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

export async function POST(req: Request) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const body = (await req.json().catch(() => ({}))) as AnswerBody;

    await enforceRateLimit({
      scope: "rag_answer_user",
      key: `${orgId}:${uid}`,
      limit: RAG_ANSWER_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "rag_answer_ip",
      key: getRequestIp(req),
      limit: RAG_ANSWER_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const query = parseQuery(body.query);
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const topK = normalizeTopK(body.topK);
    const response = await generateGroundedAnswer({
      orgId,
      query,
      topK,
    });

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

    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
