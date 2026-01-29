// app/api/ai/handbook/section/questions/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { openai } from "@/lib/ai/openai";
import { BASE_TEMPLATES, type HandbookQuestion } from "@/lib/handbookTemplates";
import { HANDBOOK_BLUEPRINTS } from "@/lib/handbookBlueprints";

export const runtime = "nodejs";

type ReqBody = {
  planId?: string;
  sectionKey?: string;
  maxQuestions?: number; // optional knob from client
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

function normalizeAnswers(section: any) {
  const a = section?.answers;
  if (a && typeof a === "object" && !Array.isArray(a)) return a as Record<string, string>;
  return {};
}

function pickOrgContext(org: any) {
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

function clampMaxQuestions(raw: unknown, fallback: number) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.max(n, 1), 10);
  return fallback;
}

function bestMatchOption(value: string, options?: string[]) {
  const v = String(value || "").trim();
  if (!v || !Array.isArray(options) || options.length === 0) return null;

  const direct = options.find((o) => o.toLowerCase() === v.toLowerCase());
  if (direct) return direct;

  const contains = options.find((o) => v.toLowerCase().includes(String(o).toLowerCase()));
  if (contains) return contains;

  return null;
}

/**
 * Pre-fill answers using orgContext (and/or other strong signals),
 * so the server can skip questions we already know.
 * IMPORTANT: Only prefill fields you’re truly confident about.
 */
function prefillFromOrgContext(
  sectionKey: string,
  orgContext: any,
  blueprint?: { fields?: any[] }
): Record<string, string> {
  const prefilled: Record<string, string> = {};
  if (!blueprint?.fields?.length) return prefilled;

  // ✅ s6_processing: CRM system often already known from org onboarding (orgContext.crm)
  if (sectionKey === "s6_processing") {
    const crm = String(orgContext?.crm ?? "").trim();
    const field = blueprint.fields.find((f: any) => f.id === "primary_gift_processing_system");

    if (crm && field) {
      const match = bestMatchOption(crm, field.options);
      if (match) {
        prefilled[field.id] = match;
      } else if (Array.isArray(field.options) && field.options.includes("Other")) {
        prefilled[field.id] = "Other";
        prefilled[`${field.id}__other`] = crm;
      }
    }
  }

  return prefilled;
}

function hasOtherOption(question: HandbookQuestion) {
  return Array.isArray(question.options) && question.options.includes("Other");
}

/**
 * Decide whether a given question id is already answered based on effective answers.
 * - For "Other", require the companion `${id}__other` text.
 * - For multiselect stored as JSON array string: treat non-empty array as answered.
 */
function isAnswered(id: string, effectiveAnswers: Record<string, string>, question?: HandbookQuestion) {
  const raw = String(effectiveAnswers[id] ?? "").trim();
  if (!raw) return false;

  const otherKey = `${id}__other`;
  const otherText = String(effectiveAnswers[otherKey] ?? "").trim();

  if (question?.type === "multiselect") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (hasOtherOption(question) && parsed.map(String).includes("Other")) return otherText.length > 0;
        return true;
      }
      return false;
    } catch {
      const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (parts.length === 0) return false;
      if (hasOtherOption(question) && parts.includes("Other")) return otherText.length > 0;
      return true;
    }
  }

  if (hasOtherOption(question ?? ({ options: [] } as any)) && raw === "Other") {
    return otherText.length > 0;
  }

  return true;
}

function toCanonicalQuestion(field: any): HandbookQuestion {
  const type =
    field?.type === "textarea" || field?.type === "select" || field?.type === "multiselect" || field?.type === "text"
      ? field.type
      : "text";

  return {
    id: String(field.id),
    label: String(field.label),
    helper: typeof field.helper === "string" ? field.helper : undefined,
    placeholder: typeof field.placeholder === "string" ? field.placeholder : undefined,
    type,
    options: Array.isArray(field.options) ? field.options.map(String) : undefined,
    required: typeof field.required === "boolean" ? field.required : true,
  };
}

