import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import {
  activeTimersCollection,
  isSafeTimeId,
  timeEntriesCollection,
  timeProjectsCollection,
} from "@/lib/server/timeManagement";

export const runtime = "nodejs";

const ENTRY_DELETES_PER_10_MIN = 60;

export async function DELETE(
  req: Request,
  context: { params: Promise<{ entryId: string }> },
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { entryId } = await context.params;
    if (!isSafeTimeId(entryId)) {
      return NextResponse.json({ error: "Invalid entryId" }, { status: 400 });
    }

    await enforceRateLimit({
      scope: "time_entry_delete_user",
      key: `${orgId}:${uid}`,
      limit: ENTRY_DELETES_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "time_entry_delete_ip",
      key: getRequestIp(req),
      limit: ENTRY_DELETES_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const entryRef = timeEntriesCollection(orgId).doc(entryId);
    const activeRef = activeTimersCollection(orgId).doc(uid);
    let projectId = "";
    await entryRef.firestore.runTransaction(async (transaction) => {
      const [entrySnap, activeSnap] = await Promise.all([
        transaction.get(entryRef),
        transaction.get(activeRef),
      ]);
      if (!entrySnap.exists || entrySnap.data()?.ownerUid !== uid) {
        throw new Error("ENTRY_NOT_FOUND");
      }
      if (activeSnap.exists && activeSnap.data()?.entryId === entryId) {
        throw new Error("ENTRY_IS_ACTIVE");
      }
      projectId = typeof entrySnap.data()?.projectId === "string" ? entrySnap.data()!.projectId : "";
      if (projectId && isSafeTimeId(projectId)) {
        const projectSnap = await transaction.get(timeProjectsCollection(orgId).doc(projectId));
        if (projectSnap.data()?.status === "completed" || projectSnap.data()?.completedAt) {
          throw new Error("CONTRACT_COMPLETED");
        }
      }
      transaction.delete(entryRef);
      if (projectId && isSafeTimeId(projectId)) {
        transaction.set(
          timeProjectsCollection(orgId).doc(projectId),
          { updatedAt: new Date(), updatedBy: uid },
          { merge: true },
        );
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "ENTRY_NOT_FOUND") {
      return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    }
    if (message === "ENTRY_IS_ACTIVE") {
      return NextResponse.json({ error: "Stop the timer before deleting this entry." }, { status: 409 });
    }
    if (message === "CONTRACT_COMPLETED") {
      return NextResponse.json({ error: "Completed contract entries cannot be changed." }, { status: 409 });
    }
    const { status, message: fallback } = errorToResponse(error);
    return NextResponse.json({ error: fallback }, { status });
  }
}
