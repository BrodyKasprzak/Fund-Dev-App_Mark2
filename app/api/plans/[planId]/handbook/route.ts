import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

/**
 * PATCH /api/plans/[planId]/handbook
 * Updates ONLY plan.data.handbook (safe for frequent autosaves)
 * - orgId derived server-side from authenticated user
 * - prevents clobbering other plan.data keys
 * - also updates updatedAt/updatedBy + progress
 * - keeps approved status sticky
 */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { planId } = await context.params;

    const body = await req.json().catch(() => ({}));
    const handbook = body?.handbook;

    if (!handbook || typeof handbook !== "object" || Array.isArray(handbook)) {
      return NextResponse.json(
        { error: "handbook must be an object" },
        { status: 400 }
      );
    }

    const ref = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans")
      .doc(planId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const existing = (snap.data() ?? {}) as { status?: unknown };

    // Compute progress from handbook.sections
    const sections =
      handbook?.sections && typeof handbook.sections === "object" && !Array.isArray(handbook.sections)
        ? handbook.sections
        : {};

    const keys = Object.keys(sections ?? {});
    const totalSections = keys.length;
    const completedSections = keys.filter((k) => Boolean(sections?.[k]?.completed)).length;

    // Status logic: approved is sticky; otherwise default to in_progress
    const nextStatus =
      existing?.status === "approved" ? "approved" : (existing?.status ?? "in_progress");

    // Merge handbook into data without overwriting other data keys
    await ref.set(
      {
        status: nextStatus,
        progress: { completedSections, totalSections },
        data: { handbook },
        updatedAt: new Date(),
        updatedBy: uid,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
