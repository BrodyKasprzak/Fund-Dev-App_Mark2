import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  activeTimersCollection,
  asOptionalString,
  isIsoDate,
  isSafeTimeId,
  MAX_TIME_NOTES_LENGTH,
  serializeActiveTimer,
  serializeEntry,
  timeEntriesCollection,
  timeProjectsCollection,
} from "@/lib/server/timeManagement";

export const runtime = "nodejs";

const TIMER_ACTIONS_PER_10_MIN = 120;

function actionError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { projectId } = await context.params;
    if (!isSafeTimeId(projectId)) return actionError("Invalid projectId", 400);

    await enforceRateLimit({
      scope: "time_timer_user",
      key: `${orgId}:${uid}`,
      limit: TIMER_ACTIONS_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "time_timer_ip",
      key: getRequestIp(req),
      limit: TIMER_ACTIONS_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action !== "start" && action !== "stop") {
      return actionError("action must be start or stop", 400);
    }

    const projectRef = timeProjectsCollection(orgId).doc(projectId);
    const activeRef = activeTimersCollection(orgId).doc(uid);

    if (action === "start") {
      const workDate = body?.workDate;
      const notes = asOptionalString(body?.notes, MAX_TIME_NOTES_LENGTH);
      if (!isIsoDate(workDate)) return actionError("A valid work date is required.", 400);
      if (notes === null) return actionError("Notes are too long.", 400);

      const startedAt = new Date();
      await projectRef.firestore.runTransaction(async (transaction) => {
        const [projectSnap, activeSnap] = await Promise.all([
          transaction.get(projectRef),
          transaction.get(activeRef),
        ]);
        if (!projectSnap.exists || projectSnap.data()?.ownerUid !== uid) {
          throw new Error("PROJECT_NOT_FOUND");
        }
        if (projectSnap.data()?.status === "completed" || projectSnap.data()?.completedAt) {
          throw new Error("CONTRACT_COMPLETED");
        }
        if (activeSnap.exists) throw new Error("TIMER_ALREADY_RUNNING");

        transaction.set(activeRef, {
          projectId,
          workDate,
          notes,
          startedAt,
          updatedAt: startedAt,
        });
        transaction.set(projectRef, { updatedAt: startedAt, updatedBy: uid }, { merge: true });
      });

      const activeSnap = await activeRef.get();
      return NextResponse.json({
        ok: true,
        activeTimer: serializeActiveTimer(activeSnap),
      });
    }

    const endedAt = new Date();
    let stoppedEntryId = "";
    await projectRef.firestore.runTransaction(async (transaction) => {
      const activeSnap = await transaction.get(activeRef);
      if (!activeSnap.exists) throw new Error("NO_ACTIVE_TIMER");
      const activeData = activeSnap.data() ?? {};
      if (activeData.projectId !== projectId) {
        throw new Error("OTHER_TIMER_RUNNING");
      }

      // entryId is supported for timers started by the previous implementation.
      // New timers only create their final time entry when they are stopped.
      const legacyEntryId =
        typeof activeData.entryId === "string" && isSafeTimeId(activeData.entryId)
          ? activeData.entryId
          : null;
      const entryRef = legacyEntryId
        ? timeEntriesCollection(orgId).doc(legacyEntryId)
        : timeEntriesCollection(orgId).doc();
      const projectSnap = await transaction.get(projectRef);
      const legacyEntrySnap = legacyEntryId ? await transaction.get(entryRef) : null;
      if (!projectSnap.exists || projectSnap.data()?.ownerUid !== uid) {
        throw new Error("PROJECT_NOT_FOUND");
      }
      if (legacyEntrySnap && (!legacyEntrySnap.exists || legacyEntrySnap.data()?.ownerUid !== uid)) {
        throw new Error("TIME_ENTRY_NOT_FOUND");
      }

      const startedAtValue = activeData.startedAt;
      const startedAt =
        startedAtValue && typeof startedAtValue.toDate === "function"
          ? startedAtValue.toDate()
          : startedAtValue instanceof Date
            ? startedAtValue
            : null;
      if (!startedAt || Number.isNaN(startedAt.getTime())) throw new Error("INVALID_ACTIVE_TIMER");

      const durationSeconds = Math.max(
        1,
        Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
      );
      const legacyEntryData = legacyEntrySnap?.data() ?? {};
      stoppedEntryId = entryRef.id;
      const completedEntry = {
        projectId,
        ownerUid: uid,
        source: "timer",
        workDate: isIsoDate(activeData.workDate)
          ? activeData.workDate
          : isIsoDate(legacyEntryData.workDate)
            ? legacyEntryData.workDate
            : endedAt.toISOString().slice(0, 10),
        startTime: null,
        endTime: null,
        notes:
          typeof activeData.notes === "string"
            ? activeData.notes.slice(0, MAX_TIME_NOTES_LENGTH)
            : typeof legacyEntryData.notes === "string"
              ? legacyEntryData.notes.slice(0, MAX_TIME_NOTES_LENGTH)
              : "",
        startedAt,
        endedAt,
        durationSeconds,
        createdAt: legacyEntryData.createdAt ?? startedAt,
        createdBy: legacyEntryData.createdBy ?? uid,
        updatedAt: endedAt,
        updatedBy: uid,
      };
      transaction.set(entryRef, completedEntry, { merge: Boolean(legacyEntryId) });
      transaction.delete(activeRef);
      transaction.set(projectRef, { updatedAt: endedAt, updatedBy: uid }, { merge: true });
    });

    const entrySnap = await timeEntriesCollection(orgId).doc(stoppedEntryId).get();
    return NextResponse.json({ ok: true, entry: serializeEntry(entrySnap), activeTimer: null });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "PROJECT_NOT_FOUND") return actionError("Project not found", 404);
    if (message === "CONTRACT_COMPLETED") {
      return actionError("Completed contracts cannot start a new timer.", 409);
    }
    if (message === "TIMER_ALREADY_RUNNING" || message === "OTHER_TIMER_RUNNING") {
      return actionError("Another project timer is already running. Stop it before starting a new one.", 409);
    }
    if (message === "NO_ACTIVE_TIMER") return actionError("No timer is currently running.", 409);
    if (message === "TIME_ENTRY_NOT_FOUND" || message === "INVALID_ACTIVE_TIMER") {
      return actionError("The active timer could not be completed. Please contact support.", 409);
    }
    const { status, message: fallback } = errorToResponse(error);
    return NextResponse.json({ error: fallback }, { status });
  }
}
