// app/api/ai/handbook/section/generate/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { openai } from "@/lib/ai/openai";
import { BASE_TEMPLATES, type HandbookQuestion } from "@/lib/handbookTemplates";

export const runtime = "nodejs";

type ReqBody = {
  planId?: string;
  sectionKey?: string;

  // answers gathered from UI
  answers?: Record<string, string>;

  // Optional: pass the actual questions shown to the user.
  questions?: HandbookQuestion[];

  // optional: user prompt box input later
  userPrompt?: string;
};

type OrgDoc = {
  websiteConsent?: unknown;
  websiteUrl?: unknown;
  name?: unknown;
  mission?: unknown;
  homeState?: unknown;
  taxStatus?: unknown;
  fiscalYear?: unknown;
  crm?: unknown;
  address?: unknown;
  numEmployees?: unknown;
  foundedYear?: unknown;
};

type HandbookSection = {
  answers?: unknown;
  content?: unknown;
  aiQuestions?: unknown;
};

type PlanDoc = {
  data?: {
    handbook?: {
      sections?: Record<string, HandbookSection>;
      profile?: unknown;
    };
  };
};

function safeString(v: unknown) {
  return typeof v === "string" ? v : "";
}

function safeNumber(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hashText(input: string) {
  return crypto.createHash("sha256").update(input ?? "").digest("hex");
}

function normalizeAnswersLike(v: unknown) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, string>;
  return {};
}

function normalizeQuestionsLike(v: unknown) {
  if (!Array.isArray(v)) return undefined;
  const cleaned = v
    .filter((q) => q && typeof q.id === "string" && typeof q.label === "string")
    .map((q) => ({
      id: String(q.id).trim(),
      label: String(q.label).trim(),
      type:
        q.type === "textarea" || q.type === "select" || q.type === "multiselect" || q.type === "text" ? q.type : "text",
      options: Array.isArray(q.options) ? q.options.map(String) : undefined,
      placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
      required: typeof q.required === "boolean" ? q.required : true,
      helper: typeof q.helper === "string" ? q.helper : undefined,
    }))
    .filter((q) => q.id.length > 0 && q.label.length > 0);

  return cleaned.length ? (cleaned as HandbookQuestion[]) : undefined;
}

function pickOrgContext(org: OrgDoc | null | undefined) {
  const websiteConsent = Boolean(org?.websiteConsent);
  const websiteUrl = safeString(org?.websiteUrl).trim();

  return {
    orgName: safeString(org?.name).trim(),
    mission: safeString(org?.mission).trim(),
    homeState: safeString(org?.homeState).trim(),
    taxStatus: safeString(org?.taxStatus).trim(),
    fiscalYear: safeString(org?.fiscalYear).trim(),
    crm: safeString(org?.crm).trim(),
    address: safeString(org?.address).trim(),
    numEmployees: safeNumber(org?.numEmployees),
    foundedYear: safeNumber(org?.foundedYear),
    website: websiteConsent && websiteUrl ? { url: websiteUrl } : null,
  };
}

/**
 * In-text markers for UI-friendly highlighting:
 * - Any sentence that is inferred should be wrapped like:
 *   [[INFERRED]]...[[/INFERRED]]
 * This keeps the payload plain text (works in textarea) and lets you
 * later render highlights if you switch to rich text.
 */
const INFER_OPEN = "[[INFERRED]]";
const INFER_CLOSE = "[[/INFERRED]]";

/**
 * Definitions markers (to be extracted in pass 2):
 * - The model should write definitions as:
 *   [[DEF]]Term: Definition text...[[/DEF]]
 */
const DEF_OPEN = "[[DEF]]";
const DEF_CLOSE = "[[/DEF]]";

type Pass2Shape = { finalText: string };

