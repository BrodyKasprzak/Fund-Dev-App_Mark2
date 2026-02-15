import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdmin, errorToResponse } from "@/lib/serverAuth";
import { resend, requireResendEnv } from "@/lib/resend";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const INVITE_EXPIRY_DAYS = 14;
const MAX_INVITES_PER_REQUEST = 25;
const INVITES_CREATE_LIMIT_PER_HOUR = 30;
const INVITES_CREATE_IP_LIMIT_PER_HOUR = 120;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function inviteEmailHtml(opts: {
  orgName?: string;
  inviterEmail?: string | null;
  link: string;
  code: string;
}) {
  const { orgName, inviterEmail, link, code } = opts;

  return `
  <div style="font-family: ui-sans-serif, system-ui, Arial; line-height: 1.5;">
    <h2>You've been invited to join ${orgName ?? "an organization"}</h2>

    <p>
      ${inviterEmail ? `${inviterEmail} has invited you` : "You've been invited"}
      to join their organization on Purpose Framework.
    </p>

    <p><strong>Step 1:</strong> Open this link:</p>
    <p><a href="${link}">${link}</a></p>

    <p><strong>Step 2:</strong> Enter this access code:</p>
    <p style="font-size: 18px; font-weight: bold; letter-spacing: 0.5px;">
      ${code}
    </p>

    <p style="font-size: 12px; color: #555;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>
  `;
}

export async function POST(req: Request) {
  try {
    requireResendEnv();

    const { uid, orgId, email: inviterEmail } = await requireAdmin(req);

    await enforceRateLimit({
      scope: "invites_create_user",
      key: `${orgId}:${uid}`,
      limit: INVITES_CREATE_LIMIT_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "invites_create_ip",
      key: getRequestIp(req),
      limit: INVITES_CREATE_IP_LIMIT_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });

    const body = await req.json().catch(() => ({}));
    const emailsRaw: unknown = body?.emails;

    if (!Array.isArray(emailsRaw) || emailsRaw.length === 0) {
      return NextResponse.json(
        { error: "emails must be a non-empty array" },
        { status: 400 },
      );
    }

    const emails = [
      ...new Set(
        emailsRaw
          .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
          .filter(Boolean),
      ),
    ];

    if (emails.length > MAX_INVITES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many emails. Max ${MAX_INVITES_PER_REQUEST} per request.` },
        { status: 400 },
      );
    }

    const invalid = emails.filter((e) => !isValidEmail(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid email(s): ${invalid.join(", ")}` },
        { status: 400 },
      );
    }

    const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
    const orgData = orgSnap.data() as { name?: unknown } | undefined;
    const orgName =
      orgSnap.exists && typeof orgData?.name === "string" ? orgData.name : undefined;

    const created: Array<{ inviteId: string; email: string }> = [];
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    for (const inviteeEmail of emails) {
      const rawCode = crypto.randomBytes(16).toString("hex");
      const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");

      const inviteRef = adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("invites")
        .doc();

      await inviteRef.set({
        email: inviteeEmail,
        codeHash,
        status: "pending",
        failedAttempts: 0,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        createdBy: uid,
      });

      const link = `${process.env.APP_BASE_URL}/invite?orgId=${encodeURIComponent(
        orgId,
      )}&inviteId=${encodeURIComponent(inviteRef.id)}`;

      const text = `You've been invited to join ${
        orgName ?? "an organization"
      }.

Open this link:
${link}

Access code:
${rawCode}

This invite expires on ${expiresAt.toISOString().slice(0, 10)}.

If you didn't expect this invitation, you can ignore this email.`;

      const result = await resend.emails.send({
        from: process.env.RESEND_FROM!,
        to: inviteeEmail,
        subject: "Purpose Framework invite - action required",
        html: inviteEmailHtml({
          orgName,
          inviterEmail,
          link,
          code: rawCode,
        }),
        text,
      });

      if (result?.error) {
        await inviteRef.delete();
        return NextResponse.json(
          { error: "Failed to send invite email" },
          { status: 502 },
        );
      }

      created.push({ inviteId: inviteRef.id, email: inviteeEmail });
    }

    return NextResponse.json({ ok: true, created });
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
