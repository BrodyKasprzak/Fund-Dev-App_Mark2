// app/api/plans/[planId]/handbook/export/docx/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requirePlanReadAccess, errorToResponse } from "@/lib/serverAuth";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  VerticalAlign,
} from "docx";

export const runtime = "nodejs";

/**
 * PROFESSIONAL FUND DEVELOPMENT HANDBOOK EXPORT (DOCX)
 * - Org-scoped via requirePlanReadAccess (authoritative)
 * - Plan loaded from organizations/{orgId}/plans/{planId}
 * - Exports ONLY completed sections with non-empty content
 * - Title page is vertically centered + no page number
 * - Page numbers start at 1 on the Table of Contents section
 * - Org name: handbook profile first, then organizations/{orgId}
 */

// Colors
const HEADING_COLOR = "075985"; // Sky-800
const BODY_TEXT_COLOR = "1E293B"; // Slate-800
const SECONDARY_TEXT_COLOR = "64748B"; // Slate-500
const DIVIDER_COLOR = "CBD5E1"; // Slate-300

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as LooseRecord;
}

// UI order + titles (matches your UI)
const UI_SECTIONS: Array<{ key: string; title: string }> = [
  { key: "s1_intro", title: "1. Introduction and Purpose" },
  { key: "s2_philosophy", title: "2. Fund Development Philosophy and Definitions" },
  { key: "s3_roles", title: "3. Roles and Responsibilities" },
  { key: "s4_ethics", title: "4. Ethical Fundraising Framework" },
  { key: "s5_gift_acceptance", title: "5. Gift Acceptance Policy" },
  { key: "s5a_major_gifts", title: "5A. Major Gifts Acceptance Policy" },
  { key: "s6_processing", title: "6. Gift Processing Policies and Procedures" },
  { key: "s7_recognition", title: "7. Donor Recognition and Acknowledgement" },
  { key: "s8_stewardship", title: "8. Donor Cultivation and Stewardship" },
  { key: "s9_grants", title: "9. Grants Management" },
  { key: "s10_awards_declines", title: "10. Funding Announcements and Declinations" },
  { key: "s11_sponsorships", title: "11. Corporate Sponsorships" },
  { key: "s12_events", title: "12. Special Events Fundraising" },
  { key: "s13_inkind", title: "13. In-Kind Donations" },
  { key: "s14_planned_giving", title: "14. Legacy and Planned Giving" },
  { key: "s15_financial", title: "15. Financial Management and Reporting" },
  { key: "s16_compliance", title: "16. Compliance, Governance, and Accountability" },
  { key: "s17_appendices", title: "17. Appendices and Attachments" },
];

function safeFilenameBase(v: string) {
  return String(v || "Organization").replace(/[^\w\-]+/g, "_");
}

function formatDateForTitlePage(d: Date) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Return "" when missing so fallbacks work correctly with ||
function cleanOrgName(v: unknown) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