export async function POST(req: Request) {
  try {
    const { orgId } = await requireOrgContext(req);

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const planId = safeString(body?.planId).trim();
    const sectionKey = safeString(body?.sectionKey).trim();

    if (!planId || !sectionKey) {
      return NextResponse.json({ ok: false, error: "Missing planId or sectionKey" }, { status: 400 });
    }

    const baseTemplate = BASE_TEMPLATES[sectionKey];
    if (!baseTemplate) {
      return NextResponse.json({ ok: false, error: `Unknown sectionKey: ${sectionKey}` }, { status: 400 });
    }

    const templateHash = hashText(baseTemplate);

    // Load org context
    const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
    if (!orgSnap.exists) {
      return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
    }
    const org = (orgSnap.data() ?? {}) as OrgDoc;
    const orgContext = pickOrgContext(org);

    // Load plan scoped to org
    const ref = adminDb.collection("organizations").doc(orgId).collection("plans").doc(planId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
    }

    const plan = (snap.data() ?? {}) as PlanDoc;
    const hb = plan?.data?.handbook ?? {};

    const section = hb?.sections?.[sectionKey] ?? {};
    const existingAnswers = normalizeAnswersLike(section?.answers);
    const incomingAnswers = normalizeAnswersLike(body?.answers);

    // Merge: Firestore-saved answers + incoming answers
    const mergedAnswers = { ...existingAnswers, ...incomingAnswers };

    const existingContent = safeString(section?.content);
    const userPrompt = safeString(body?.userPrompt).trim();

    // Questions help the model interpret answer meaning
    const incomingQuestions = normalizeQuestionsLike(body?.questions);
    const storedQuestions = normalizeQuestionsLike(section?.aiQuestions);
    const questions = incomingQuestions ?? storedQuestions;

    // Optional back-compat
    const legacyProfile = hb?.profile ?? null;

    /**
     * PASS 1: Generate a clean draft with:
     * - No markdown headings (#, ##, etc.)
     * - Clear subsection headers in plain text (Title Case on its own line)
     * - Definitions written ONLY as tagged items using [[DEF]] ... [[/DEF]]
     * - Any inferred sentence wrapped with [[INFERRED]]...[[/INFERRED]]
     */
    const system1 = `
You are a professional nonprofit fund development consultant writing ONE handbook section.

Goal:
- Rewrite the BASE TEMPLATE into final, polished, organization-specific policy text.

Formatting Rules (VERY IMPORTANT):
- DO NOT use markdown headings (#, ##, ###) or bullets that look like markdown.
- Use plain text subsection headers on their own line (Title Case), separated by blank lines.
- Keep paragraphs short and readable. Use simple bullet lists with "-" if helpful.
- Replace bracket placeholders like [Organization Name] with the org name when known.
- Integrate org context + answers naturally where they belong (do NOT output answers as a Q&A).

Definitions Handling (VERY IMPORTANT):
- Do NOT keep definitions inside the main body.
- When you need a definition, write it ONLY as a tagged definition line using:
  ${DEF_OPEN}Term: definition text${DEF_CLOSE}
- You may include multiple tagged definition lines.

Inference Highlighting (VERY IMPORTANT):
- If you must infer ANY detail that is not explicitly provided (e.g., role names, frequencies, tools, thresholds),
  wrap the entire inferred sentence with:
  ${INFER_OPEN} ... ${INFER_CLOSE}
- If required info is missing and you cannot infer responsibly, insert:
  [NEEDS INPUT: <what is missing>]
  (Do NOT wrap NEEDS INPUT with inferred markers.)

Guardrails:
- Do NOT invent legal facts, dollar thresholds, governance authorities, or compliance requirements.
- If user prompt says "not relevant", "skip", "ignore", "we don't do this", etc., omit that part.

Output:
- Output ONLY the draft section text (plain text).
`.trim();

    const user1 = `
SECTION KEY: ${sectionKey}

BASE TEMPLATE:
${baseTemplate}

ORG CONTEXT:
${JSON.stringify(orgContext, null, 2)}

${legacyProfile ? `LEGACY HANDBOOK PROFILE (may be outdated):
${JSON.stringify(legacyProfile, null, 2)}` : ""}

SECTION QUESTIONS (if available):
${questions ? JSON.stringify(questions, null, 2) : "(not provided)"}

SECTION ANSWERS (merged):
${JSON.stringify(mergedAnswers, null, 2)}

EXISTING SECTION CONTENT (if any):
${existingContent || "(none)"}

USER PROMPT (optional):
${userPrompt || "(none)"}
`.trim();

    const completion1 = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: system1 },
        { role: "user", content: user1 },
      ],
    });

    const draft = completion1.choices[0]?.message?.content ?? "";
    if (!draft.trim()) {
      return NextResponse.json({ ok: false, error: "AI returned empty content" }, { status: 502 });
    }

    /**
     * PASS 2: Clean + extract definitions into an appendix section at the bottom.
     * Also enforce "no markdown header symbols" again.
     *
     * Output is JSON for robustness, but API returns finalText as string like before.
     */
    const system2 = `
You are an editor. Transform the DRAFT into FINAL.

Requirements:
- Remove ALL tagged definition lines (${DEF_OPEN}...${DEF_CLOSE}) from the body.
- Create an appendix at the bottom titled exactly:
  Appendix: Definitions (${sectionKey})
- Under that appendix title, list each definition as:
  Term — definition
- If there are no definitions, omit the appendix entirely.

Formatting:
- Ensure there are NO markdown heading symbols (#, ##, ###) anywhere.
- Keep subsection headers as plain text lines.
- Preserve inference markers exactly (${INFER_OPEN}...${INFER_CLOSE}) as they appear.
- Do not add new inferred markers; only keep or remove definitions/format.

Return ONLY valid JSON:
{ "finalText": "..." }
`.trim();

    const user2 = `
DRAFT:
${draft}
`.trim();

    const completion2 = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.0,
      messages: [
        { role: "system", content: system2 },
        { role: "user", content: user2 },
      ],
      response_format: { type: "json_object" },
    });

    const text2 = completion2.choices[0]?.message?.content ?? "{}";

    let parsed2: Pass2Shape | null = null;
    try {
      parsed2 = JSON.parse(text2);
    } catch {
      return NextResponse.json(
        { ok: false, error: "AI returned non-JSON output in formatting pass", raw: text2 },
        { status: 502 }
      );
    }

    const finalText = safeString(parsed2?.finalText).trim();
    if (!finalText) {
      return NextResponse.json({ ok: false, error: "AI returned empty formatted content" }, { status: 502 });
    }

    // Extra tiny safety: strip any accidental markdown heading prefix at line starts
    const noMarkdownHeaders = finalText
      .split("\n")
      .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/g, ""))
      .join("\n")
      .trim();

    return NextResponse.json({
      ok: true,
      planId,
      sectionKey,
      templateHash,
      generatedAt: new Date().toISOString(),
      draftContent: noMarkdownHeaders,
    });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}