function sortByPriority(fields: any[]) {
  const rank = (p: any) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
  return [...fields].sort((a, b) => rank(a.priority) - rank(b.priority));
}

/**
 * Robust approach:
 * - If blueprint exists: model returns ONLY IDs (selection), server maps IDs -> canonical questions.
 * - If no blueprint: model generates full questions (legacy fallback).
 */
async function selectBlueprintIdsWithAI(args: {
  sectionKey: string;
  intent?: string;
  maxQuestions: number;
  baseTemplate: string;
  orgContext: any;
  effectiveAnswers: Record<string, string>;
  existingContent: string;
  candidates: Array<{ id: string; label: string; helper?: string }>;
}) {
  const { sectionKey, intent, maxQuestions, baseTemplate, orgContext, effectiveAnswers, existingContent, candidates } =
    args;

  const system = `
Return ONLY JSON:
{ "ids": ["question_id_1", "question_id_2"] }

Rules:
- Choose only from the provided CANDIDATES.
- Max ${maxQuestions} ids.
- Skip anything already answered (see EFFECTIVE_ANSWERS) or clearly covered in EXISTING_SECTION_CONTENT.
- Prefer the minimum set needed to customize THIS section.
- If nothing is needed, return { "ids": [] }.
`.trim();

  const user = `
SECTION KEY: ${sectionKey}
SECTION INTENT: ${intent || "(none)"}

BASE TEMPLATE:
${baseTemplate}

ORG CONTEXT:
${JSON.stringify(orgContext, null, 2)}

EFFECTIVE ANSWERS:
${JSON.stringify(effectiveAnswers, null, 2)}

EXISTING SECTION CONTENT:
${existingContent || "(none)"}

CANDIDATES:
${JSON.stringify(candidates, null, 2)}
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(text);
    const idsRaw = Array.isArray(parsed?.ids) ? parsed.ids : [];
    const ids = idsRaw.map(String).map((s: string) => s.trim()).filter(Boolean);
    return Array.from(new Set(ids)).slice(0, maxQuestions);
  } catch {
    return null;
  }
}

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
    const blueprint = HANDBOOK_BLUEPRINTS[sectionKey];

    const defaultMax = blueprint ? 10 : 6;
    const maxQuestions = clampMaxQuestions(body?.maxQuestions, defaultMax);

    // Load org context
    const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
    if (!orgSnap.exists) {
      return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
    }
    const orgContext = pickOrgContext(orgSnap.data() as any);

    // Load plan scoped to org
    const ref = adminDb.collection("organizations").doc(orgId).collection("plans").doc(planId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
    }

    const plan = snap.data() as any;
    const hb = plan?.data?.handbook ?? {};
    const section = hb?.sections?.[sectionKey] ?? {};
    const existingAnswers = normalizeAnswers(section);
    const existingContent = safeString(section?.content);

    // Optional back-compat
    const legacyProfile = hb?.profile ?? null;

    // Prefill (confident-only) + merge
    const prefilled = prefillFromOrgContext(sectionKey, orgContext, blueprint as any);
    const effectiveAnswers: Record<string, string> = { ...prefilled, ...existingAnswers };

    // ✅ Blueprint-backed sections: server canonical questions + AI selects IDs only
    if (blueprint?.fields?.length) {
      const sorted = sortByPriority(blueprint.fields);
      const canonicalAll = sorted.map(toCanonicalQuestion);

      // Skip already answered
      const unanswered = canonicalAll.filter((q) => !isAnswered(q.id, effectiveAnswers, q));
      if (unanswered.length === 0) {
        return NextResponse.json({
          ok: true,
          planId,
          sectionKey,
          templateHash,
          questionsGeneratedAt: new Date().toISOString(),
          questions: [],
        });
      }

      // Optional: AI chooses minimum IDs (more robust than generating question objects)
      const candidates = unanswered.map((q) => ({ id: q.id, label: q.label, helper: q.helper }));
      const chosenIds = await selectBlueprintIdsWithAI({
        sectionKey,
        intent: blueprint.intent,
        maxQuestions,
        baseTemplate,
        orgContext,
        effectiveAnswers,
        existingContent,
        candidates,
      });

      // Fallback: first N by priority
      const finalQuestions = (chosenIds ? unanswered.filter((q) => chosenIds.includes(q.id)) : unanswered).slice(
        0,
        maxQuestions
      );

      return NextResponse.json({
        ok: true,
        planId,
        sectionKey,
        templateHash,
        questionsGeneratedAt: new Date().toISOString(),
        questions: finalQuestions,
      });
    }

    // ✅ No blueprint: legacy AI generates full questions
    const system = `
You generate the MINIMUM set of clarification questions needed to customize THIS nonprofit Fund Development Handbook section.

Rules:
- Ask ONLY for information required to customize THIS section.
- Max ${maxQuestions} questions.
- Do NOT ask for anything already present in org context, existing answers, or existing section content.
- Avoid duplicates and overlapping questions (merge them).
- Questions must be operational and answerable by staff.
- If the section can be written with current info, return {"questions": []}.
- Return ONLY valid JSON matching the schema.

Schema:
{
  "questions": [
    {
      "id": "string_snake_case",
      "label": "string",
      "type": "text" | "textarea" | "select" | "multiselect",
      "options": ["string"],
      "placeholder": "string",
      "helper": "string",
      "required": true
    }
  ]
}
`.trim();

    const user = `
SECTION KEY: ${sectionKey}

BASE TEMPLATE:
${baseTemplate}

ORG CONTEXT:
${JSON.stringify(orgContext, null, 2)}

${legacyProfile ? `LEGACY HANDBOOK PROFILE (may be outdated):
${JSON.stringify(legacyProfile, null, 2)}` : ""}

EFFECTIVE ANSWERS (prefilled from org context + saved answers):
${JSON.stringify(effectiveAnswers, null, 2)}

EXISTING SECTION CONTENT:
${existingContent || "(none)"}
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content ?? "{}";

    let parsed: { questions?: HandbookQuestion[] } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "AI returned non-JSON output", raw: text }, { status: 502 });
    }

    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    if (questions.length > maxQuestions) {
      return NextResponse.json({ ok: false, error: "AI returned too many questions", questions }, { status: 502 });
    }

    // Minimal shape cleanup + de-dupe + skip answered
    let cleaned: HandbookQuestion[] = questions
      .filter((q: any) => q && typeof q.id === "string" && typeof q.label === "string")
      .map((q: any) => ({
        id: String(q.id).trim(),
        label: String(q.label).trim(),
        helper: typeof q.helper === "string" ? q.helper : undefined,
        type:
          q.type === "textarea" || q.type === "select" || q.type === "multiselect" || q.type === "text"
            ? q.type
            : "text",
        options: Array.isArray(q.options) ? q.options.map(String) : undefined,
        placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
        required: typeof q.required === "boolean" ? q.required : true,
      }))
      .filter((q) => q.id.length > 0 && q.label.length > 0)
      .filter((q, idx, arr) => arr.findIndex((x) => x.id === q.id) === idx);

    cleaned = cleaned.filter((q) => !isAnswered(q.id, effectiveAnswers, q));

    return NextResponse.json({
      ok: true,
      planId,
      sectionKey,
      templateHash,
      questionsGeneratedAt: new Date().toISOString(),
      questions: cleaned,
    });
  } catch (err: any) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}





