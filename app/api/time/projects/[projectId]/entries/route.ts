import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  asOptionalString,
  clockTimeToMinutes,
  isClockTime,
  isIsoDate,
  isSafeTimeId,
  MAX_TIME_NOTES_LENGTH,
  serializeEntry,
  timeEntriesCollection,
  timeProjectsCollection,
} from "@/lib/server/timeManagement";

export const runtime = "nodejs";

const ENTRY_WRITES_PER_10_MIN = 120;

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { projectId } = await context.params;
    if (!isSafeTimeId(projectId)) {
      return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "time_entry_create_user",
      key: `${orgId}:${uid}`,
      limit: ENTRY_WRITES_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "time_entry_create_ip",
      key: getRequestIp(req),
      limit: ENTRY_WRITES_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = await req.json().catch(() => ({}));
    const workDate = body?.workDate;
    const startTime = body?.startTime;
    const endTime = body?.endTime;
    const notes = asOptionalString(body?.notes, MAX_TIME_NOTES_LENGTH);
    if (!isIsoDate(workDate) || !isClockTime(startTime) || !isClockTime(endTime)) {
      return NextResponse.json({ error: "A valid date, start time, and end time are required." }, { status: 400 });
    }
    if (workDate > new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: "Time entries cannot be dated in the future." }, { status: 400 });
    }
    const durationMinutes = clockTimeToMinutes(endTime) - clockTimeToMinutes(startTime);
    if (durationMinutes <= 0) {
      return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
    }
    if (notes === null) {
      return NextResponse.json({ error: "Notes must be 500 characters or fewer." }, { status: 400 });
    }

    const projectRef = timeProjectsCollection(orgId).doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists || projectSnap.data()?.ownerUid !== uid) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (projectSnap.data()?.status === "completed" || projectSnap.data()?.completedAt) {
      return NextResponse.json({ error: "Completed contracts cannot receive new time entries." }, { status: 409 });
    }

    const now = new Date();
    const entryRef = timeEntriesCollection(orgId).doc();
    await entryRef.set({
      projectId,
      ownerUid: uid,
      source: "manual",
      workDate,
      startTime,
      endTime,
      notes,
      startedAt: null,
      endedAt: null,
      durationSeconds: durationMinutes * 60,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });
    await projectRef.set({ updatedAt: now, updatedBy: uid }, { merge: true });

    const entrySnap = await entryRef.get();
    return NextResponse.json({ ok: true, entry: serializeEntry(entrySnap) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const { status, message } = errorToResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