// // app/api/ai/handbook/section/generate/route.ts
// import { NextResponse } from "next/server";
// import crypto from "crypto";
// import { adminDb } from "@/lib/firebaseAdmin";
// import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
// import { openai } from "@/lib/ai/openai";
// import { BASE_TEMPLATES, HandbookQuestion } from "@/lib/handbookTemplates";

// export const runtime = "nodejs";

// type ReqBody = {
//   planId?: string;
//   sectionKey?: string;

//   // answers gathered from UI (AI-generated questions only in end-state)
//   answers?: Record<string, string>;

//   // Optional: pass the actual questions shown to the user.
//   questions?: HandbookQuestion[];

//   // optional: user prompt box input later
//   userPrompt?: string;
// };

// function safeString(v: any) {
//   return typeof v === "string" ? v : "";
// }

// function safeNumber(v: any) {
//   return typeof v === "number" && Number.isFinite(v) ? v : null;
// }

// function hashText(input: string) {
//   return crypto.createHash("sha256").update(input ?? "").digest("hex");
// }

// function normalizeAnswersLike(v: any) {
//   if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, string>;
//   return {};
// }

// function normalizeQuestionsLike(v: any) {
//   if (!Array.isArray(v)) return undefined;
//   const cleaned = v
//     .filter((q) => q && typeof q.id === "string" && typeof q.label === "string")
//     .map((q) => ({
//       id: String(q.id).trim(),
//       label: String(q.label).trim(),
//       type: q.type === "textarea" || q.type === "select" || q.type === "text" ? q.type : "text",
//       options: Array.isArray(q.options) ? q.options.map(String) : undefined,
//       placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
//       required: typeof q.required === "boolean" ? q.required : true,
//     }))
//     .filter((q) => q.id.length > 0 && q.label.length > 0);

//   return cleaned.length ? (cleaned as HandbookQuestion[]) : undefined;
// }

// function pickOrgContext(org: any) {
//   const websiteConsent = Boolean(org?.websiteConsent);
//   const websiteUrl = safeString(org?.websiteUrl).trim();

//   return {
//     orgName: safeString(org?.name).trim(),
//     mission: safeString(org?.mission).trim(),
//     homeState: safeString(org?.homeState).trim(),
//     taxStatus: safeString(org?.taxStatus).trim(),
//     fiscalYear: safeString(org?.fiscalYear).trim(),
//     crm: safeString(org?.crm).trim(),
//     address: safeString(org?.address).trim(),
//     numEmployees: safeNumber(org?.numEmployees),
//     foundedYear: safeNumber(org?.foundedYear),
//     website: websiteConsent && websiteUrl ? { url: websiteUrl } : null,
//   };
// }

// export async function POST(req: Request) {
//   try {
//     const { orgId } = await requireOrgContext(req);

//     const body = (await req.json().catch(() => ({}))) as ReqBody;
//     const planId = safeString(body?.planId).trim();
//     const sectionKey = safeString(body?.sectionKey).trim();

