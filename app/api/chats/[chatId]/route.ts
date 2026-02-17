import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  CHAT_MESSAGE_DEFAULT_LIMIT,
  CHAT_MESSAGE_MAX_LIMIT,
  assertSafeChatId,
  chatMessagesCollection,
  chatRef,
  serializeChatSnapshot,
  serializeMessageSnapshot,
} from "@/lib/server/chat";

export const runtime = "nodejs";

const CHAT_DETAIL_LIMIT_PER_5_MIN = 240;

function normalizeMessageLimit(raw: string | null) {
  if (!raw) return CHAT_MESSAGE_DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return CHAT_MESSAGE_DEFAULT_LIMIT;
  return Math.max(1, Math.min(CHAT_MESSAGE_MAX_LIMIT, Math.floor(parsed)));
}

export async function GET(
  req: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { chatId } = await context.params;

    if (!assertSafeChatId(chatId)) {
      return NextResponse.json({ error: "Invalid chatId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "chats_detail_user",
      key: `${orgId}:${uid}`,
      limit: CHAT_DETAIL_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "chats_detail_ip",
      key: getRequestIp(req),
      limit: CHAT_DETAIL_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const chatSnap = await chatRef(orgId, chatId).get();
    if (!chatSnap.exists) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const limit = normalizeMessageLimit(searchParams.get("limit"));
    const messagesSnap = await chatMessagesCollection(orgId, chatId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const messages = messagesSnap.docs.reverse().map((doc) => serializeMessageSnapshot(doc));

    return NextResponse.json({
      ok: true,
      chat: serializeChatSnapshot(chatSnap),
      messages,
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
