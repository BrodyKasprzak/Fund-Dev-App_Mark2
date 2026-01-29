import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { orgId } = await requireOrgContext(req);

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") ?? "all").trim();
    const templateType = (url.searchParams.get("templateType") ?? "all").trim();
    const sort = (url.searchParams.get("sort") ?? "updated_desc").trim();

    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 20;

    const sortField = sort.startsWith("created") ? "createdAt" : "updatedAt";
    const sortDir = sort.endsWith("_asc") ? "asc" : "desc";

    let q: FirebaseFirestore.Query = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans");

    // Optional filters (keeps old behavior when not supplied)
    if (templateType !== "all") {
      q = q.where("templateType", "==", templateType);
    }

    if (status !== "all") {
      q = q.where("status", "==", status);
    }

    q = q.orderBy(sortField, sortDir as FirebaseFirestore.OrderByDirection).limit(limit);

    const snap = await q.get();

    const plans = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        title: data.title ?? "(Untitled)",
        titleLower: data.titleLower ?? null,
        templateType: data.templateType ?? null,
        status: data.status ?? "in_progress",
        progress: data.progress ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
        createdBy: data.createdBy ?? null,
        updatedBy: data.updatedBy ?? null,
        approvedAt: data.approvedAt ?? null,
        approvedBy: data.approvedBy ?? null,

        // keep the full data if you still want it client-side (optional)
        data: data.data ?? undefined,
      };
    });

    return NextResponse.json({ ok: true, plans });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
