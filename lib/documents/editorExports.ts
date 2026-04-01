import { basename } from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { adminStorage } from "@/lib/firebaseAdmin";
import { DOCX_MIME, PDF_MIME } from "@/lib/documents/versionMetadata";

type LexicalNode = {
  type?: unknown;
  tag?: unknown;
  text?: unknown;
  children?: unknown;
};

type LexicalEditorState = {
  root?: unknown;
};

export type StoredExportAsset = {
  status: "processing" | "ready" | "failed" | "not_generated";
  storagePath: string | null;
  fileType: string | null;
  generatedAt: Date | null;
  error: string | null;
};

export type StoredExportAssets = {
  docx: StoredExportAsset;
  pdf: StoredExportAsset;
};

type RichBlock = {
  type: "paragraph" | "heading1" | "heading2" | "heading3" | "quote" | "list";
  text: string;
};

type GenerateEditorExportsInput = {
  orgId: string;
  docId: string;
  versionNumber: number;
  title: string;
  filename: string;
  editorState: Record<string, unknown> | null;
  plainText: string;
};

function sanitizeName(input: string) {
  const clean = input
    .trim()
    .replace(/[\/\\]+/g, "_")
    .replace(/[<>:"|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  return clean || "document";
}

function textFromLexicalNode(node: LexicalNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.children)) return "";
  return node.children
    .map((child) => {
      if (!child || typeof child !== "object") return "";
      return textFromLexicalNode(child as LexicalNode);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBlocksFromEditorState(
  editorState: Record<string, unknown> | null,
  plainText: string,
) {
  const lexical = editorState as LexicalEditorState | null;
  const root =
    lexical?.root && typeof lexical.root === "object"
      ? (lexical.root as LexicalNode)
      : null;
  const children = Array.isArray(root?.children) ? root.children : [];

  const blocks: RichBlock[] = [];

  for (const raw of children) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as LexicalNode;
    const type = typeof node.type === "string" ? node.type : "paragraph";
    const text = textFromLexicalNode(node);
    if (!text) continue;

    if (type === "heading") {
      const tag = typeof node.tag === "string" ? node.tag.toLowerCase() : "h2";
      if (tag === "h1") blocks.push({ type: "heading1", text });
      else if (tag === "h2") blocks.push({ type: "heading2", text });
      else blocks.push({ type: "heading3", text });
      continue;
    }

    if (type === "quote") {
      blocks.push({ type: "quote", text });
      continue;
    }

    if (type === "list") {
      const listChildren = Array.isArray(node.children) ? node.children : [];
      for (const item of listChildren) {
        if (!item || typeof item !== "object") continue;
        const itemText = textFromLexicalNode(item as LexicalNode);
        if (!itemText) continue;
        blocks.push({ type: "list", text: itemText });
      }
      continue;
    }

    blocks.push({ type: "paragraph", text });
  }

  if (blocks.length > 0) return blocks;

  return plainText
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "paragraph" as const, text: line }));
}

function paragraphFromBlock(block: RichBlock) {
  if (block.type === "heading1") {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(block.text)],
      spacing: { after: 180 },
    });
  }
  if (block.type === "heading2") {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(block.text)],
      spacing: { after: 160 },
    });
  }
  if (block.type === "heading3") {
    return new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun(block.text)],
      spacing: { after: 140 },
    });
  }
  if (block.type === "list") {
    return new Paragraph({
      children: [new TextRun(`• ${block.text}`)],
      spacing: { after: 120 },
    });
  }
  if (block.type === "quote") {
    return new Paragraph({
      children: [new TextRun({ text: block.text, italics: true })],
      indent: { left: 600 },
      spacing: { after: 140 },
    });
  }
  return new Paragraph({
    children: [new TextRun(block.text)],
    spacing: { after: 120 },
  });
}

async function buildDocxBuffer(blocks: RichBlock[], title: string) {
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(title || "Document")],
      spacing: { after: 240 },
    }),
    ...blocks.map((block) => paragraphFromBlock(block)),
  ];

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

