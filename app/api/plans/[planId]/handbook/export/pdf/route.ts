import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireOrgContext, errorToResponse } from "@/lib/serverAuth";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const runtime = "nodejs";

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (test.length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    const { orgId } = await requireOrgContext(req);
    const { planId } = await context.params;

    const ref = adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("plans")
      .doc(planId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const plan = snap.data() ?? {};
    const handbook = plan?.data?.handbook ?? plan?.handbook ?? {};
    const profile = handbook?.profile ?? {};
    const sections = handbook?.sections ?? {};

    // Build a single export string (include incomplete sections too)
    const title = String(plan?.title ?? "Fund Development Handbook");
    const orgName = String(profile?.orgName ?? "").trim() || "Organization";
    const mission = String(profile?.mission ?? "").trim();

    const lines: string[] = [];
    lines.push(title);
    lines.push(`Organization: ${orgName}`);
    if (mission) lines.push(`Mission: ${mission}`);
    lines.push("");
    lines.push("— — —");
    lines.push("");

    // NOTE: titles are not stored here, so we just print keys + content.
    // If you want pretty titles, we can import a shared constant of section titles later.
    const sectionKeys = Object.keys(sections);

    // preserve ordering if you stored order elsewhere; otherwise sort by key
    sectionKeys.sort();

    for (const key of sectionKeys) {
      const s = sections[key] ?? {};
      const content = String(s?.content ?? "").trim();

      lines.push(key);
      lines.push("");

      if (content) {
        lines.push(content);
      } else {
        lines.push("[Not generated yet]");
      }

      lines.push("");
      lines.push("— — —");
      lines.push("");
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const fontSize = 11;
    const lineHeight = 14;
    const margin = 50;

    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    let y = height - margin;

    const maxCharsPerLine = 95; // simple wrap heuristic

    for (const blockLine of lines) {
      const wrapped = wrapText(blockLine, maxCharsPerLine);
      for (const l of wrapped) {
        if (y < margin + lineHeight) {
          page = pdfDoc.addPage();
          ({ width, height } = page.getSize());
          y = height - margin;
        }
        page.drawText(l, { x: margin, y, size: fontSize, font });
        y -= lineHeight;
      }
    }

    const bytes = await pdfDoc.save();
    const filename = `${orgName.replace(/[^\w\-]+/g, "_")}_handbook.pdf`;
    const pdfBytes = Uint8Array.from(bytes);

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: unknown) {
    const { status, message } = errorToResponse(e);
    return NextResponse.json({ error: message }, { status });
  }
}