// // app/api/ai/handbook/section/questions/route.ts
// import { NextResponse } from "next/server";
// import crypto from "crypto";
// import { adminDb } from "@/lib/firebaseAdmin";
// import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
// import { openai } from "@/lib/ai/openai";
// import { BASE_TEMPLATES, HandbookQuestion } from "@/lib/handbookTemplates";
// import { HANDBOOK_BLUEPRINTS } from "@/lib/handbookBlueprints";

// export const runtime = "nodejs";

// type ReqBody = {
//   planId?: string;
//   sectionKey?: string;
//   // optional knob from client
//   maxQuestions?: number;
// };

// type AIQuestionsResponse = {
//   questions: HandbookQuestion[];
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

// function normalizeAnswers(section: any) {
//   const a = section?.answers;
//   if (a && typeof a === "object" && !Array.isArray(a)) return a as Record<string, string>;
//   return {};
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

// function bestMatchOption(value: string, options?: string[]) {
//   const v = String(value || "").trim();
//   if (!v || !Array.isArray(options) || options.length === 0) return null;

//   const direct = options.find((o) => o.toLowerCase() === v.toLowerCase());
//   if (direct) return direct;

//   // small heuristic: contains match (handles e.g. "Neon" vs "Neon CRM")
//   const contains = options.find((o) => v.toLowerCase().includes(o.toLowerCase()));
//   if (contains) return contains;

