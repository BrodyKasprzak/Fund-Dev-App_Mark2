import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resend, requireResendEnv } from "@/lib/resend";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const REQUESTS_PER_EMAIL_PER_HOUR = 3;
const REQUESTS_PER_IP_PER_HOUR = 20;
const GENERIC_MESSAGE =
  "If an account exists for that email, we sent a link to reset the password.";

function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicResponse() {
  return NextResponse.json(
    { ok: true, message: GENERIC_MESSAGE },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function passwordResetEmailHtml(resetUrl: string) {
  return `
    <div style="margin:0;background:#f1f5f9;padding:32px 16px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.6">
      <div style="margin:0 auto;max-width:520px;border:1px solid #e2e8f0;border-radius:20px;background:#ffffff;padding:32px;box-shadow:0 12px 30px rgba(15,23,42,.08)">
        <div style="display:inline-block;border:1px solid #e2e8f0;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475569">
          PurposeFramework
        </div>
        <h1 style="margin:24px 0 8px;font-size:26px;line-height:1.25">Reset your password</h1>
        <p style="margin:0;color:#475569;font-size:15px">
          We received a request to reset the password for your account. Use the button below to choose a new one.
        </p>
        <p style="margin:28px 0">
          <a href="${resetUrl}" style="display:inline-block;border-radius:12px;background:#0f172a;padding:12px 20px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">
            Reset password
          </a>
        </p>
        <p style="margin:0;color:#64748b;font-size:13px">
          This link can only be used once. If you did not request a password reset, you can safely ignore this email.
        </p>
      </div>
    </div>
  `;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await enforceRateLimit({
      scope: "password_reset_email",
      key: email,
      limit: REQUESTS_PER_EMAIL_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "password_reset_ip",
      key: getRequestIp(req),
      limit: REQUESTS_PER_IP_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Too many reset requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(error.retryAfterSeconds),
          },
        },
      );
    }

    console.error("Password reset rate limit failed", error);
    return NextResponse.json(
      { error: "We could not process that request. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    requireResendEnv();
    await adminAuth.getUserByEmail(email);

    const firebaseLink = await adminAuth.generatePasswordResetLink(email);
    const code = new URL(firebaseLink).searchParams.get("oobCode");
    if (!code) throw new Error("Firebase did not return a password reset code");

    const appBaseUrl = process.env.APP_BASE_URL!.replace(/\/+$/, "");
    const resetUrl = `${appBaseUrl}/reset-password?oobCode=${encodeURIComponent(code)}`;
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM!,
      to: email,
      subject: "Reset your PurposeFramework password",
      html: passwordResetEmailHtml(resetUrl),
      text: `Reset your PurposeFramework password\n\nOpen this secure link to choose a new password:\n${resetUrl}\n\nThis link can only be used once. If you did not request a password reset, you can ignore this email.`,
    });

    if (result.error) throw new Error(result.error.message);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";

    // The response is deliberately identical for missing accounts and delivery errors.
    // This prevents the endpoint from being used to discover registered email addresses.
    if (code !== "auth/user-not-found") {
      console.error("Password reset email failed", error);
    }
  }

  return publicResponse();
}
