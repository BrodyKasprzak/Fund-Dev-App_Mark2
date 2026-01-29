import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth } from "@/lib/serverAuth";

/**
 * Normalizes emails for comparison.
 * - Lowercases
 * - Removes +tags (safe-ish, common behavior)
 * - Removes dots ONLY for Gmail / Googlemail
 */
function normalizeEmail(e: string) {
  const email = e.trim().toLowerCase();
  const [localRaw, domainRaw] = email.split("@");
  if (!localRaw || !domainRaw) return email;

  const domain = domainRaw.toLowerCase();

  // Remove +tag (widely used but not universal)
  const localNoPlus = localRaw.split("+")[0];

  // Gmail-specific: dots don't matter
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const localNoDots = localNoPlus.replace(/\./g, "");
    return `${localNoDots}@gmail.com`;
  }

  return `${localNoPlus}@${domain}`;
}

export async function POST(req: Request) {
  try {
    const { uid, email } = await requireAuth(req);
    if (!email) {
      return NextResponse.json(
        { error: "Email not available on account" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // ✅ CHANGE #1: include name + position
    const { orgId, inviteId, code, name, position } = body ?? {};

    // ✅ CHANGE #2: validate name + position too
    if (!orgId || !inviteId || !code || !name || !position) {
      return NextResponse.json(
        { error: "Missing orgId, inviteId, code, name, or position" },
        { status: 400 }
      );
    }

    const inviteRef = adminDb
      .collection("organizations")
      .doc(String(orgId))
      .collection("invites")
      .doc(String(inviteId));

    const snap = await inviteRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const invite = snap.data() as any;

    if (invite.status !== "pending") {
      return NextResponse.json(
        { error: `Invite is ${invite.status}` },
        { status: 400 }
      );
    }

    // 🔍 KEEP EXACTLY AS-IS: email match check + debug
    const inviteEmailRaw = String(invite.email || "");
    const userEmailRaw = String(email || "");

    const inviteEmailNorm = normalizeEmail(inviteEmailRaw);
    const userEmailNorm = normalizeEmail(userEmailRaw);

    console.log("INVITE EMAIL DEBUG:", {
      inviteEmailRaw,
      userEmailRaw,
      inviteEmailNorm,
      userEmailNorm,
    });

    if (inviteEmailNorm !== userEmailNorm) {
      return NextResponse.json(
        {
          error: "Invite email does not match your account email",
          debug: {
            inviteEmailRaw,
            userEmailRaw,
            inviteEmailNorm,
            userEmailNorm,
          },
        },
        { status: 403 }
      );
    }

    // 🔍 KEEP EXACTLY AS-IS: codeHash verification
    const codeHash = crypto
      .createHash("sha256")
      .update(String(code))
      .digest("hex");

    if (codeHash !== invite.codeHash) {
      return NextResponse.json(
        { error: "Invalid access code" },
        { status: 403 }
      );
    }

    // ✅ Accept invite + add membership atomically
    const batch = adminDb.batch();

    const userRef = adminDb.collection("users").doc(uid);

    // ✅ CHANGE #3: include name + position in user write
    batch.set(
      userRef,
      {
        orgId: String(orgId),
        role: "member",
        email,
        name: String(name),
        position: String(position),
        updatedAt: new Date(),
        // createdAt: new Date(), // optional (see note below)
      },
      { merge: true }
    );

    batch.set(
      inviteRef,
      {
        status: "accepted",
        acceptedAt: new Date(),
        acceptedBy: uid,
      },
      { merge: true }
    );

    await batch.commit();

    return NextResponse.json({ ok: true, orgId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 401 }
    );
  }
}