//   return null;
// }

// /**
//  * Pre-fill answers using orgContext (and/or other strong signals),
//  * so the AI and the server can skip questions we already know.
//  *
//  * IMPORTANT: This should only fill fields you are truly confident about.
//  */
// function prefillFromOrgContext(sectionKey: string, orgContext: any, blueprint?: any): Record<string, string> {
//   const prefilled: Record<string, string> = {};
//   if (!blueprint) return prefilled;

//   // ✅ s6_processing: CRM system often already known from org onboarding (orgContext.crm)
//   if (sectionKey === "s6_processing") {
//     const crm = String(orgContext?.crm ?? "").trim();
//     const field = blueprint.fields?.find((f: any) => f.id === "primary_gift_processing_system");

//     if (crm && field) {
//       const match = bestMatchOption(crm, field.options);
//       if (match) {
//         prefilled["primary_gift_processing_system"] = match;
//       } else if (Array.isArray(field.options) && field.options.includes("Other")) {
//         // If CRM isn't in options, set Other + details (so UI can show the "please specify" box)
//         prefilled["primary_gift_processing_system"] = "Other";
//         prefilled["primary_gift_processing_system__other"] = crm;
//       }
//     }
//   }

//   return prefilled;
// }

// function hasOtherOption(question: HandbookQuestion) {
//   return Array.isArray(question.options) && question.options.includes("Other");
// }

// /**
//  * Decide whether a given question id is "already answered" based on effective answers.
//  * - For "Other", require the companion `${id}__other` text.
//  * - For multiselect stored as JSON array string: treat non-empty array as answered.
//  */
// function isAnswered(id: string, effectiveAnswers: Record<string, string>, question?: HandbookQuestion) {
//   const raw = String(effectiveAnswers[id] ?? "").trim();
//   if (!raw) return false;

//   const otherKey = `${id}__other`;
//   const otherText = String(effectiveAnswers[otherKey] ?? "").trim();

//   if (question?.type === "multiselect") {
//     // stored as JSON array string OR fallback comma-separated
//     try {
//       const parsed = JSON.parse(raw);
//       if (Array.isArray(parsed) && parsed.length > 0) {
//         if (hasOtherOption(question) && parsed.map(String).includes("Other")) return otherText.length > 0;
//         return true;
//       }
//     } catch {
//       const parts = raw
//         .split(",")
//         .map((s) => s.trim())
//         .filter(Boolean);
//       if (parts.length === 0) return false;
//       if (hasOtherOption(question) && parts.includes("Other")) return otherText.length > 0;
//       return true;
//     }
//     return false;
//   }

//   if (hasOtherOption(question ?? ({} as HandbookQuestion)) && raw === "Other") {
//     return otherText.length > 0;
//   }

//   return true;
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

