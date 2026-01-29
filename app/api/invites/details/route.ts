import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId") || "";
    const inviteId = searchParams.get("inviteId") || "";

    if (!orgId || !inviteId) {
      return NextResponse.json(
        { error: "Missing orgId or inviteId" },
        { status: 400 }
      );
    }

    const inviteRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("invites")
      .doc(inviteId);

    const snap = await inviteRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const invite = snap.data() as any;

    // fetch org name for display
    const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
    const orgName = orgSnap.exists ? (orgSnap.data() as any)?.name : null;

    // Return only SAFE fields (never return codeHash)
    return NextResponse.json({
      ok: true,
      orgId,
      inviteId,
      orgName,
      invitedEmail: invite?.email ?? null,
      status: invite?.status ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
