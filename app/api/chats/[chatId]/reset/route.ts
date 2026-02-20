import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  assertSafeChatId,
  chatRef,
  chatsCollection,
  getChatAccess,
  serializeChatSnapshot,
} from "@/lib/server/chat";

export const runtime = "nodejs";

const CHAT_RESET_LIMIT_PER_10_MIN = 40;

export async function POST(
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
      scope: "chats_reset_user",
      key: `${orgId}:${uid}`,
      limit: CHAT_RESET_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "chats_reset_ip",
      key: getRequestIp(req),
      limit: CHAT_RESET_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const existingRef = chatRef(orgId, chatId);
    const existingSnap = await existingRef.get();
    if (!existingSnap.exists) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    const existingData = existingSnap.data() as Record<string, unknown> | undefined;
    const chatAccess = getChatAccess(existingData, uid);
    if (!chatAccess.allowed) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const now = new Date();
    await existingRef.set(
      {
        summary: null,
        summaryUpdatedAt: now,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    const nextChatRef = chatsCollection(orgId).doc();
    const ownerName =
      typeof existingData?.ownerName === "string" && existingData.ownerName.trim()
        ? existingData.ownerName.trim()
        : null;
    await nextChatRef.set({
      title: "New chat",
      visibility: "private",
      ownerUid: uid,
      ownerName,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
      lastMessageAt: null,
      summary: null,
      summaryUpdatedAt: null,
    });

    const nextChatSnap = await nextChatRef.get();
    return NextResponse.json({
      ok: true,
      chat: serializeChatSnapshot(nextChatSnap),
      previousChatId: chatId,
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