//     // Blueprint (optional) controls the allowed question set
//     const blueprint = HANDBOOK_BLUEPRINTS[sectionKey];

//     // Default: if blueprint exists, default to 10 (still capped to 10). Else 6.
//     const maxQuestionsRaw = Number(body?.maxQuestions);
//     const defaultMax = blueprint ? 10 : 6;
//     const maxQuestions =
//       Number.isFinite(maxQuestionsRaw) && maxQuestionsRaw > 0
//         ? Math.min(Math.max(maxQuestionsRaw, 1), 10)
//         : defaultMax;

//     // Load org context
//     const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
//     if (!orgSnap.exists) {
//       return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
//     }
//     const org = orgSnap.data() as any;
//     const orgContext = pickOrgContext(org);

//     // Load plan scoped to org
//     const ref = adminDb.collection("organizations").doc(orgId).collection("plans").doc(planId);
//     const snap = await ref.get();
//     if (!snap.exists) {
//       return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
//     }

//     const plan = snap.data() as any;
//     const hb = plan?.data?.handbook ?? {};

//     const section = hb?.sections?.[sectionKey] ?? {};
//     const existingAnswers = normalizeAnswers(section);
//     const existingContent = safeString(section?.content);

//     // Optional back-compat
//     const legacyProfile = hb?.profile ?? null;

//     // ✅ Prefill answers from orgContext (strong signals only)
//     const prefilled = prefillFromOrgContext(sectionKey, orgContext, blueprint);

//     // ✅ "effective answers" are what we treat as already known/answered
//     const effectiveAnswers: Record<string, string> = { ...prefilled, ...existingAnswers };

//     const system = `
// You generate the MINIMUM set of clarification questions needed to customize THIS nonprofit Fund Development Handbook section.

// Rules:
// - Ask ONLY for information required to customize THIS section.
// - Max ${maxQuestions} questions.
// - Do NOT ask for anything already present in org context, existing answers, or existing section content.
// - Avoid duplicates and overlapping questions (merge them).
// - Questions must be operational and answerable by staff.
// - Do NOT mention template tokens/placeholders or where answers will be inserted.
// - If the section can be written with current info, return {"questions": []}.
// - Return ONLY valid JSON matching the schema.

// ${blueprint ? `
// CRITICAL BLUEPRINT RULES:
// - You MUST choose questions ONLY from the provided BLUEPRINT FIELDS.
// - Use the field's "id" EXACTLY as provided (stable IDs).
// - Use the field's suggested "type" and "options" when present.
// - You may omit blueprint fields if they are already answered or can be inferred from provided context.
// ` : ""}

// Schema:
// {
//   "questions": [
//     {
//       "id": "string_snake_case",
//       "label": "string",
//       "type": "text" | "textarea" | "select" | "multiselect",
//       "options": ["string"],
//       "placeholder": "string",
//       "helper": "string",
//       "required": true
//     }
//   ]
// }
// `.trim();

//     const user = `
// SECTION KEY: ${sectionKey}

// BASE TEMPLATE:
// ${baseTemplate}

// ORG CONTEXT:
// ${JSON.stringify(orgContext, null, 2)}

// ${legacyProfile ? `LEGACY HANDBOOK PROFILE (may be outdated):
// ${JSON.stringify(legacyProfile, null, 2)}` : ""}

// ${blueprint ? `BLUEPRINT FIELDS (allowed question set):
// ${JSON.stringify(blueprint, null, 2)}` : ""}

// EFFECTIVE ANSWERS (prefilled from org context + saved answers):
// ${JSON.stringify(effectiveAnswers, null, 2)}

// EXISTING SECTION CONTENT:
// ${existingContent || "(none)"}
// `.trim();

//     const completion = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       temperature: 0.2,
//       messages: [
//         { role: "system", content: system },
//         { role: "user", content: user },
//       ],
//       response_format: { type: "json_object" },
//     });

