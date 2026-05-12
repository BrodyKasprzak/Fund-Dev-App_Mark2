import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requirePlanWriteAccess, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ planId: string }> },
) {
  try {
    const { orgId, uid, email } = await requirePlanWriteAccess(req);
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
        updatedBy: uid,
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