function wrapLines(args: {
  text: string;
  maxWidth: number;
  fontSize: number;
  font: Awaited<ReturnType<typeof PDFDocument.create>> extends infer T
    ? T extends { embedFont: (...a: never[]) => Promise<infer F> }
      ? F
      : never
    : never;
}) {
  const { text, maxWidth, fontSize, font } = args;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

async function buildPdfBuffer(blocks: RichBlock[], title: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage();
  const { width, height } = page.getSize();
  const margin = 56;
  const maxWidth = width - margin * 2;
  let y = height - margin;

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight >= margin) return;
    page = pdf.addPage();
    y = page.getHeight() - margin;
  };

  const drawTextBlock = (
    value: string,
    options: { size: number; bold?: boolean; indent?: number },
  ) => {
    const size = options.size;
    const lineHeight = size + 5;
    const indent = options.indent ?? 0;
    const targetFont = options.bold ? boldFont : font;
    const lines = wrapLines({
      text: value,
      maxWidth: maxWidth - indent,
      fontSize: size,
      font: targetFont,
    });
    ensureSpace(lines.length * lineHeight + 6);
    for (const line of lines) {
      page.drawText(line, {
        x: margin + indent,
        y,
        size,
        font: targetFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
    y -= 6;
  };

  drawTextBlock(title || "Document", { size: 18, bold: true });

  for (const block of blocks) {
    if (block.type === "heading1") drawTextBlock(block.text, { size: 16, bold: true });
    else if (block.type === "heading2") drawTextBlock(block.text, { size: 14, bold: true });
    else if (block.type === "heading3") drawTextBlock(block.text, { size: 13, bold: true });
    else if (block.type === "quote") drawTextBlock(block.text, { size: 11, indent: 18 });
    else if (block.type === "list") drawTextBlock(`• ${block.text}`, { size: 11 });
    else drawTextBlock(block.text, { size: 11 });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

async function uploadBuffer(args: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
}) {
  const { storagePath, buffer, contentType } = args;
  const fileRef = adminStorage.bucket().file(storagePath);
  await fileRef.save(buffer, {
    contentType,
    metadata: {
      cacheControl: "private, no-store, max-age=0",
    },
    resumable: false,
  });
}

function failedAsset(fileType: string, error: unknown): StoredExportAsset {
  const message =
    error instanceof Error ? error.message.slice(0, 320) : "Unknown export error";
  return {
    status: "failed",
    storagePath: null,
    fileType,
    generatedAt: null,
    error: message,
  };
}

export async function generateAndStoreEditorExports(
  input: GenerateEditorExportsInput,
): Promise<StoredExportAssets> {
  const now = new Date();
  const version = Math.max(1, Math.floor(input.versionNumber));
  const safeBase = sanitizeName(
    basename(input.filename).replace(/\.[^.]+$/, "") || input.title || "document",
  );
  const basePath = `organizations/${input.orgId}/documents/${input.docId}/v${version}/exports/${safeBase}`;
  const blocks = extractBlocksFromEditorState(input.editorState, input.plainText);
  const title = (input.title || "Document").trim();

  let docx: StoredExportAsset;
  try {
    const docxBuffer = await buildDocxBuffer(blocks, title);
    const storagePath = `${basePath}.docx`;
    await uploadBuffer({
      storagePath,
      buffer: docxBuffer,
      contentType: DOCX_MIME,
    });
    docx = {
      status: "ready",
      storagePath,
      fileType: DOCX_MIME,
      generatedAt: now,
      error: null,
    };
  } catch (err: unknown) {
    docx = failedAsset(DOCX_MIME, err);
  }

  let pdf: StoredExportAsset;
  try {
    const pdfBuffer = await buildPdfBuffer(blocks, title);
    const storagePath = `${basePath}.pdf`;
    await uploadBuffer({
      storagePath,
      buffer: pdfBuffer,
      contentType: PDF_MIME,
    });
    pdf = {
      status: "ready",
      storagePath,
      fileType: PDF_MIME,
      generatedAt: now,
      error: null,
    };
  } catch (err: unknown) {
    pdf = failedAsset(PDF_MIME, err);
  }

  return { docx, pdf };
}

