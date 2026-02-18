import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";

const INVITE_DETAILS_LIMIT_PER_10_MIN = 80;

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

/**
 * GET /api/invites/details?orgId=...&inviteId=...
 *
 * Public endpoint for invite landing page.
 * Returns invite metadata for the invite landing page.
 */
export async function GET(req: Request) {
  try {
    await enforceRateLimit({
      scope: "invites_details_ip",
      key: getRequestIp(req),
      limit: INVITE_DETAILS_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const orgId = (searchParams.get("orgId") || "").trim();
    const inviteId = (searchParams.get("inviteId") || "").trim();

    if (!orgId || !inviteId) {
      return NextResponse.json(
        { error: "Missing orgId or inviteId" },
        { status: 400 },
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

    const invite = snap.data() as {
      status?: unknown;
      expiresAt?: unknown;
    } | undefined;
    let status = String(invite?.status ?? "");

    const expiresAt = toDate(invite?.expiresAt);
    const isExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());

    if (status === "pending" && isExpired) {
      status = "expired";
      await inviteRef.set(
        {
          status: "expired",
          expiredAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true },
      );
    }

    return NextResponse.json({
      ok: true,
      orgId,
      inviteId,
      orgName: null,
      inviteEmail: null,
      status: status || null,
    });
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
