import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  CHAT_MESSAGE_DEFAULT_LIMIT,
  CHAT_MESSAGE_MAX_LIMIT,
  assertSafeChatId,
  chatMessagesCollection,
  chatRef,
  getChatAccess,
  serializeChatSnapshot,
  serializeMessageSnapshot,
} from "@/lib/server/chat";

export const runtime = "nodejs";

const CHAT_DETAIL_LIMIT_PER_5_MIN = 240;

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function loadSenderNameMap(orgId: string, uids: string[]) {
  const uniqueUids = Array.from(new Set(uids.filter(Boolean)));
  if (uniqueUids.length === 0) return {} as Record<string, string | null>;

  const orgRef = adminDb.collection("organizations").doc(orgId);
  const [memberSnaps, userSnaps] = await Promise.all([
    Promise.all(uniqueUids.map((senderUid) => orgRef.collection("members").doc(senderUid).get())),
    Promise.all(uniqueUids.map((senderUid) => adminDb.collection("users").doc(senderUid).get())),
  ]);

  return uniqueUids.reduce<Record<string, string | null>>((acc, senderUid, index) => {
    const memberData = memberSnaps[index].data() as { name?: unknown; email?: unknown } | undefined;
    const userData = userSnaps[index].data() as { name?: unknown } | undefined;
    const memberName = asNonEmptyString(memberData?.name);
    const userName = asNonEmptyString(userData?.name);
    const emailFallback = asNonEmptyString(memberData?.email);
    acc[senderUid] = memberName || userName || emailFallback || null;
    return acc;
  }, {});
}

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
    const chatAccess = getChatAccess(
      chatSnap.data() as Record<string, unknown> | undefined,
      uid,
    );
    if (!chatAccess.allowed) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const limit = normalizeMessageLimit(searchParams.get("limit"));
    const messagesSnap = await chatMessagesCollection(orgId, chatId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const senderIds = messagesSnap.docs
      .map((doc) => {
        const payload = doc.data() as { createdBy?: unknown; role?: unknown } | undefined;
        if (payload?.role !== "user") return null;
        return asNonEmptyString(payload?.createdBy);
      })
      .filter((value): value is string => Boolean(value));
    const senderNameMap = await loadSenderNameMap(orgId, senderIds);

    const messages = messagesSnap.docs
      .reverse()
      .map((doc) =>
        serializeMessageSnapshot(doc, {
          createdByNameByUid: senderNameMap,
        }),
      );

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
