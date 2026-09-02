import { NextResponse } from "next/server";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { writeOrgAuditLog } from "@/lib/auditLog";
import {
  activeTimersCollection,
  isSafeTimeId,
  serializeProject,
  timeEntriesCollection,
  timeProjectsCollection,
} from "@/lib/server/timeManagement";

export const runtime = "nodejs";

const CONTRACT_ACTIONS_PER_10_MIN = 30;
const DELETE_BATCH_SIZE = 400;

async function enforceActionRateLimit(req: Request, orgId: string, uid: string) {
  await enforceRateLimit({
    scope: "time_contract_action_user",
    key: `${orgId}:${uid}`,
    limit: CONTRACT_ACTIONS_PER_10_MIN,
    windowMs: 10 * 60 * 1000,
  });
  await enforceRateLimit({
    scope: "time_contract_action_ip",
    key: getRequestIp(req),
    limit: CONTRACT_ACTIONS_PER_10_MIN * 2,
    windowMs: 10 * 60 * 1000,
  });
}

function rateLimitResponse(error: RateLimitError) {
  return NextResponse.json(
    { error: error.message },
    { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
  );
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { orgId, uid, email } = await requireOrgContext(req);
    const { projectId } = await context.params;
    if (!isSafeTimeId(projectId)) {
      return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }
    await enforceActionRateLimit(req, orgId, uid);

    const body = await req.json().catch(() => ({}));
    if (body?.action !== "complete") {
      return NextResponse.json({ error: "action must be complete" }, { status: 400 });
    }

    const projectRef = timeProjectsCollection(orgId).doc(projectId);
    const [projectSnap, activeTimerSnap, entriesSnap] = await Promise.all([
      projectRef.get(),
      activeTimersCollection(orgId).doc(uid).get(),
      timeEntriesCollection(orgId).where("projectId", "==", projectId).get(),
    ]);
    if (!projectSnap.exists || projectSnap.data()?.ownerUid !== uid) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (activeTimerSnap.exists && activeTimerSnap.data()?.projectId === projectId) {
      return NextResponse.json(
        { error: "Stop the active timer before completing this contract." },
        { status: 409 },
      );
    }

    const projectData = projectSnap.data() ?? {};
    if (projectData.status === "completed" || projectData.completedAt) {
      return NextResponse.json({ ok: true, project: serializeProject(projectSnap) });
    }
    const contractHours =
      typeof projectData.contractHours === "number" ? Math.max(0, projectData.contractHours) : 0;
    const baselineHours =
      typeof projectData.baselineHours === "number" ? Math.max(0, projectData.baselineHours) : 0;
    const trackedHours = entriesSnap.docs.reduce((hours, entry) => {
      if (entry.data()?.ownerUid !== uid) return hours;
      const seconds = entry.data()?.durationSeconds;
      return hours + (typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(0, seconds) / 3600 : 0);
    }, 0);
    const actualHours = baselineHours + trackedHours;
    const incomplete = actualHours + 0.0001 < contractHours;
    if (incomplete && body?.confirmIncomplete !== true) {
      return NextResponse.json(
        {
          error: "You have not completed all the hours for this contract.",
          code: "INCOMPLETE_CONTRACT_HOURS",
          actualHours,
          contractHours,
          remainingHours: Math.max(0, contractHours - actualHours),
        },
        { status: 409 },
      );
    }

    if (projectData.status !== "completed") {
      const now = new Date();
      await projectRef.set(
        {
          status: "completed",
          completedHours: contractHours,
          completedAt: now,
          completedBy: uid,
          updatedAt: now,
          updatedBy: uid,
        },
        { merge: true },
      );
      await writeOrgAuditLog({
        orgId,
        eventType: "time.contract_completed",
        actorUid: uid,
        actorEmail: email,
        metadata: {
          projectId,
          contractName: typeof projectData.name === "string" ? projectData.name : "",
          contractHours,
          actualHours,
          completedWithHoursRemaining: incomplete,
        },
      });
    }

    const updatedSnap = await projectRef.get();
    return NextResponse.json({ ok: true, project: serializeProject(updatedSnap) });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    const { status, message } = errorToResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { orgId, uid, email } = await requireOrgContext(req);
    const { projectId } = await context.params;
    if (!isSafeTimeId(projectId)) {
      return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }
    await enforceActionRateLimit(req, orgId, uid);

    const projectRef = timeProjectsCollection(orgId).doc(projectId);
    const [projectSnap, activeTimerSnap] = await Promise.all([
      projectRef.get(),
      activeTimersCollection(orgId).doc(uid).get(),
    ]);
    if (!projectSnap.exists || projectSnap.data()?.ownerUid !== uid) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (activeTimerSnap.exists && activeTimerSnap.data()?.projectId === projectId) {
      return NextResponse.json(
        { error: "Stop the active timer before removing this contract." },
        { status: 409 },
      );
    }

    const projectData = projectSnap.data() ?? {};
    const entriesSnap = await timeEntriesCollection(orgId)
      .where("projectId", "==", projectId)
      .get();

    for (let index = 0; index < entriesSnap.docs.length; index += DELETE_BATCH_SIZE) {
      const batch = projectRef.firestore.batch();
      entriesSnap.docs
        .slice(index, index + DELETE_BATCH_SIZE)
        .forEach((entry) => batch.delete(entry.ref));
      await batch.commit();
    }
    await projectRef.delete();

    await writeOrgAuditLog({
      orgId,
      eventType: "time.contract_removed",
      actorUid: uid,
      actorEmail: email,
      metadata: {
        projectId,
        contractName: typeof projectData.name === "string" ? projectData.name : "",
        entriesRemoved: entriesSnap.size,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    const { status, message } = errorToResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
