import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  CHAT_VISIBILITY_DEFAULT,
  CHAT_LIST_DEFAULT_LIMIT,
  CHAT_LIST_MAX_LIMIT,
  getChatAccess,
  chatsCollection,
  normalizeChatTitle,
  serializeChatSnapshot,
} from "@/lib/server/chat";

export const runtime = "nodejs";

const CREATE_CHAT_LIMIT_PER_10_MIN = 60;
const LIST_CHAT_LIMIT_PER_5_MIN = 180;

type CreateChatBody = {
  title?: unknown;
  visibility?: unknown;
};

function normalizeLimit(raw: string | null) {
  if (!raw) return CHAT_LIST_DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return CHAT_LIST_DEFAULT_LIMIT;
  return Math.max(1, Math.min(CHAT_LIST_MAX_LIMIT, Math.floor(parsed)));
}

function parseRequestedVisibility(raw: string | null) {
  if (!raw) return "private";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "private") return "private";
  return null;
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
    const requestedVisibility = parseRequestedVisibility(searchParams.get("visibility"));
    if (!requestedVisibility) {
      return NextResponse.json(
        { error: "Only private chat visibility is supported." },
        { status: 400 },
      );
    }
    const scanLimit = Math.max(limit * 4, CHAT_LIST_MAX_LIMIT);
    const snap = await chatsCollection(orgId).orderBy("updatedAt", "desc").limit(scanLimit).get();
    const chats = snap.docs
      .map((doc) => {
        const serialized = serializeChatSnapshot(doc);
        const access = getChatAccess(doc.data() as Record<string, unknown> | undefined, uid);
        if (!access.allowed) return null;
        if (serialized.visibility !== requestedVisibility) return null;
        return serialized;
      })
      .filter((chat): chat is ReturnType<typeof serializeChatSnapshot> => Boolean(chat))
      .slice(0, limit);

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
    const requestedVisibility =
      typeof body?.visibility === "string" ? body.visibility.trim().toLowerCase() : "";
    if (requestedVisibility && requestedVisibility !== "private") {
      return NextResponse.json(
        { error: "Only private chat visibility is supported." },
        { status: 400 },
      );
    }
    const now = new Date();
    const title = normalizeChatTitle(body?.title, "New chat");
    const visibility = CHAT_VISIBILITY_DEFAULT;

    const ref = chatsCollection(orgId).doc();
    await ref.set({
      title,
      visibility,
      ownerUid: uid,
      ownerName: null,
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
