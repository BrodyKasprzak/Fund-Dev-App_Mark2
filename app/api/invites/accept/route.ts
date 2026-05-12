import { NextResponse } from "next/server";
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const INVITE_ACCEPT_LIMIT_PER_10_MIN = 20;
const INVITE_ACCEPT_IP_LIMIT_PER_10_MIN = 40;
const INVITE_MAX_FAILED_ATTEMPTS = 10;

function normalizeEmail(e: string) {
  const email = String(e ?? "").trim().toLowerCase();
  const [localRaw, domainRaw] = email.split("@");
  if (!localRaw || !domainRaw) return email;

  const domain = domainRaw.toLowerCase();
  const localNoPlus = localRaw.split("+")[0];

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

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const { uid, email } = await requireAuth(req);
    if (!email) {
      return NextResponse.json(
        { error: "Email not available on account" },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const orgId = asNonEmptyString(body?.orgId);
    const inviteId = asNonEmptyString(body?.inviteId);
    const code = asNonEmptyString(body?.code);
    const name = asNonEmptyString(body?.name);
    const position = asNonEmptyString(body?.position);

    if (!orgId || !inviteId || !code || !name) {
      return NextResponse.json(
        { error: "Missing orgId, inviteId, code, or name" },
        { status: 400 },
      );
    }

    await enforceRateLimit({
      scope: "invites_accept_user",
      key: `${orgId}:${inviteId}:${uid}`,
      limit: INVITE_ACCEPT_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "invites_accept_ip",
      key: getRequestIp(req),
      limit: INVITE_ACCEPT_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const orgRef = adminDb.collection("organizations").doc(orgId);
    const inviteRef = orgRef.collection("invites").doc(inviteId);
    const snap = await inviteRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const invite = snap.data() as
      | {
          status?: unknown;
          expiresAt?: unknown;
          failedAttempts?: unknown;
          email?: unknown;
          codeHash?: unknown;
          createdBy?: unknown;
        }
      | undefined;
    const now = new Date();

    if (!invite) {
      return NextResponse.json({ error: "Invite payload missing" }, { status: 500 });
    }

    if (invite.status !== "pending") {
      return NextResponse.json(
        { error: `Invite is ${invite.status}` },
        { status: 400 },
      );
    }

    const expiresAt = toDate(invite?.expiresAt);
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      await inviteRef.set(
        {
          status: "expired",
          expiredAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
    }

    const failedAttempts = Number(invite?.failedAttempts ?? 0);
    if (failedAttempts >= INVITE_MAX_FAILED_ATTEMPTS) {
      return NextResponse.json(
        { error: "Invite is locked. Ask an admin to send a new one." },
        { status: 403 },
      );
    }

    const inviteEmailNorm = normalizeEmail(String(invite.email || ""));
    const userEmailNorm = normalizeEmail(String(email || ""));
    if (inviteEmailNorm !== userEmailNorm) {
      return NextResponse.json(
        { error: "Invite email does not match your account email" },
        { status: 403 },
      );
    }

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    if (codeHash !== String(invite.codeHash || "")) {
      const nextFailedAttempts = failedAttempts + 1;
      const shouldLock = nextFailedAttempts >= INVITE_MAX_FAILED_ATTEMPTS;

      await inviteRef.set(
        {
          failedAttempts: nextFailedAttempts,
          lastFailedAt: now,
          updatedAt: now,
          ...(shouldLock
            ? {
                status: "revoked",
                revokedReason: "too_many_failed_attempts",
                revokedAt: now,
              }
            : {}),
        },
        { merge: true },
      );

      return NextResponse.json(
        {
          error: shouldLock
            ? "Invite is locked due to too many failed attempts. Ask an admin for a new invite."
            : "Invalid access code",
        },
        { status: 403 },
      );
    }

    const batch = adminDb.batch();
    const memberRef = orgRef.collection("members").doc(uid);
    const userRef = adminDb.collection("users").doc(uid);
    const userMembershipRef = userRef.collection("memberships").doc(orgId);
    const [existingMemberSnap, existingMembershipSnap, orgSnap] = await Promise.all([
      memberRef.get(),
      userMembershipRef.get(),
      orgRef.get(),
    ]);
    const orgData = orgSnap.exists ? ((orgSnap.data() as Record<string, unknown>) ?? {}) : {};
    const orgName = typeof orgData?.name === "string" && orgData.name.trim()
      ? orgData.name
      : null;
    const inviteCreatedBy = asNonEmptyString(invite.createdBy) ?? uid;

    batch.set(
      memberRef,
      {
        uid,
        email,
        role: "editor",
        status: "active",
        name,
        position: position ?? null,
        ...(existingMemberSnap.exists ? {} : { createdAt: now, createdBy: inviteCreatedBy }),
        updatedAt: now,
      },
      { merge: true },
    );

    batch.set(
      userRef,
      {
        email,
        name,
        position: position ?? null,
        lastOrgId: orgId,
        updatedAt: now,
      },
      { merge: true },
    );

    batch.set(
      userMembershipRef,
      {
        orgId,
        role: "editor",
        status: "active",
        orgName,
        ...(existingMembershipSnap.exists ? {} : { createdAt: now }),
        updatedAt: now,
      },
      { merge: true },
    );

    batch.set(
      inviteRef,
      {
        status: "accepted",
        acceptedAt: now,
        acceptedBy: uid,
        failedAttempts: 0,
        updatedAt: now,
        codeHash: FieldValue.delete(),
      },
      { merge: true },
    );

    await batch.commit();

    return NextResponse.json({ ok: true, orgId });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }

    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