//     const text = completion.choices[0]?.message?.content ?? "{}";

//     let parsed: AIQuestionsResponse;
//     try {
//       parsed = JSON.parse(text);
//     } catch {
//       return NextResponse.json({ ok: false, error: "AI returned non-JSON output", raw: text }, { status: 502 });
//     }

//     const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
//     if (questions.length > maxQuestions) {
//       return NextResponse.json({ ok: false, error: "AI returned too many questions", questions }, { status: 502 });
//     }

//     // Minimal shape cleanup to keep UI stable
//     let cleaned: HandbookQuestion[] = questions
//       .filter((q: any) => q && typeof q.id === "string" && typeof q.label === "string")
//       .map((q: any) => ({
//         id: String(q.id).trim(),
//         label: String(q.label).trim(),
//         helper: typeof q.helper === "string" ? q.helper : undefined,
//         type:
//           q.type === "textarea" || q.type === "select" || q.type === "multiselect" || q.type === "text"
//             ? q.type
//             : "text",
//         options: Array.isArray(q.options) ? q.options.map(String) : undefined,
//         placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
//         required: typeof q.required === "boolean" ? q.required : true,
//       }))
//       .filter((q) => q.id.length > 0 && q.label.length > 0)
//       .filter((q, idx, arr) => arr.findIndex((x) => x.id === q.id) === idx);

//     // If blueprint exists, enforce: returned IDs must be in blueprint
//     if (blueprint) {
//       const allowed = new Set(blueprint.fields.map((f: any) => f.id));
//       cleaned = cleaned.filter((q) => allowed.has(q.id));
//     }

//     // ✅ Server-side skip: remove questions that are already answered
//     cleaned = cleaned.filter((q) => !isAnswered(q.id, effectiveAnswers, q));

//     return NextResponse.json({
//       ok: true,
//       planId,
//       sectionKey,
//       templateHash,
//       questionsGeneratedAt: new Date().toISOString(),
//       // NOTE: we return only the remaining unanswered questions.
//       // The UI will still have access to prefilled answers in Firestore via plan load (if you also persist them),
//       // but even without persisting, this keeps the question list clean.
//       questions: cleaned,
//     });
//   } catch (err: any) {
//     const { status, message } = errorToResponse(err);
//     return NextResponse.json({ ok: false, error: message }, { status });
//   }
// }






// // app/api/ai/handbook/section/questions/route.ts
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
//   // optional knobs (future-proof)
//   maxQuestions?: number;
// };

// type AIQuestionsResponse = {
//   questions: HandbookQuestion[];
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

// function normalizeAnswers(section: any) {
//   const a = section?.answers;
//   if (a && typeof a === "object" && !Array.isArray(a)) return a as Record<string, string>;
//   return {};
// }

// function pickOrgContext(org: any) {
//   // Org doc fields from onboarding (plus website gating)
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

//     const maxQuestionsRaw = Number(body?.maxQuestions);
//     const maxQuestions =
//       Number.isFinite(maxQuestionsRaw) && maxQuestionsRaw > 0
//         ? Math.min(Math.max(maxQuestionsRaw, 1), 10)
//         : 6;

//     if (!planId || !sectionKey) {
//       return NextResponse.json({ ok: false, error: "Missing planId or sectionKey" }, { status: 400 });
//     }

//     const baseTemplate = BASE_TEMPLATES[sectionKey];
//     if (!baseTemplate) {
//       return NextResponse.json({ ok: false, error: `Unknown sectionKey: ${sectionKey}` }, { status: 400 });
//     }

//     const templateHash = hashText(baseTemplate);

//     // Load org context from organizations/{orgId}
//     const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
//     if (!orgSnap.exists) {
//       return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });
//     }
//     const org = orgSnap.data() as any;
//     const orgContext = pickOrgContext(org);

//     // Load plan scoped to org
//     const ref = adminDb.collection("organizations").doc(orgId).collection("plans").doc(planId);
//     const snap = await ref.get();
//     if (!snap.exists) {
//       return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
//     }

