import { adminDb } from "@/lib/firebaseAdmin";

type FirestoreDateLike =
  | Date
  | { toDate: () => Date }
  | null
  | undefined;

export const MAX_TIME_NAME_LENGTH = 120;
export const MAX_TIME_NOTES_LENGTH = 500;
export const MAX_TIME_ID_LENGTH = 128;
export const MAX_CONTRACT_HOURS = 100_000;
export const MAX_CONTRACT_AMOUNT_CENTS = 100_000_000_000;

export function asTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) return null;
  return cleaned;
}

export function asOptionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length <= maxLength ? cleaned : null;
}

export function asHours(value: unknown, allowZero = true) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || (!allowZero && parsed === 0) || parsed > MAX_CONTRACT_HOURS) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

export function asCurrencyCents(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const cents = Math.round(parsed * 100);
  return cents > 0 && cents <= MAX_CONTRACT_AMOUNT_CENTS ? cents : null;
}

export function isSafeTimeId(value: string) {
  const cleaned = value.trim();
  return (
    cleaned.length > 0 &&
    cleaned.length <= MAX_TIME_ID_LENGTH &&
    !cleaned.includes("/") &&
    !cleaned.includes("\\")
  );
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function clockTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function toIso(value: FirestoreDateLike) {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

export function timeProjectsCollection(orgId: string) {
  return adminDb.collection("organizations").doc(orgId).collection("timeProjects");
}

export function timeEntriesCollection(orgId: string) {
  return adminDb.collection("organizations").doc(orgId).collection("timeEntries");
}

export function activeTimersCollection(orgId: string) {
  return adminDb.collection("organizations").doc(orgId).collection("timeActiveTimers");
}

export function serializeProject(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : "",
    ownerName: typeof data.ownerName === "string" ? data.ownerName : null,
    name: typeof data.name === "string" ? data.name : "Untitled contract",
    contractStart: typeof data.contractStart === "string" ? data.contractStart : null,
    contractEnd: typeof data.contractEnd === "string" ? data.contractEnd : null,
    baselineHours: typeof data.baselineHours === "number" ? data.baselineHours : 0,
    contractHours: typeof data.contractHours === "number" ? data.contractHours : 0,
    contractAmountCents:
      typeof data.contractAmountCents === "number" && Number.isFinite(data.contractAmountCents)
        ? Math.max(0, Math.round(data.contractAmountCents))
        : 0,
    status: data.status === "completed" ? "completed" : "active",
    completedHours:
      typeof data.completedHours === "number" && Number.isFinite(data.completedHours)
        ? Math.max(0, data.completedHours)
        : null,
    completedAt: toIso(data.completedAt as FirestoreDateLike),
    createdAt: toIso(data.createdAt as FirestoreDateLike),
    updatedAt: toIso(data.updatedAt as FirestoreDateLike),
  };
}

export function serializeEntry(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    projectId: typeof data.projectId === "string" ? data.projectId : "",
    ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : "",
    source: data.source === "timer" ? "timer" : "manual",
    workDate: typeof data.workDate === "string" ? data.workDate : null,
    startTime: typeof data.startTime === "string" ? data.startTime : null,
    endTime: typeof data.endTime === "string" ? data.endTime : null,
    notes: typeof data.notes === "string" ? data.notes : "",
    startedAt: toIso(data.startedAt as FirestoreDateLike),
    endedAt: toIso(data.endedAt as FirestoreDateLike),
    durationSeconds:
      typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds)
        ? Math.max(0, Math.round(data.durationSeconds))
        : null,
    createdAt: toIso(data.createdAt as FirestoreDateLike),
    updatedAt: toIso(data.updatedAt as FirestoreDateLike),
  };
}

export function serializeActiveTimer(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  const projectId = typeof data.projectId === "string" ? data.projectId : "";
  const startedAt = toIso(data.startedAt as FirestoreDateLike);
  if (!projectId || !startedAt) return null;
  return {
    ownerUid: snapshot.id,
    projectId,
    entryId: typeof data.entryId === "string" ? data.entryId : null,
    workDate: typeof data.workDate === "string" ? data.workDate : null,
    startedAt,
  };
}
