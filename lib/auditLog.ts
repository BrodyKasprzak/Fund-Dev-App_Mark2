import { adminDb } from "@/lib/firebaseAdmin";

type Primitive = string | number | boolean | null;

type AuditMetadata = Record<string, unknown>;

type WriteOrgAuditLogInput = {
  orgId: string;
  eventType: string;
  actorUid: string;
  actorEmail: string | null;
  docId?: string | null;
  metadata?: AuditMetadata;
};

const MAX_METADATA_KEYS = 24;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 24;

function sanitizePrimitive(value: unknown): Primitive | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value.trim().slice(0, MAX_STRING_LENGTH);
  return undefined;
}

function sanitizeMetadata(metadata?: AuditMetadata) {
  if (!metadata || typeof metadata !== "object") return {};

  const safeEntries: Array<[string, Primitive | Primitive[]]> = [];
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    if (safeEntries.length >= MAX_METADATA_KEYS) break;

    const key = rawKey.trim();
    if (!key) continue;

    const primitiveValue = sanitizePrimitive(rawValue);
    if (primitiveValue !== undefined) {
      safeEntries.push([key, primitiveValue]);
      continue;
    }

    if (Array.isArray(rawValue)) {
      const sanitizedArray = rawValue
        .map((entry) => sanitizePrimitive(entry))
        .filter((entry): entry is Primitive => entry !== undefined)
        .slice(0, MAX_ARRAY_LENGTH);
      safeEntries.push([key, sanitizedArray]);
    }
  }

  return Object.fromEntries(safeEntries);
}

export async function writeOrgAuditLog(input: WriteOrgAuditLogInput) {
  const { orgId, eventType, actorUid, actorEmail, docId, metadata } = input;
  const org = orgId.trim();
  const event = eventType.trim();
  const uid = actorUid.trim();

  if (!org || !event || !uid) {
    throw new Error("Invalid audit log input");
  }

  const eventRef = adminDb
    .collection("organizations")
    .doc(org)
    .collection("auditLogs")
    .doc();

  await eventRef.set({
    eventType: event,
    timestamp: new Date(),
    actor: {
      uid,
      email: typeof actorEmail === "string" ? actorEmail : null,
    },
    docId: typeof docId === "string" && docId.trim() ? docId.trim() : null,
    metadata: sanitizeMetadata(metadata),
  });
}
