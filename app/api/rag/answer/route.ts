import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { generateGroundedAnswer, isMissingMatchChunksFunctionError } from "@/lib/server/ragAnswer";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;

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
    const { orgId } = await requireOrgContext(req);
    const body = (await req.json().catch(() => ({}))) as AnswerBody;

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