function splitIntoParagraphs(content: string) {
  return String(content ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter(Boolean);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    // ✅ Authoritative org context (membership verified here)
    const { orgId } = await requirePlanReadAccess(req);

    const { planId } = await context.params;

    // ✅ Load org (for name/mission fallback)
    const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
    const orgDoc = orgSnap.exists ? asRecord(orgSnap.data()) : {};

    // ✅ Load plan scoped to orgId
    const planRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans")
      .doc(planId);

    const planSnap = await planRef.get();
    if (!planSnap.exists) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const plan = asRecord(planSnap.data());
    const planData = asRecord(plan["data"]);
    const handbook = asRecord(planData["handbook"] ?? plan["handbook"]);
    const profile = asRecord(handbook["profile"]);
    const sections = asRecord(handbook["sections"]);

    const exportDate = new Date();
    const updatedStr = formatDateForTitlePage(exportDate);

    // ✅ Org name + mission: handbook profile first, then org doc
    const orgName =
      cleanOrgName(profile["orgName"]) ||
      cleanOrgName(profile["name"]) ||
      cleanOrgName(orgDoc["name"]) ||
      cleanOrgName(orgDoc["orgName"]) ||
      cleanOrgName(orgDoc["displayName"]) ||
      "Organization";

    const mission =
      String(profile["mission"] ?? "").trim() ||
      String(orgDoc["mission"] ?? "").trim();

    // Only include completed sections with meaningful content
    const completedInUiOrder = UI_SECTIONS.filter(({ key }) => {
      const s = asRecord(sections[key]);
      const completed = Boolean(s["completed"]);
      const content = String(s["content"] ?? "").trim();
      return completed && content.length > 0;
    });

    // ------------------------------
    // TITLE PAGE (no page numbers)
    // ------------------------------
    const titlePageChildren: Paragraph[] = [];

    titlePageChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
        children: [
          new TextRun({
            text: orgName,
            bold: true,
            size: 64, // 32pt
            color: HEADING_COLOR,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 520 },
        children: [
          new TextRun({
            text: "Fund Development Handbook",
            bold: true,
            size: 52, // 26pt
            color: HEADING_COLOR,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 380 },
        children: [
          new TextRun({
            text: "━".repeat(40),
            color: DIVIDER_COLOR,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 520 },
        children: [
          new TextRun({
            text: "Last Updated: ",
            size: 26,
            color: SECONDARY_TEXT_COLOR,
          }),
          new TextRun({
            text: updatedStr,
            size: 26,
            bold: true,
            color: BODY_TEXT_COLOR,
          }),
        ],
      })
    );

    if (mission) {
      titlePageChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: [
            new TextRun({
              text: "Our Mission",
              bold: true,
              size: 30,
              color: HEADING_COLOR,
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 420 },
          children: [
            new TextRun({
              text: mission,
              size: 26,
              italics: true,
              color: BODY_TEXT_COLOR,
            }),
          ],
        })
      );
    }

    // Break to next section (Contents)
    titlePageChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // ------------------------------
    // CONTENTS + BODY
    // ------------------------------
    const bodyChildren: Paragraph[] = [];

    bodyChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 280 },
        children: [
          new TextRun({
            text: "Table of Contents",
            bold: true,
            color: HEADING_COLOR,
            size: 40,
          }),
        ],
      })
    );

    if (completedInUiOrder.length === 0) {
      bodyChildren.push(
        new Paragraph({
          spacing: { after: 180 },
          children: [
            new TextRun({
              text: "No sections have been completed yet.",
              size: 24,
              color: SECONDARY_TEXT_COLOR,
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 280 },
          children: [
            new TextRun({
              text: "Return to the builder, complete at least one section, then export again.",
              size: 24,
              color: SECONDARY_TEXT_COLOR,
            }),
          ],
        })
      );
    } else {
      for (const { title } of completedInUiOrder) {
        const isSubsection = /\b[A-Z]\.\b/.test(title) || /\d+[A-Z]\./.test(title); // catches 5A.
        bodyChildren.push(
          new Paragraph({
            indent: { left: isSubsection ? 720 : 360 },
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: title,
                size: 24,
                color: BODY_TEXT_COLOR,
              }),
            ],
          })
        );
      }
    }

    bodyChildren.push(
      new Paragraph({
        spacing: { before: 280, after: 260 },
        children: [
          new TextRun({
            text: "━".repeat(80),
            color: DIVIDER_COLOR,
          }),
        ],
      }),
      new Paragraph({ children: [new PageBreak()] })
    );

    // Sections
    for (let i = 0; i < completedInUiOrder.length; i++) {
      const { key, title: sectionTitle } = completedInUiOrder[i];
      const s = asRecord(sections[key]);
      const content = String(s["content"] ?? "").trim();

      bodyChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 160 },
          children: [
            new TextRun({
              text: sectionTitle,
              bold: true,
              color: HEADING_COLOR,
              size: 32,
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 220 },
          children: [
            new TextRun({
              text: "─".repeat(60),
              color: DIVIDER_COLOR,
            }),
          ],
        })
      );

      const blocks = splitIntoParagraphs(content);

      for (const block of blocks) {
        const isBullet = /^[•\-\*]\s+/.test(block);
        const isNumbered = /^\d+[\.)]\s+/.test(block);

        bodyChildren.push(
          new Paragraph({
            spacing: { after: 180, line: 360 },
            indent: {
              left: isBullet || isNumbered ? 720 : 0,
              hanging: isBullet || isNumbered ? 360 : 0,
            },
            children: [
              new TextRun({
                text: block,
                size: 24,
                color: BODY_TEXT_COLOR,
              }),
            ],
          })
        );
      }

      if (i < completedInUiOrder.length - 1) {
        bodyChildren.push(
          new Paragraph({
            children: [new TextRun({ text: "" })],
            spacing: { after: 320 },
          })
        );
      }
    }

    // ------------------------------
    // BUILD DOC (2 sections)
    // ------------------------------
    const doc = new Document({
      sections: [
        {
          properties: { verticalAlign: VerticalAlign.CENTER },
          children: titlePageChildren,
        },
        {
          properties: {},
          children: bodyChildren,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${safeFilenameBase(orgName)}_Fund_Development_Handbook.docx`;
    const docxBytes = Uint8Array.from(buffer);

    return new NextResponse(docxBytes, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}