//     const plan = snap.data() as any;
//     const hb = plan?.data?.handbook ?? {};

//     const section = hb?.sections?.[sectionKey] ?? {};
//     const existingAnswers = normalizeAnswers(section);
//     const existingContent = safeString(section?.content);

//     // (Optional) Back-compat: if older plans stored handbook.profile, we can pass it as fallback
//     // BUT we prefer orgContext as source of truth.
//     const legacyProfile = hb?.profile ?? null;

//     const system = `
// You generate the minimum set of clarification questions needed to rewrite a nonprofit Fund Development Handbook section into final, organization-specific policy text.

// Rules:
// - Ask ONLY for information required to customize THIS section.
// - Max ${maxQuestions} questions.
// - Do NOT ask for anything already present in org context, existing answers, or existing content.
// - Avoid duplicates and overlapping questions (merge them).
// - Questions must be operational and answerable by staff.
// - Do NOT mention template tokens/placeholders or where answers will be inserted.
// - If the section can be written with current info, return {"questions": []}.

// Return ONLY valid JSON with this schema:
// {
//   "questions": [
//     {
//       "id": "string_snake_case",
//       "label": "string",
//       "type": "text" | "textarea" | "select",
//       "options": ["string"],
//       "placeholder": "string",
//       "required": true
//     }
//   ]
// }
// `.trim();

//     const user = `
// SECTION KEY: ${sectionKey}

// BASE TEMPLATE:
// ${baseTemplate}

// ORG CONTEXT (from onboarding / org workspace):
// ${JSON.stringify(orgContext, null, 2)}

// ${legacyProfile ? `LEGACY HANDBOOK PROFILE (back-compat; may be incomplete/outdated):
// ${JSON.stringify(legacyProfile, null, 2)}` : ""}

// EXISTING ANSWERS:
// ${JSON.stringify(existingAnswers, null, 2)}

// EXISTING SECTION CONTENT:
// ${existingContent || "(none)"}
// `.trim();

//     const completion = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       temperature: 0.2,
//       messages: [
//         { role: "system", content: system },
//         { role: "user", content: user },
//       ],
//       response_format: { type: "json_object" },
//     });

//     const text = completion.choices[0]?.message?.content ?? "{}";

//     let parsed: AIQuestionsResponse;
//     try {
//       parsed = JSON.parse(text);
//     } catch {
//       return NextResponse.json(
//         { ok: false, error: "AI returned non-JSON output", raw: text },
//         { status: 502 }
//       );
//     }

//     const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
//     if (questions.length > maxQuestions) {
//       return NextResponse.json(
//         { ok: false, error: "AI returned too many questions", questions },
//         { status: 502 }
//       );
//     }

//     // Minimal shape cleanup to keep UI stable
//     const cleaned: HandbookQuestion[] = questions
//       .filter((q: any) => q && typeof q.id === "string" && typeof q.label === "string")
//       .map((q: any) => ({
//         id: String(q.id).trim(),
//         label: String(q.label).trim(),
//         type: q.type === "textarea" || q.type === "select" || q.type === "text" ? q.type : "text",
//         options: Array.isArray(q.options) ? q.options.map(String) : undefined,
//         placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
//         required: typeof q.required === "boolean" ? q.required : true,
//       }))
//       .filter((q) => q.id.length > 0 && q.label.length > 0)
//       .filter((q, idx, arr) => arr.findIndex((x) => x.id === q.id) === idx);

//     return NextResponse.json({
//       ok: true,
//       planId,
//       sectionKey,
//       templateHash,
//       questionsGeneratedAt: new Date().toISOString(),
//       questions: cleaned,
//     });
//   } catch (err: any) {
//     const { status, message } = errorToResponse(err);
//     return NextResponse.json({ ok: false, error: message }, { status });
//   }
// }


