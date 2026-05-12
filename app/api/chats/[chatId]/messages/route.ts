import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  assertSafeChatId,
  chatMessagesCollection,
  chatRef,
  getChatAccess,
  normalizeChatTitle,
  serializeMessageSnapshot,
} from "@/lib/server/chat";
import { generateGroundedAnswer, isMissingMatchChunksFunctionError } from "@/lib/server/ragAnswer";

export const runtime = "nodejs";

const CHAT_SEND_LIMIT_PER_10_MIN = 120;
const HISTORY_TURNS_LIMIT = 10;
const RAG_TOP_K = 8;

type AppendMessageBody = {
  content?: unknown;
};

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function resolveSenderName(orgId: string, uid: string, email: string | null) {
  const memberSnap = await adminDb
    .collection("organizations")
    .doc(orgId)
    .collection("members")
    .doc(uid)
    .get();
  const member = memberSnap.data() as { name?: unknown; email?: unknown } | undefined;
  const memberName = asNonEmptyString(member?.name);
  if (memberName) return memberName;

  const userSnap = await adminDb.collection("users").doc(uid).get();
  const user = userSnap.data() as { name?: unknown } | undefined;
  const userName = asNonEmptyString(user?.name);
  if (userName) return userName;

  return asNonEmptyString(member?.email) || asNonEmptyString(email) || null;
}

function parseMessage(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error(`Message exceeds max length (${CHAT_MESSAGE_MAX_LENGTH} chars).`);
  }
  return trimmed;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const { orgId, uid, email, role } = await requireOrgContext(req);
    const { chatId } = await context.params;

    if (!assertSafeChatId(chatId)) {
      return NextResponse.json({ error: "Invalid chatId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "chats_messages_user",
      key: `${orgId}:${uid}`,
      limit: CHAT_SEND_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "chats_messages_ip",
      key: getRequestIp(req),
      limit: CHAT_SEND_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const chatDocRef = chatRef(orgId, chatId);
    const chatSnap = await chatDocRef.get();
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

    const body = (await req.json().catch(() => ({}))) as AppendMessageBody;
    let userMessageContent: string;
    try {
      const parsed = parseMessage(body?.content);
      if (!parsed) {
        return NextResponse.json({ error: "content is required" }, { status: 400 });
      }
      userMessageContent = parsed;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid message";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const historySnap = await chatMessagesCollection(orgId, chatId)
      .orderBy("createdAt", "desc")
      .limit(HISTORY_TURNS_LIMIT)
      .get();
    const history = historySnap.docs
      .reverse()
      .map((doc) => {
        const payload = doc.data() as { role?: unknown; content?: unknown };
        const role = payload.role === "assistant" ? "assistant" : "user";
        const content = typeof payload.content === "string" ? payload.content.trim() : "";
        return content ? { role, content } : null;
      })
      .filter((item): item is { role: "user" | "assistant"; content: string } => Boolean(item));

    const now = new Date();
    const senderName = await resolveSenderName(orgId, uid, email);
    const userMessageRef = chatMessagesCollection(orgId, chatId).doc();
    await userMessageRef.set({
      role: "user",
      content: userMessageContent,
      createdAt: now,
      createdBy: uid,
      createdByName: senderName,
    });

    const rag = await generateGroundedAnswer({
      orgId,
      query: userMessageContent,
      topK: RAG_TOP_K,
      history: [...history, { role: "user", content: userMessageContent }],
      viewer: { uid, role },
    });

    const assistantMessageRef = chatMessagesCollection(orgId, chatId).doc();
    const assistantCreatedAt = new Date();
    await assistantMessageRef.set({
      role: "assistant",
      content: rag.answer,
      createdAt: assistantCreatedAt,
      createdBy: uid,
      createdByName: "Assistant",
      citations: rag.citations,
      supportLabel: rag.supportLabel,
      contextSummary: rag.contextSummary,
    });

    const existingTitle =
      typeof chatSnap.data()?.title === "string" ? String(chatSnap.data()?.title).trim() : "";
    const nextTitle =
      existingTitle && existingTitle !== "New chat"
        ? existingTitle
        : normalizeChatTitle(userMessageContent, "New chat");

    await chatDocRef.set(
      {
        title: nextTitle,
        updatedAt: assistantCreatedAt,
        updatedBy: uid,
        lastMessageAt: assistantCreatedAt,
      },
      { merge: true },
    );

    const [userSavedSnap, assistantSavedSnap] = await Promise.all([
      userMessageRef.get(),
      assistantMessageRef.get(),
    ]);

    return NextResponse.json({
      ok: true,
      userMessage: serializeMessageSnapshot(userSavedSnap),
      assistantMessage: serializeMessageSnapshot(assistantSavedSnap),
    });
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
