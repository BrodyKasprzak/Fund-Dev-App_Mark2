import { adminDb } from "@/lib/firebaseAdmin";
import type { RagCitation } from "@/lib/rag/types";

export const CHAT_TITLE_MAX_LENGTH = 140;
export const CHAT_MESSAGE_MAX_LENGTH = 4_000;
export const CHAT_LIST_DEFAULT_LIMIT = 25;
export const CHAT_LIST_MAX_LIMIT = 50;
export const CHAT_MESSAGE_DEFAULT_LIMIT = 30;
export const CHAT_MESSAGE_MAX_LIMIT = 80;
export const CHAT_VISIBILITY_DEFAULT = "private";

export type ChatVisibility = "private";

type FirestoreDateLike =
  | Date
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

type ChatRecord = {
  title?: unknown;
  createdAt?: FirestoreDateLike;
  createdBy?: unknown;
  visibility?: unknown;
  ownerUid?: unknown;
  ownerName?: unknown;
  updatedAt?: FirestoreDateLike;
  updatedBy?: unknown;
  lastMessageAt?: FirestoreDateLike;
  summary?: unknown;
  summaryUpdatedAt?: FirestoreDateLike;
};

type ChatMessageRecord = {
  role?: unknown;
  content?: unknown;
  createdAt?: FirestoreDateLike;
  createdBy?: unknown;
  createdByName?: unknown;
  citations?: unknown;
  supportLabel?: unknown;
  contextSummary?: unknown;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function toIso(value: FirestoreDateLike) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

export function normalizeChatTitle(value: unknown, fallback = "New chat") {
  const cleaned = normalizeText(value);
  return cleaned ? cleaned.slice(0, CHAT_TITLE_MAX_LENGTH) : fallback;
}

export function normalizeChatVisibility(
  value: unknown,
  fallback: ChatVisibility = CHAT_VISIBILITY_DEFAULT,
): ChatVisibility {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "private") return "private";
  return fallback;
}

export function chatRef(orgId: string, chatId: string) {
  return adminDb.collection("organizations").doc(orgId).collection("chats").doc(chatId);
}

export function chatsCollection(orgId: string) {
  return adminDb.collection("organizations").doc(orgId).collection("chats");
}

export function chatMessagesCollection(orgId: string, chatId: string) {
  return chatRef(orgId, chatId).collection("messages");
}

export function assertSafeChatId(chatId: string) {
  const trimmed = chatId.trim();
  if (!trimmed) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  if (trimmed.length > 128) return false;
  return true;
}

export function resolveChatOwnerUid(data: ChatRecord | undefined) {
  const explicitOwner = normalizeText(data?.ownerUid);
  if (explicitOwner) return explicitOwner;
  const createdBy = normalizeText(data?.createdBy);
  return createdBy || null;
}

export function getChatAccess(data: ChatRecord | undefined, uid: string) {
  const visibility = normalizeChatVisibility(data?.visibility, CHAT_VISIBILITY_DEFAULT);
  const ownerUid = resolveChatOwnerUid(data);
  const allowed = Boolean(ownerUid) && ownerUid === uid;
  return { visibility, ownerUid, allowed };
}

function normalizeCitationList(value: unknown) {
  if (!Array.isArray(value)) return [] as RagCitation[];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const citation = item as {
        docId?: unknown;
        docTitle?: unknown;
        headingPath?: unknown;
        chunkId?: unknown;
        snippet?: unknown;
        moreContext?: unknown;
        deepLink?: unknown;
        similarity?: unknown;
      };
      if (typeof citation.docId !== "string" || typeof citation.docTitle !== "string") {
        return null;
      }
      return {
        docId: citation.docId,
        docTitle: citation.docTitle,
        headingPath: typeof citation.headingPath === "string" ? citation.headingPath : null,
        chunkId: typeof citation.chunkId === "string" ? citation.chunkId : null,
        snippet: typeof citation.snippet === "string" ? citation.snippet : "",
        moreContext: typeof citation.moreContext === "string" ? citation.moreContext : null,
        deepLink: typeof citation.deepLink === "string" ? citation.deepLink : "/documents",
        similarity:
          typeof citation.similarity === "number" && Number.isFinite(citation.similarity)
            ? citation.similarity
            : 0,
      } satisfies RagCitation;
    })
    .filter((item): item is RagCitation => Boolean(item));
}

export function serializeChatSnapshot(
  snap: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>,
) {
  const data = snap.data() as ChatRecord | undefined;
  const visibility = normalizeChatVisibility(data?.visibility, CHAT_VISIBILITY_DEFAULT);
  const ownerUid = visibility === "private" ? resolveChatOwnerUid(data) : null;
  return {
    id: snap.id,
    title: normalizeChatTitle(data?.title, "New chat"),
    visibility,
    ownerUid,
    ownerName: visibility === "private" ? normalizeText(data?.ownerName) || null : null,
    createdAt: toIso(data?.createdAt),
    createdBy: normalizeText(data?.createdBy) || null,
    updatedAt: toIso(data?.updatedAt),
    updatedBy: normalizeText(data?.updatedBy) || null,
    lastMessageAt: toIso(data?.lastMessageAt),
    summary: normalizeText(data?.summary) || null,
    summaryUpdatedAt: toIso(data?.summaryUpdatedAt),
  };
}

export function serializeMessageSnapshot(
  snap: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>,
  options?: {
    createdByNameByUid?: Record<string, string | null>;
  },
) {
  if (!snap.exists) {
    throw new Error("Message snapshot not found");
  }
  const data = snap.data() as ChatMessageRecord | undefined;
  const role = data?.role === "assistant" ? "assistant" : "user";
  const content = normalizeText(data?.content);
  const createdBy = normalizeText(data?.createdBy) || null;
  const inlineName = normalizeText(data?.createdByName) || null;
  const lookupName =
    createdBy && options?.createdByNameByUid
      ? normalizeText(options.createdByNameByUid[createdBy]) || null
      : null;
  return {
    id: snap.id,
    role,
    content,
    createdAt: toIso(data?.createdAt),
    createdBy,
    createdByName: inlineName || lookupName,
    citations: role === "assistant" ? normalizeCitationList(data?.citations) : [],
    supportLabel: role === "assistant" ? normalizeText(data?.supportLabel) || null : null,
    contextSummary: role === "assistant" ? normalizeText(data?.contextSummary) || null : null,
  };
}
