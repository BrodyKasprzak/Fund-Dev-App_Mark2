import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { normalizeOrgRole } from "@/lib/permissions";
import {
  activeTimersCollection,
  asCurrencyCents,
  asHours,
  asTrimmedString,
  isIsoDate,
  isSafeTimeId,
  MAX_TIME_NAME_LENGTH,
  serializeActiveTimer,
  serializeEntry,
  serializeProject,
  timeEntriesCollection,
  timeProjectsCollection,
} from "@/lib/server/timeManagement";

export const runtime = "nodejs";

const READ_LIMIT_PER_5_MIN = 240;
const WRITE_LIMIT_PER_10_MIN = 60;

function rateLimitResponse(error: RateLimitError) {
  return NextResponse.json(
    { error: error.message },
    { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
  );
}

function asMember(snapshot: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = snapshot.data();
  return {
    uid: snapshot.id,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
    email: typeof data.email === "string" && data.email.trim() ? data.email.trim() : null,
    role: normalizeOrgRole(data.role),
    status:
      typeof data.status === "string" && data.status.trim()
        ? data.status.trim().toLowerCase()
        : "active",
  };
}

export async function GET(req: Request) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    await enforceRateLimit({
      scope: "time_read_user",
      key: `${orgId}:${uid}`,
      limit: READ_LIMIT_PER_5_MIN,
      windowMs: 5 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "time_read_ip",
      key: getRequestIp(req),
      limit: READ_LIMIT_PER_5_MIN * 2,
      windowMs: 5 * 60 * 1000,
    });

    const targetUid = new URL(req.url).searchParams.get("userId")?.trim() || uid;
    if (!isSafeTimeId(targetUid)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }

    const membersRef = adminDb.collection("organizations").doc(orgId).collection("members");
    const membersSnap = await membersRef.get();
    const members = membersSnap.docs
      .map(asMember)
      .filter((member) => member.status === "active")
      .sort((a, b) =>
        (a.name || a.email || a.uid).localeCompare(b.name || b.email || b.uid),
      );

    if (!members.some((member) => member.uid === targetUid)) {
      return NextResponse.json({ error: "Organization member not found" }, { status: 404 });
    }

    const [projectsSnap, entriesSnap, activeTimerSnap] = await Promise.all([
      timeProjectsCollection(orgId).where("ownerUid", "==", targetUid).get(),
      timeEntriesCollection(orgId)
        .where("ownerUid", "==", targetUid)
        .get(),
      activeTimersCollection(orgId).doc(targetUid).get(),
    ]);

    const projects = projectsSnap.docs
      .map(serializeProject)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const projectIds = new Set(projects.map((project) => project.id));
    const entries = entriesSnap.docs
      .map(serializeEntry)
      .filter((entry) => projectIds.has(entry.projectId))
      .sort((a, b) =>
        (b.startedAt || `${b.workDate || ""}T${b.startTime || "00:00"}`).localeCompare(
          a.startedAt || `${a.workDate || ""}T${a.startTime || "00:00"}`,
        ),
      );

    return NextResponse.json({
      ok: true,
      currentUserId: uid,
      selectedUserId: targetUid,
      members,
      projects,
      entries,
      activeTimer: serializeActiveTimer(activeTimerSnap),
    });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    const { status, message } = errorToResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { orgId, uid, email } = await requireOrgContext(req);
    await enforceRateLimit({
      scope: "time_project_create_user",
      key: `${orgId}:${uid}`,
      limit: WRITE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "time_project_create_ip",
      key: getRequestIp(req),
      limit: WRITE_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const body = await req.json().catch(() => ({}));
    const name = asTrimmedString(body?.name, MAX_TIME_NAME_LENGTH);
    const contractStart = body?.contractStart;
    const contractEnd = body?.contractEnd;
    const baselineHours = asHours(body?.baselineHours);
    const remainingHours = asHours(body?.remainingHours);
    const contractAmountCents = asCurrencyCents(body?.contractAmount);

    if (!name) {
      return NextResponse.json({ error: "Contract name is required." }, { status: 400 });
    }
    if (!isIsoDate(contractStart) || !isIsoDate(contractEnd)) {
      return NextResponse.json({ error: "Valid contract start and end dates are required." }, { status: 400 });
    }
    if (contractStart > contractEnd) {
      return NextResponse.json({ error: "Contract end must be on or after its start date." }, { status: 400 });
    }
    if (baselineHours === null || remainingHours === null) {
      return NextResponse.json({ error: "Hours must be non-negative numbers." }, { status: 400 });
    }
    if (contractAmountCents === null) {
      return NextResponse.json({ error: "Contract amount must be greater than zero." }, { status: 400 });
    }
    const contractHours = Math.round((baselineHours + remainingHours) * 100) / 100;
    if (contractHours <= 0 || contractHours > 100_000) {
      return NextResponse.json({ error: "Total contract hours must be greater than zero." }, { status: 400 });
    }

    const memberSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("members")
      .doc(uid)
      .get();
    const memberData = memberSnap.data() ?? {};
    const ownerName =
      typeof memberData.name === "string" && memberData.name.trim()
        ? memberData.name.trim()
        : email;
    const now = new Date();
    const projectRef = timeProjectsCollection(orgId).doc();
    await projectRef.set({
      ownerUid: uid,
      ownerName: ownerName ?? null,
      name,
      contractStart,
      contractEnd,
      baselineHours,
      contractHours,
      contractAmountCents,
      status: "active",
      completedHours: null,
      completedAt: null,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });

    const projectSnap = await projectRef.get();
    return NextResponse.json({ ok: true, project: serializeProject(projectSnap) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    const { status, message } = errorToResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
