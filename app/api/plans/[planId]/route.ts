import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

/**
 * GET /api/plans/[planId]
 * Loads a single plan scoped to the authenticated user's org
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    const { orgId } = await requireOrgContext(req);
    const { planId } = await context.params;

    const ref = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans")
      .doc(planId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      plan: { id: snap.id, ...snap.data() },
    });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * PATCH /api/plans/[planId]
 * Keeps your existing behavior:
 * - validates title (if provided)
 * - validates data (if provided)
 * - merges updates into org-scoped plan doc
 */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const { planId } = await context.params;

    const body = await req.json().catch(() => ({}));

    // Keep your validations & merge semantics,
    // but prevent accidental wipes by only writing fields the client sent.
    const patch: Record<string, any> = {
      updatedAt: new Date(),
      updatedBy: uid, // useful for audit/activity later
    };

    // --- title validation (preserve your behavior) ---
    if ("title" in body) {
      const nextTitle = body?.title;
      if (nextTitle !== undefined && typeof nextTitle !== "string") {
        return NextResponse.json(
          { error: "title must be a string" },
          { status: 400 }
        );
      }
      if (typeof nextTitle === "string") {
        patch.title = nextTitle;
      }
    }

    // --- data validation (preserve your behavior) ---
    if ("data" in body) {
      const nextData = body?.data;
      if (
        nextData === null ||
        typeof nextData !== "object" ||
        Array.isArray(nextData)
      ) {
        return NextResponse.json(
          { error: "data must be an object" },
          { status: 400 }
        );
      }
      patch.data = nextData;
    }

    const ref = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans")
      .doc(planId);

    await ref.set(patch, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

