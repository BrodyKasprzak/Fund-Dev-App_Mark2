import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  CHAT_LIST_DEFAULT_LIMIT,
  CHAT_LIST_MAX_LIMIT,
  chatsCollection,
  normalizeChatTitle,
  serializeChatSnapshot,
} from "@/lib/server/chat";

export const runtime = "nodejs";

const CREATE_CHAT_LIMIT_PER_10_MIN = 60;
const LIST_CHAT_LIMIT_PER_5_MIN = 180;

type CreateChatBody = {
  title?: unknown;
};

function normalizeLimit(raw: string | null) {
  if (!raw) return CHAT_LIST_DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return CHAT_LIST_DEFAULT_LIMIT;
  return Math.max(1, Math.min(CHAT_LIST_MAX_LIMIT, Math.floor(parsed)));
}

export async function GET(req: Request) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    await enforceRateLimit({
      scope: "chats_list_user",
      key: `${orgId}:${uid}`,
      limit: LIST_CHAT_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "chats_list_ip",
      key: getRequestIp(req),
      limit: LIST_CHAT_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const limit = normalizeLimit(searchParams.get("limit"));

    const snap = await chatsCollection(orgId).orderBy("updatedAt", "desc").limit(limit).get();
    const chats = snap.docs.map((doc) => serializeChatSnapshot(doc));

    return NextResponse.json({ ok: true, chats });
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

export async function POST(req: Request) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    await enforceRateLimit({
      scope: "chats_create_user",
      key: `${orgId}:${uid}`,
      limit: CREATE_CHAT_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "chats_create_ip",
      key: getRequestIp(req),
      limit: CREATE_CHAT_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = (await req.json().catch(() => ({}))) as CreateChatBody;
    const now = new Date();
    const title = normalizeChatTitle(body?.title, "New chat");

    const ref = chatsCollection(orgId).doc();
    await ref.set({
      title,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
      lastMessageAt: null,
      summary: null,
      summaryUpdatedAt: null,
    });

    const snap = await ref.get();
    return NextResponse.json({
      ok: true,
      chat: serializeChatSnapshot(snap),
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
