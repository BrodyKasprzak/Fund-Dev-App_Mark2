// app/api/invites/accept/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

/**
 * Normalizes emails for comparison.
 * - Lowercases
 * - Removes +tags (common behavior)
 * - Removes dots ONLY for Gmail / Googlemail
 */
function normalizeEmail(e: string) {
  const email = String(e ?? "").trim().toLowerCase();
  const [localRaw, domainRaw] = email.split("@");
  if (!localRaw || !domainRaw) return email;

  const domain = domainRaw.toLowerCase();

  // Remove +tag
  const localNoPlus = localRaw.split("+")[0];

  // Gmail-specific: dots don't matter
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const localNoDots = localNoPlus.replace(/\./g, "");
    return `${localNoDots}@gmail.com`;
  }

  return `${localNoPlus}@${domain}`;
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
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

    const body = await req.json().catch(() => ({}));

    const orgId = asNonEmptyString(body?.orgId);
    const inviteId = asNonEmptyString(body?.inviteId);
    const code = asNonEmptyString(body?.code);
    const name = asNonEmptyString(body?.name);
    const position = asNonEmptyString(body?.position);

    if (!orgId || !inviteId || !code || !name || !position) {
      return NextResponse.json(
        { error: "Missing orgId, inviteId, code, name, or position" },
        { status: 400 }
      );
    }

    const orgRef = adminDb.collection("organizations").doc(orgId);
    const inviteRef = orgRef.collection("invites").doc(inviteId);

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

    // 🔍 Email match check + debug (kept as-is conceptually)
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

    // 🔍 codeHash verification (kept as-is)
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    if (codeHash !== String(invite.codeHash || "")) {
      return NextResponse.json({ error: "Invalid access code" }, { status: 403 });
    }

    // ✅ Accept invite + add canonical membership atomically
    const now = new Date();
    const batch = adminDb.batch();

    const memberRef = orgRef.collection("members").doc(uid);
    const userRef = adminDb.collection("users").doc(uid);
    const userMembershipRef = userRef.collection("memberships").doc(orgId);

    // 1) Canonical membership (org-scoped)
    batch.set(
      memberRef,
      {
        uid,
        email,
        role: "member",
        status: "active",
        name,
        position,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
      },
      { merge: true }
    );

    // 2) User profile doc (NEVER authoritative for auth)
    batch.set(
      userRef,
      {
        email,
        name,
        position,
        lastOrgId: orgId,
        updatedAt: now,
      },
      { merge: true }
    );

    // 3) Membership index for fast /api/me (recommended)
    batch.set(
      userMembershipRef,
      {
        orgId,
        role: "member",
        status: "active",
        orgName: null, // optional cache
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );

    // 4) Mark invite accepted
    batch.set(
      inviteRef,
      {
        status: "accepted",
        acceptedAt: now,
        acceptedBy: uid,
      },
      { merge: true }
    );

    await batch.commit();

    return NextResponse.json({ ok: true, orgId });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}


