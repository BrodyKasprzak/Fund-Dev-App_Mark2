import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext } from "@/lib/serverAuth";
import { resend, requireResendEnv } from "@/lib/resend";

export const runtime = "nodejs"; // ensure Node runtime (not Edge)

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */

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
    <h2>You’ve been invited to join ${orgName ?? "an organization"}</h2>

    <p>
      ${inviterEmail ? `${inviterEmail} has invited you` : "You’ve been invited"}
      to join their organization on Purpose Framework.
    </p>

    <p><strong>Step 1:</strong> Open this link:</p>
    <p><a href="${link}">${link}</a></p>

    <p><strong>Step 2:</strong> Enter this access code:</p>
    <p style="font-size: 18px; font-weight: bold; letter-spacing: 0.5px;">
      ${code}
    </p>

    <p style="font-size: 12px; color: #555;">
      If you didn’t expect this invitation, you can safely ignore this email.
    </p>
  </div>
  `;
}

/* ---------------------------------------------------------
   Route
--------------------------------------------------------- */

export async function POST(req: Request) {
  try {
    // Ensure required env vars exist
    requireResendEnv();

    console.log("INVITES CREATE ENV CHECK:", {
      hasResendKey: Boolean(process.env.RESEND_API_KEY),
      resendFrom: process.env.RESEND_FROM,
      appBaseUrl: process.env.APP_BASE_URL,
    });

    const { uid, orgId, role, email: inviterEmail } =
      await requireOrgContext(req);

    if (role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await req.json();
    const emailsRaw: unknown = body?.emails;

    if (!Array.isArray(emailsRaw) || emailsRaw.length === 0) {
      return NextResponse.json(
        { error: "emails must be a non-empty array" },
        { status: 400 }
      );
    }

    // Normalize & dedupe emails
    const emails = [
      ...new Set(
        emailsRaw
          .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
          .filter(Boolean)
      ),
    ];

    const invalid = emails.filter((e) => !isValidEmail(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid email(s): ${invalid.join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch org name (for nicer email copy)
    const orgSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .get();

    const orgName = orgSnap.exists
      ? (orgSnap.data() as any)?.name
      : undefined;

    const created: Array<{ inviteId: string; email: string }> = [];

    /* -----------------------------------------------------
       Create + send each invite
    ----------------------------------------------------- */

    for (const inviteeEmail of emails) {
      // Generate secure access code
      const rawCode = crypto.randomBytes(16).toString("hex");
      const codeHash = crypto
        .createHash("sha256")
        .update(rawCode)
        .digest("hex");

      const inviteRef = adminDb
        .collection("organizations")
        .doc(orgId)
        .collection("invites")
        .doc();

      await inviteRef.set({
        email: inviteeEmail,
        codeHash,
        status: "pending", // pending | accepted | revoked | expired
        createdAt: new Date(),
        createdBy: uid,
      });

      const link = `${process.env.APP_BASE_URL}/invite?orgId=${encodeURIComponent(
        orgId
      )}&inviteId=${encodeURIComponent(inviteRef.id)}`;

      const text = `You’ve been invited to join ${
        orgName ?? "an organization"
      }.

Open this link:
${link}

Access code:
${rawCode}

If you didn’t expect this invitation, you can ignore this email.`;

      const result = await resend.emails.send({
        from: process.env.RESEND_FROM!,
        to: inviteeEmail,
        subject: "Purpose Framework invite — action required",
        html: inviteEmailHtml({
          orgName,
          inviterEmail,
          link,
          code: rawCode,
        }),
        text,
      });

      if (result?.error) {
        console.error("RESEND ERROR:", result.error);

        // Clean up failed invite
        await inviteRef.delete();

        return NextResponse.json(
          {
            error: result.error.message ?? "Failed to send invite email",
            details: result.error,
          },
          { status: 502 }
        );
      }

      created.push({ inviteId: inviteRef.id, email: inviteeEmail });
    }

    return NextResponse.json({ ok: true, created });
  } catch (err: any) {
    console.error("invites/create route error:", err);
    return NextResponse.json(
      { error: err.message ?? "Server error" },
      { status: 500 }
    );
  }
}
