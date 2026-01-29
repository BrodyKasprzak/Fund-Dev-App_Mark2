// app/api/plans/[planId]/handbook/export/docx/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { errorToResponse } from "@/lib/serverAuth";
import { getAuth } from "firebase-admin/auth";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Footer,
  PageNumber,
  VerticalAlign,
} from "docx";

export const runtime = "nodejs";

/**
 * PROFESSIONAL FUND DEVELOPMENT HANDBOOK EXPORT (DOCX)
 * - Exports ONLY completed sections with non-empty content
 * - Title page is vertically centered + no page number
 * - Page numbers start at 1 on the Table of Contents section
 * - Org name auto-populates from the SAME source as UI:
 *    users/{uid}.orgId -> organizations/{orgId}.name
 * - Valid DOCX footer construction (avoids Word open errors)
 */

// Colors
const HEADING_COLOR = "075985"; // Sky-800
const BODY_TEXT_COLOR = "1E293B"; // Slate-800
const SECONDARY_TEXT_COLOR = "64748B"; // Slate-500
const DIVIDER_COLOR = "CBD5E1"; // Slate-300

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
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Return "" when missing so fallbacks work correctly with ||
function cleanOrgName(v: any) {
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

async function getUidFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const decoded = await getAuth().verifyIdToken(idToken);
  return decoded?.uid ?? null;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    // ✅ Resolve orgId exactly like your UI does
    const uid = await getUidFromRequest(req);
    if (!uid) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

    const userSnap = await adminDb.collection("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() ?? {}) : null;
    const orgId = String((userData as any)?.orgId ?? "").trim();
    if (!orgId) return NextResponse.json({ error: "User has no orgId" }, { status: 403 });

    const memberSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("members")
      .doc(uid)
      .get();

    if (!memberSnap.exists) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const orgSnap = await adminDb.collection("organizations").doc(orgId).get();
    const orgDoc = orgSnap.exists ? (orgSnap.data() ?? {}) : {};

    // Load plan (scoped to this orgId)
    const { planId } = await context.params;

    const planRef = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans")
      .doc(planId);

    const planSnap = await planRef.get();
    if (!planSnap.exists) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const plan = planSnap.data() ?? {};
    const handbook = plan?.data?.handbook ?? plan?.handbook ?? {};
    const profile = handbook?.profile ?? {};
    const sections = handbook?.sections ?? {};

    const exportDate = new Date();
    const updatedStr = formatDateForTitlePage(exportDate);

    // ✅ Org name + mission: handbook profile first, then org doc
    const orgName =
      cleanOrgName(profile?.orgName) ||
      cleanOrgName(profile?.name) ||
      cleanOrgName(orgDoc?.name) ||
      cleanOrgName(orgDoc?.orgName) ||
      cleanOrgName(orgDoc?.displayName) ||
      "Organization";

    const mission =
      String(profile?.mission ?? "").trim() ||
      String(orgDoc?.mission ?? "").trim();

    // Only include completed sections with meaningful content
    const completedInUiOrder = UI_SECTIONS.filter(({ key }) => {
      const s = sections?.[key] ?? {};
      const completed = Boolean(s?.completed);
      const content = String(s?.content ?? "").trim();
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
    // FOOTER (SAFE page number)
    // ------------------------------
    const footerWithPageNumbers = new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "Page ",
              color: SECONDARY_TEXT_COLOR,
              size: 20,
            }),
            PageNumber.CURRENT,
          ],
        }),
      ],
    });

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
      const s = sections?.[key] ?? {};
      const content = String(s?.content ?? "").trim();

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
          properties: {
            page: {
              pageNumbers: { start: 1, formatType: "decimal" },
            },
          },
          footers: { default: footerWithPageNumbers },
          children: bodyChildren,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${safeFilenameBase(orgName)}_Fund_Development_Handbook.docx`;

    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    return errorToResponse(e);
  }
}




// import { NextResponse } from "next/server";
// import { adminDb } from "@/lib/firebaseAdmin";
// import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
// import {
//   Document,
//   Packer,
//   Paragraph,
//   TextRun,
//   HeadingLevel,
//   AlignmentType,
//   PageBreak,
//   Footer,
//   PageNumber,
//   VerticalAlign,
//   InternalHyperlink,
// } from "docx";

// export const runtime = "nodejs";

// /**
//  * NOTES:
//  * - Exports ONLY completed sections (and only those with non-empty content).
//  * - Order follows UI order below (not DB order).
//  * - TOC here is a manual list with INTERNAL hyperlinks (no page numbers).
//  * - Each section heading has a bookmark so the TOC can jump to it.
//  */

// // Requested blue
// const SECTION_BLUE = "0000FF";

// // UI order + titles (matches your page.tsx)
// const UI_SECTIONS: Array<{ key: string; title: string }> = [
//   { key: "s1_intro", title: "1. Introduction and Purpose" },
//   { key: "s2_philosophy", title: "2. Fund Development Philosophy and Definitions" },
//   { key: "s3_roles", title: "3. Roles and Responsibilities" },
//   { key: "s4_ethics", title: "4. Ethical Fundraising Framework" },
//   { key: "s5_gift_acceptance", title: "5. Gift Acceptance Policy" },
//   { key: "s5a_major_gifts", title: "5A. Major Gifts Acceptance Policy" },
//   { key: "s6_processing", title: "6. Gift Processing Policies and Procedures" },
//   { key: "s7_recognition", title: "7. Donor Recognition and Acknowledgement" },
//   { key: "s8_stewardship", title: "8. Donor Cultivation and Stewardship" },
//   { key: "s9_grants", title: "9. Grants Management" },
//   { key: "s10_awards_declines", title: "10. Funding Announcements and Declinations" },
//   { key: "s11_sponsorships", title: "11. Corporate Sponsorships" },
//   { key: "s12_events", title: "12. Special Events Fundraising" },
//   { key: "s13_inkind", title: "13. In-Kind Donations" },
//   { key: "s14_planned_giving", title: "14. Legacy and Planned Giving" },
//   { key: "s15_financial", title: "15. Financial Management and Reporting" },
//   { key: "s16_compliance", title: "16. Compliance, Governance, and Accountability" },
//   { key: "s17_appendices", title: "17. Appendices and Attachments" },
// ];

// function cleanOrgName(v: any) {
//   const s = String(v ?? "").trim();
//   return s.length ? s : "Organization";
// }

// function safeFilenameBase(v: string) {
//   return v.replace(/[^\w\-]+/g, "_");
// }

// function formatDateForTitlePage(d: Date) {
//   return d.toLocaleDateString("en-US", {
//     year: "numeric",
//     month: "long",
//     day: "numeric",
//   });
// }

// function splitIntoParagraphs(content: string) {
//   return content
//     .replace(/\r\n/g, "\n")
//     .split(/\n\s*\n/g)
//     .map((b) => b.trim())
//     .filter(Boolean);
// }

// function bookmarkIdForSectionKey(key: string) {
//   // must be alphanumeric/underscore-ish; keep stable
//   return `sec_${key.replace(/[^\w]+/g, "_")}`;
// }

// export async function POST(
//   req: Request,
//   context: { params: Promise<{ planId: string }> }
// ) {
//   try {
//     const { orgId } = await requireOrgContext(req);
//     const { planId } = await context.params;

//     const ref = adminDb
//       .collection("organizations")
//       .doc(orgId)
//       .collection("plans")
//       .doc(planId);

//     const snap = await ref.get();
//     if (!snap.exists) {
//       return NextResponse.json({ error: "Plan not found" }, { status: 404 });
//     }

//     const plan = snap.data() ?? {};
//     const handbook = plan?.data?.handbook ?? plan?.handbook ?? {};
//     const profile = handbook?.profile ?? {};
//     const sections = handbook?.sections ?? {};

//     const exportDate = new Date();
//     const orgName = cleanOrgName(profile?.orgName);
//     const mission = String(profile?.mission ?? "").trim();
//     const updatedStr = formatDateForTitlePage(exportDate);

//     // Only include completed sections (and must have meaningful content)
//     const completedInUiOrder = UI_SECTIONS.filter(({ key }) => {
//       const s = sections?.[key] ?? {};
//       const completed = Boolean(s?.completed);
//       const content = String(s?.content ?? "").trim();
//       return completed && content.length > 0;
//     });

//     // ------------------------------
//     // Title page (no page numbers)
//     // Centered vertically + horizontally
//     // ------------------------------
//     const titlePageChildren: Paragraph[] = [
//       new Paragraph({
//         children: [
//           new TextRun({
//             text: orgName,
//             bold: true,
//             size: 56,
//             color: SECTION_BLUE,
//           }),
//         ],
//         alignment: AlignmentType.CENTER,
//         spacing: { after: 320 },
//       }),

//       new Paragraph({
//         children: [
//           new TextRun({
//             text: "Fund Development Handbook",
//             bold: true,
//             size: 44,
//             color: SECTION_BLUE,
//           }),
//         ],
//         alignment: AlignmentType.CENTER,
//         spacing: { after: 380 },
//       }),

//       new Paragraph({
//         children: [
//           new TextRun({
//             text: "Last updated ",
//             size: 28,
//             color: "444444",
//           }),
//           new TextRun({
//             text: updatedStr,
//             size: 28,
//             bold: true,
//             color: "444444",
//           }),
//         ],
//         alignment: AlignmentType.CENTER,
//         spacing: { after: 440 },
//       }),
//     ];

//     if (mission) {
//       titlePageChildren.push(
//         new Paragraph({
//           children: [
//             new TextRun({
//               text: "Mission",
//               bold: true,
//               size: 28,
//               color: "333333",
//             }),
//           ],
//           alignment: AlignmentType.CENTER,
//           spacing: { after: 160 },
//         }),
//         new Paragraph({
//           children: [
//             new TextRun({
//               text: mission,
//               size: 28,
//               color: "333333",
//             }),
//           ],
//           alignment: AlignmentType.CENTER,
//           spacing: { after: 380 },
//         })
//       );
//     }

//     // One page break to start "Contents" page
//     titlePageChildren.push(
//       new Paragraph({
//         children: [new PageBreak()],
//       })
//     );

//     // ------------------------------
//     // Footer with page numbers (starts on Contents page)
//     // ------------------------------
//     const footerWithPageNumbers = new Footer({
//       children: [
//         new Paragraph({
//           alignment: AlignmentType.CENTER,
//           children: [
//             new TextRun({
//               children: ["Page ", PageNumber.CURRENT],
//               color: "666666",
//             }),
//           ],
//         }),
//       ],
//     });

//     // ------------------------------
//     // Contents + body (page numbers start here at 1)
//     // Contents is manual hyperlinks (no page numbers)
//     // ------------------------------
//     const bodyChildren: Paragraph[] = [];

//     // Contents heading
//     bodyChildren.push(
//       new Paragraph({
//         children: [
//           new TextRun({
//             text: "Table of Contents",
//             bold: true,
//             color: SECTION_BLUE,
//             size: 32,
//           }),
//         ],
//         heading: HeadingLevel.HEADING_1,
//         spacing: { after: 220 },
//       })
//     );

//     if (completedInUiOrder.length === 0) {
//       bodyChildren.push(
//         new Paragraph({
//           children: [
//             new TextRun({
//               text: "No sections have been completed yet.",
//               size: 24,
//               color: "444444",
//             }),
//           ],
//           spacing: { after: 160 },
//         }),
//         new Paragraph({
//           children: [
//             new TextRun({
//               text: "Return to the builder, complete at least one section, then export again.",
//               size: 24,
//               color: "444444",
//             }),
//           ],
//           spacing: { after: 260 },
//         })
//       );
//     } else {
//       // Manual list of internal hyperlinks (no page numbers)
//       for (const { key, title } of completedInUiOrder) {
//         const anchor = bookmarkIdForSectionKey(key);

//         bodyChildren.push(
//           new Paragraph({
//             children: [
//               new InternalHyperlink({
//                 anchor,
//                 children: [
//                   new TextRun({
//                     text: title,
//                     color: SECTION_BLUE,
//                     underline: {}, // make it look like a link
//                   }),
//                 ],
//               }),
//             ],
//             spacing: { after: 80 },
//           })
//         );
//       }
//     }

//     // Page break after contents
//     bodyChildren.push(
//       new Paragraph({
//         children: [new PageBreak()],
//       })
//     );

//     // Sections in UI order (completed only)
//     for (const { key, title: sectionTitle } of completedInUiOrder) {
//       const s = sections?.[key] ?? {};
//       const content = String(s?.content ?? "").trim();
//       const anchor = bookmarkIdForSectionKey(key);

//       // Section title with bookmark target (so TOC hyperlink jumps here)
//       bodyChildren.push(
//         new Paragraph({
//           children: [
//             new InternalHyperlink({
//               // This creates the bookmark target implicitly when used as an anchor destination
//               // NOTE: docx uses anchors via bookmark ids on the paragraph
//               anchor,
//               children: [
//                 new TextRun({
//                   text: sectionTitle,
//                   bold: true,
//                   color: SECTION_BLUE,
//                   size: 28,
//                 }),
//               ],
//             }),
//           ],
//           heading: HeadingLevel.HEADING_1,
//           spacing: { before: 180, after: 120 },
//           bookmark: anchor as any, // docx typings vary by version; runtime supports bookmarks
//         } as any)
//       );

//       // Body paragraphs
//       const blocks = splitIntoParagraphs(content);
//       for (const b of blocks) {
//         bodyChildren.push(
//           new Paragraph({
//             children: [new TextRun({ text: b, size: 24, color: "111111" })],
//             spacing: { after: 120 },
//           })
//         );
//       }

//       bodyChildren.push(new Paragraph({ text: "" }));
//     }

//     // ------------------------------
//     // Build doc with TWO sections:
//     // 1) Title page (no numbering) + vertically centered
//     // 2) Contents + body with page numbers starting at 1
//     // ------------------------------
//     const doc = new Document({
//       sections: [
//         {
//           properties: {
//             verticalAlign: VerticalAlign.CENTER,
//           },
//           children: titlePageChildren,
//         },
//         {
//           properties: {
//             page: {
//               pageNumbers: {
//                 start: 1,
//               },
//             },
//           },
//           footers: {
//             default: footerWithPageNumbers,
//           },
//           children: bodyChildren,
//         },
//       ],
//     });

//     const buffer = await Packer.toBuffer(doc);
//     const filename = `${safeFilenameBase(orgName)}_handbook.docx`;

//     return new NextResponse(Buffer.from(buffer), {
//       headers: {
//         "Content-Type":
//           "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//         "Content-Disposition": `attachment; filename="${filename}"`,
//       },
//     });
//   } catch (e: any) {
//     return errorToResponse(e);
//   }
// }


