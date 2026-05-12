// app/api/org/profile/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgCapability, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { orgId } = await requireOrgCapability(req, "organization.read");

    const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
    if (!orgSnap.exists) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const o = (orgSnap.data() ?? {}) as Record<string, unknown>;

    return NextResponse.json({
      ok: true,
      org: {
        id: orgId,
        name: o["name"] ?? null,
        mission: o["mission"] ?? null,
        homeState: o["homeState"] ?? null,
        taxStatus: o["taxStatus"] ?? null,
        fiscalYear: o["fiscalYear"] ?? null,
        crm: o["crm"] ?? null,
        address: o["address"] ?? null,
        numEmployees: o["numEmployees"] ?? null,
        foundedYear: o["foundedYear"] ?? null,
        websiteUrl: o["websiteUrl"] ?? null,
        websiteConsent: o["websiteConsent"] ?? null,
      },
    });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}


