import { NextResponse } from "next/server";
import { openai } from "@/lib/ai/openai";
import { requireAdmin, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";

const AI_TEST_LIMIT_PER_10_MIN = 10;

export async function GET(req: Request) {
  try {
    if (process.env.ENABLE_AI_TEST_ENDPOINT !== "true") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { orgId, uid } = await requireAdmin(req);

    await enforceRateLimit({
      scope: "ai_test_endpoint",
      key: `${orgId}:${uid}`,
      limit: AI_TEST_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: "Say hello in one sentence.",
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      text: res.choices[0]?.message?.content,
    });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }

    const { status, message } = errorToResponse(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
