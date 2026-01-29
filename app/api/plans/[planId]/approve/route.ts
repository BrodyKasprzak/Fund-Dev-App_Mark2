import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

/**
 * POST /api/plans/[planId]/approve
 * Marks a plan as approved (scoped to org) and stores approval metadata.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    const ctx: any = await requireOrgContext(req);
    const orgId = ctx?.orgId;
    const uid = ctx?.uid;
    const email = ctx?.email;

    if (!orgId) {
      return NextResponse.json({ error: "Missing org context" }, { status: 401 });
    }

    // ✅ IMPORTANT: params is a Promise in your project
    const { planId } = await context.params;

    if (!planId) {
      return NextResponse.json({ error: "Missing planId" }, { status: 400 });
    }

    const ref = adminDb
      .collection("organizations")
      .doc(String(orgId))
      .collection("plans")
      .doc(String(planId));

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    await ref.set(
      {
        status: "approved",
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: { uid: uid ?? null, email: email ?? null },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const { status, message } = errorToResponse(e);
    return NextResponse.json({ error: message }, { status });
  }
}

