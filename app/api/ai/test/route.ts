import { NextResponse } from "next/server";
import { openai } from "@/lib/ai/openai";

export const runtime = "nodejs";

export async function GET() {
  try {
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
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