//     if (!planId || !sectionKey) {
//       return NextResponse.json({ ok: false, error: "Missing planId or sectionKey" }, { status: 400 });
//     }

//     const baseTemplate = BASE_TEMPLATES[sectionKey];
//     if (!baseTemplate) {
//       return NextResponse.json({ ok: false, error: `Unknown sectionKey: ${sectionKey}` }, { status: 400 });
//     }

//     const templateHash = hashText(baseTemplate);

//     // ✅ Load org context from organizations/{orgId}
//     const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
//     if (!orgSnap.exists) {
//       return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
//     }
//     const org = orgSnap.data() as any;
//     const orgContext = pickOrgContext(org);

//     // ✅ Load plan scoped to org
//     const ref = adminDb.collection("organizations").doc(orgId).collection("plans").doc(planId);
//     const snap = await ref.get();
//     if (!snap.exists) {
//       return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
//     }

//     const plan = snap.data() as any;
//     const hb = plan?.data?.handbook ?? {};

//     const section = hb?.sections?.[sectionKey] ?? {};
//     const existingAnswers = normalizeAnswersLike(section?.answers);
//     const incomingAnswers = normalizeAnswersLike(body?.answers);

//     // Merge: Firestore-saved answers + incoming answers
//     const mergedAnswers = { ...existingAnswers, ...incomingAnswers };

//     const existingContent = safeString(section?.content);
//     const userPrompt = safeString(body?.userPrompt).trim();

//     // Recommended: questions help the model interpret answer meaning
//     const incomingQuestions = normalizeQuestionsLike(body?.questions);
//     const storedQuestions = normalizeQuestionsLike(section?.aiQuestions);
//     const questions = incomingQuestions ?? storedQuestions;

//     // Optional back-compat: old plans may have handbook.profile
//     const legacyProfile = hb?.profile ?? null;

//     const system = `
// You are a professional nonprofit fund development consultant writing a Fund Development Handbook section.

// Task:
// - Rewrite the BASE TEMPLATE into final, polished, organization-specific policy text.

// Rules:
// - Preserve the BASE TEMPLATE structure (headings/order) unless a small change improves clarity.
// - Replace bracket placeholders like [Organization Name] with the org name when known.
// - Integrate the provided org context + answers naturally where they belong (do NOT output answers as a Q&A).
// - Maintain a professional, clear, and accessible tone suitable for nonprofit staff and board members.
// - Do NOT invent legal facts, thresholds, or governance details. If required info is missing, insert a short placeholder like:
//   [NEEDS INPUT: <what is missing>]
// - If the user prompt says "not relevant", "skip", "ignore", "we don't do this", etc., then skip that part in the generation.
// - Keep formatting readable (short headings, paragraphs, bullets where appropriate).
// - Output ONLY the final section text. No commentary, no JSON.

// If USER PROMPT is provided, incorporate it only if it fits this section and maintains a professional tone.
// `.trim();

//     const user = `
// SECTION KEY: ${sectionKey}

// BASE TEMPLATE:
// ${baseTemplate}

// ORG CONTEXT (from onboarding / org workspace):
// ${JSON.stringify(orgContext, null, 2)}

// ${legacyProfile ? `LEGACY HANDBOOK PROFILE (back-compat; may be incomplete/outdated):
// ${JSON.stringify(legacyProfile, null, 2)}` : ""}

// SECTION QUESTIONS (if available):
// ${questions ? JSON.stringify(questions, null, 2) : "(not provided)"}

// SECTION ANSWERS (merged):
// ${JSON.stringify(mergedAnswers, null, 2)}

// EXISTING SECTION CONTENT (if any):
// ${existingContent || "(none)"}

// USER PROMPT (optional):
// ${userPrompt || "(none)"}
// `.trim();

//     const completion = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       temperature: 0.25,
//       messages: [
//         { role: "system", content: system },
//         { role: "user", content: user },
//       ],
//     });

//     const draftContent = completion.choices[0]?.message?.content ?? "";

//     if (!draftContent.trim()) {
//       return NextResponse.json({ ok: false, error: "AI returned empty content" }, { status: 502 });
//     }

//     return NextResponse.json({
//       ok: true,
//       planId,
//       sectionKey,
//       templateHash,
//       generatedAt: new Date().toISOString(),
//       draftContent,
//     });
//   } catch (err: any) {
//     const { status, message } = errorToResponse(err);
//     return NextResponse.json({ ok: false, error: message }, { status });
//   }
// }


