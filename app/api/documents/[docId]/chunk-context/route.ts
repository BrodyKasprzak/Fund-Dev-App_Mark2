import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const CHUNK_CONTEXT_LIMIT_PER_5_MIN = 240;
const MAX_CHUNK_ID_LENGTH = 160;
const MAX_DOC_ID_LENGTH = 128;
const MAX_HIGHLIGHT_TEXT_LENGTH = 200;

function normalizeAnchorQuery(text: string) {
  return text
    .replace(/^#\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function safeChunkId(value: string | null) {
  const chunkId = typeof value === "string" ? value.trim() : "";
  if (!chunkId) return null;
  if (chunkId.length > MAX_CHUNK_ID_LENGTH) return null;
  if (chunkId.includes("/") || chunkId.includes("\\")) return null;
  return chunkId;
}

function safeDocId(value: string) {
  const docId = value.trim();
  if (!docId) return null;
  if (docId.length > MAX_DOC_ID_LENGTH) return null;
  if (docId.includes("/") || docId.includes("\\")) return null;
  return docId;
}

function normalizeHighlightText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_HIGHLIGHT_TEXT_LENGTH);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ docId: string }> },
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { docId: rawDocId } = await context.params;
    const docId = safeDocId(rawDocId);
    if (!docId) {
      return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "documents_chunk_context_user",
      key: `${orgId}:${uid}`,
      limit: CHUNK_CONTEXT_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_chunk_context_ip",
      key: getRequestIp(req),
      limit: CHUNK_CONTEXT_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const chunkId = safeChunkId(searchParams.get("chunkId"));
    if (!chunkId) {
      return NextResponse.json({ error: "chunkId is required" }, { status: 400 });
    }

    const chunkRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("documents")
      .doc(docId)
      .collection("chunks")
      .doc(chunkId);
    const chunkSnap = await chunkRef.get();
    if (!chunkSnap.exists) {
      return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
    }

    const chunkData = chunkSnap.data() as {
      heading?: unknown;
      text?: unknown;
      startOffset?: unknown;
      endOffset?: unknown;
    };
    const heading = typeof chunkData?.heading === "string" ? chunkData.heading.trim() : "";
    const text = typeof chunkData?.text === "string" ? chunkData.text.trim() : "";
    const highlightText = normalizeHighlightText(text);
    const startOffset =
      typeof chunkData?.startOffset === "number" && Number.isFinite(chunkData.startOffset)
        ? Math.max(0, Math.floor(chunkData.startOffset))
        : null;
    const endOffset =
      typeof chunkData?.endOffset === "number" && Number.isFinite(chunkData.endOffset)
        ? Math.max(0, Math.floor(chunkData.endOffset))
        : null;
    const anchorQuery = normalizeAnchorQuery(heading || text);
    if (!anchorQuery) {
      return NextResponse.json({
        ok: true,
        anchorQuery: null,
        highlightText: highlightText || null,
        startOffset,
        endOffset,
      });
    }

    return NextResponse.json({
      ok: true,
      anchorQuery,
      highlightText: highlightText || null,
      startOffset,
      endOffset,
    });
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
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
