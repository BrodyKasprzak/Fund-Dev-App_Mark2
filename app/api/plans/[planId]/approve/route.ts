import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

/**
 * POST /api/plans/[planId]/approve
 * Marks a plan as approved (scoped to org) and stores approval metadata.
 */

type OrgContext = {
  orgId: string;
  uid: string;
  email?: string | null;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    // requireOrgContext should throw if invalid; we still validate shape defensively.
    const ctx = (await requireOrgContext(req)) as OrgContext;

    const orgId = typeof ctx?.orgId === "string" ? ctx.orgId : "";
    const uid = typeof ctx?.uid === "string" ? ctx.uid : "";
    const email = typeof ctx?.email === "string" ? ctx.email : null;

    if (!orgId || !uid) {
      return NextResponse.json({ error: "Missing org context" }, { status: 401 });
    }

    // ✅ IMPORTANT: params is a Promise in your project
    const { planId } = await context.params;

    if (!planId) {
      return NextResponse.json({ error: "Missing planId" }, { status: 400 });
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

    await ref.set(
      {
        status: "approved",
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: { uid, email },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const { status, message } = errorToResponse(e);
    return NextResponse.json({ error: message }, { status });
  }
}


