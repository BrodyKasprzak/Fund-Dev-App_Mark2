import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

const TEMPLATE_DEFAULT_TITLES: Record<string, string> = {
  fund_dev_handbook: "Fund Development Handbook",
  annual_fund_dev_plan: "Annual Fund Development Plan",
  case_for_support: "Case for Support",
  campaign_plan: "Campaign Plan",
  grant_strategy: "Grant Strategy",
};

export async function POST(req: Request) {
  try {
    const { orgId, uid } = await requireOrgContext(req);
    const body = await req.json().catch(() => ({}));

    const templateType = String(body?.templateType ?? "").trim();
    if (!templateType) {
      return NextResponse.json(
        { error: "Missing templateType" },
        { status: 400 }
      );
    }

    const titleFromClient =
      body?.title !== undefined ? String(body.title).trim() : "";

    const title =
      titleFromClient ||
      TEMPLATE_DEFAULT_TITLES[templateType] ||
      "Untitled Plan";

    const now = new Date();

    const ref = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans")
      .doc();

    await ref.set({
      title,
      titleLower: title.toLowerCase(), // optional; helpful later
      templateType,

      // NEW: status + progress so Activity can filter
      status: "in_progress",
      progress: { completedSections: 0, totalSections: 0 },

      // Keep this flexible. You’ll define the schema per template later.
      data: {},

      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    });

    return NextResponse.json({ ok: true, planId: ref.id });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
