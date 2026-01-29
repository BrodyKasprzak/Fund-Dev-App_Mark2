import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { uid, email, orgId, role } = await requireOrgContext(req);

    const userSnap = await adminDb.collection("users").doc(uid).get();
    const user = (userSnap.data() as any) ?? {};

    return NextResponse.json({
      ok: true,
      me: {
        uid,
        email,
        orgId,
        role,
        name: user.name ?? null,
        position: user.position ?? null,
      },
    });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
