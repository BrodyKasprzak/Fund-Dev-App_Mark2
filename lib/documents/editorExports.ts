import { basename } from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  HighlightColor,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlignTable,
  WidthType,
  type ParagraphChild,
  type TableVerticalAlign,
} from "docx";
import { adminStorage } from "@/lib/firebaseAdmin";
import { DOCX_MIME, PDF_MIME } from "@/lib/documents/versionMetadata";

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 1 << 1;
const FORMAT_STRIKETHROUGH = 1 << 2;
const FORMAT_UNDERLINE = 1 << 3;
const FORMAT_CODE = 1 << 4;
const FORMAT_SUBSCRIPT = 1 << 5;
const FORMAT_SUPERSCRIPT = 1 << 6;

const MAX_ERROR_MESSAGE_LENGTH = 320;
const ORDERED_LIST_REFERENCE = "documents-ordered-list";
const MAX_LIST_DEPTH = 8;

type LexicalEditorState = Record<string, unknown>;
type UnknownRecord = Record<string, unknown>;

type LexicalInlineStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  subscript: boolean;
  superscript: boolean;
  fontSizeHalfPoints?: number;
  colorHex?: string;
  highlight?: (typeof HighlightColor)[keyof typeof HighlightColor];
  fontFamily?: string;
};

type ExportInlineNode =
  | {
      kind: "text";
      text: string;
      style: LexicalInlineStyle;
    }
  | {
      kind: "link";
      url: string;
      children: ExportInlineNode[];
    }
  | {
      kind: "break";
    };

type BlockAlignment = "left" | "center" | "right" | "justify" | "";

type ParagraphVariant = "paragraph" | "heading" | "quote" | "code";

type ParsedParagraphBlock = {
  kind: "paragraph";
  variant: ParagraphVariant;
  headingTag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  alignment: BlockAlignment;
  indentLevel: number;
  inlines: ExportInlineNode[];
};

type ParsedListItem = {
  blocks: ParsedBlock[];
  checked: boolean | null;
};

type ParsedListBlock = {
  kind: "list";
  listType: "bullet" | "number" | "check";
  start: number;
  items: ParsedListItem[];
};

type ParsedTableCell = {
  blocks: ParsedBlock[];
  header: boolean;
  colSpan?: number;
  rowSpan?: number;
  widthPx?: number;
  backgroundHex?: string;
  verticalAlign?: TableVerticalAlign;
};

type ParsedTableRow = {
  cells: ParsedTableCell[];
};

type ParsedTableBlock = {
  kind: "table";
  rows: ParsedTableRow[];
  colWidthsPx: number[];
};

type ParsedBlock = ParsedParagraphBlock | ParsedListBlock | ParsedTableBlock;

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

type GenerateEditorExportsInput = {
  orgId: string;
  docId: string;
  versionNumber: number;
  title: string;
  filename: string;
  editorState: Record<string, unknown> | null;
  plainText: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

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

function normalizeInlineText(input: string) {
  const raw = input.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!raw) return "";
  return raw;
}

function parseStyleDeclarations(rawStyle: string) {
  const out: Record<string, string> = {};
  for (const part of rawStyle.split(";")) {
    const [keyRaw, ...rest] = part.split(":");
    if (!keyRaw || rest.length === 0) continue;
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function parseLengthToPx(raw: string | null | undefined) {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  const match = value.match(/^(-?\d+(?:\.\d+)?)(px|pt|pc|in|cm|mm|em|rem)?$/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = match[2] || "px";
  if (unit === "px") return num;
  if (unit === "pt") return num * (96 / 72);
  if (unit === "pc") return num * 16;
  if (unit === "in") return num * 96;
  if (unit === "cm") return num * (96 / 2.54);
  if (unit === "mm") return num * (96 / 25.4);
  if (unit === "em" || unit === "rem") return num * 16;
  return null;
}

function pxToHalfPoints(px: number) {
  return clampInt(Math.round((px * 72) / 96) * 2, 12, 240);
}

function pxToTwip(px: number) {
  return clampInt(Math.round((px * 72 * 20) / 96), 1, 31680);
}

function parseHexColor(value: string) {
  const normalized = value.trim().toLowerCase();
  const short = normalized.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    const [r, g, b] = short[1].split("");
    return { r: parseInt(`${r}${r}`, 16), g: parseInt(`${g}${g}`, 16), b: parseInt(`${b}${b}`, 16) };
  }
  const long = normalized.match(/^#([0-9a-f]{6})$/i);
  if (long) {
    return {
      r: parseInt(long[1].slice(0, 2), 16),
      g: parseInt(long[1].slice(2, 4), 16),
      b: parseInt(long[1].slice(4, 6), 16),
    };
  }
  const alpha = normalized.match(/^#([0-9a-f]{8})$/i);
  if (alpha) {
    return {
      r: parseInt(alpha[1].slice(0, 2), 16),
      g: parseInt(alpha[1].slice(2, 4), 16),
      b: parseInt(alpha[1].slice(4, 6), 16),
    };
  }
  return null;
}

function parseRgbColor(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^rgba?\((.+)\)$/);
  if (!match) return null;
  const pieces = match[1].split(",").map((part) => part.trim());
  if (pieces.length < 3) return null;

  const parseChannel = (raw: string) => {
    if (raw.endsWith("%")) {
      const pct = Number(raw.slice(0, -1));
      if (!Number.isFinite(pct)) return null;
      return clampInt(Math.round((pct / 100) * 255), 0, 255);
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    return clampInt(Math.round(num), 0, 255);
  };

  const r = parseChannel(pieces[0]);
  const g = parseChannel(pieces[1]);
  const b = parseChannel(pieces[2]);
  if (r === null || g === null || b === null) return null;
  return { r, g, b };
}

const CSS_NAMED_COLORS: Record<string, { r: number; g: number; b: number }> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 128, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  yellow: { r: 255, g: 255, b: 0 },
  cyan: { r: 0, g: 255, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  darkgray: { r: 169, g: 169, b: 169 },
  darkgrey: { r: 169, g: 169, b: 169 },
  lightgray: { r: 211, g: 211, b: 211 },
  lightgrey: { r: 211, g: 211, b: 211 },
  darkred: { r: 139, g: 0, b: 0 },
  darkgreen: { r: 0, g: 100, b: 0 },
  darkblue: { r: 0, g: 0, b: 139 },
};

function parseCssColor(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "transparent" || normalized === "none") return null;
  return parseHexColor(normalized) || parseRgbColor(normalized) || CSS_NAMED_COLORS[normalized] || null;
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  const toHex = (channel: number) => channel.toString(16).padStart(2, "0").toUpperCase();
  return `${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function normalizeDocxColor(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = parseCssColor(value);
  return parsed ? rgbToHex(parsed) : undefined;
}

const HIGHLIGHT_MAP: Array<{
  name: (typeof HighlightColor)[keyof typeof HighlightColor];
  rgb: { r: number; g: number; b: number };
}> = [
  { name: HighlightColor.YELLOW, rgb: { r: 255, g: 255, b: 0 } },
  { name: HighlightColor.GREEN, rgb: { r: 0, g: 128, b: 0 } },
  { name: HighlightColor.CYAN, rgb: { r: 0, g: 255, b: 255 } },
  { name: HighlightColor.BLUE, rgb: { r: 0, g: 0, b: 255 } },
  { name: HighlightColor.RED, rgb: { r: 255, g: 0, b: 0 } },
  { name: HighlightColor.MAGENTA, rgb: { r: 255, g: 0, b: 255 } },
  { name: HighlightColor.DARK_YELLOW, rgb: { r: 139, g: 128, b: 0 } },
  { name: HighlightColor.DARK_GREEN, rgb: { r: 0, g: 100, b: 0 } },
  { name: HighlightColor.DARK_CYAN, rgb: { r: 0, g: 139, b: 139 } },
  { name: HighlightColor.DARK_BLUE, rgb: { r: 0, g: 0, b: 139 } },
  { name: HighlightColor.DARK_RED, rgb: { r: 139, g: 0, b: 0 } },
  { name: HighlightColor.DARK_MAGENTA, rgb: { r: 139, g: 0, b: 139 } },
  { name: HighlightColor.LIGHT_GRAY, rgb: { r: 211, g: 211, b: 211 } },
  { name: HighlightColor.DARK_GRAY, rgb: { r: 128, g: 128, b: 128 } },
  { name: HighlightColor.BLACK, rgb: { r: 0, g: 0, b: 0 } },
  { name: HighlightColor.WHITE, rgb: { r: 255, g: 255, b: 255 } },
];

function mapHighlightColor(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = parseCssColor(value);
  if (!parsed) return undefined;
  let best = HIGHLIGHT_MAP[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of HIGHLIGHT_MAP) {
    const dr = parsed.r - candidate.rgb.r;
    const dg = parsed.g - candidate.rgb.g;
    const db = parsed.b - candidate.rgb.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best.name;
}

function normalizeFontFamily(value: string | null | undefined) {
  if (!value) return undefined;
  const primary = value
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .find(Boolean);
  if (!primary) return undefined;
  return primary.slice(0, 64);
}

function textFromLexicalNode(node: unknown): string {
  if (!isRecord(node)) return "";
  const textValue = asString(node.text);
  if (textValue) return textValue;
  const children = asArray(node.children);
  return children.map((child) => textFromLexicalNode(child)).join("");
}

function parseBlockAlignment(value: unknown): BlockAlignment {
  const normalized = asString(value).trim().toLowerCase();
  if (normalized === "start") return "left";
  if (normalized === "end") return "right";
  if (normalized === "left" || normalized === "center" || normalized === "right" || normalized === "justify") {
    return normalized;
  }
  return "";
}

function buildInlineStyleFromTextNode(node: UnknownRecord): LexicalInlineStyle {
  const format = asNumber(node.format) ?? 0;
  const styles = parseStyleDeclarations(asString(node.style));
  const fontSizePx = parseLengthToPx(styles["font-size"] || "");
  return {
    bold: (format & FORMAT_BOLD) !== 0,
    italic: (format & FORMAT_ITALIC) !== 0,
    underline: (format & FORMAT_UNDERLINE) !== 0,
    strikethrough: (format & FORMAT_STRIKETHROUGH) !== 0,
    code: (format & FORMAT_CODE) !== 0,
    subscript: (format & FORMAT_SUBSCRIPT) !== 0,
    superscript: (format & FORMAT_SUPERSCRIPT) !== 0,
    fontSizeHalfPoints: fontSizePx ? pxToHalfPoints(fontSizePx) : undefined,
    colorHex: normalizeDocxColor(styles.color),
    highlight: mapHighlightColor(styles["background-color"]),
    fontFamily: normalizeFontFamily(styles["font-family"]),
  };
}

function parseInlineNode(rawNode: unknown): ExportInlineNode[] {
  if (!isRecord(rawNode)) return [];
  const type = asString(rawNode.type).trim().toLowerCase();

  if (type === "text") {
    const text = normalizeInlineText(asString(rawNode.text));
    if (!text) return [];
    return [
      {
        kind: "text",
        text,
        style: buildInlineStyleFromTextNode(rawNode),
      },
    ];
  }

  if (type === "linebreak") {
    return [{ kind: "break" }];
  }

  if (type === "tab") {
    return [{ kind: "text", text: "\t", style: buildInlineStyleFromTextNode(rawNode) }];
  }

  if (type === "link") {
    const url = asString(rawNode.url).trim();
    const children = asArray(rawNode.children).flatMap((child) => parseInlineNode(child));
    if (!url) return children;
    return [
      {
        kind: "link",
        url: url.slice(0, 2048),
        children,
      },
    ];
  }

  const fallbackText = textFromLexicalNode(rawNode);
  if (fallbackText) {
    return [
      {
        kind: "text",
        text: fallbackText,
        style: {
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          code: false,
          subscript: false,
          superscript: false,
        },
      },
    ];
  }
  return [];
}

function ensureInlineContent(inlines: ExportInlineNode[]) {
  if (inlines.length > 0) return inlines;
  return [
    {
      kind: "text" as const,
      text: "",
      style: {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        code: false,
        subscript: false,
        superscript: false,
      },
    },
  ];
}

function paragraphBlockFromNode(
  node: UnknownRecord,
  variant: ParagraphVariant,
  headingTag?: ParsedParagraphBlock["headingTag"],
): ParsedParagraphBlock {
  const inlines = asArray(node.children).flatMap((child) => parseInlineNode(child));
  const indentLevel = clampInt(asNumber(node.indent) ?? 0, 0, MAX_LIST_DEPTH);
  return {
    kind: "paragraph",
    variant,
    headingTag,
    alignment: parseBlockAlignment(node.format),
    indentLevel,
    inlines: ensureInlineContent(inlines),
  };
}

function parseListItemNode(rawNode: unknown): ParsedListItem {
  if (!isRecord(rawNode)) return { blocks: [], checked: null };
  const checkedRaw = rawNode.checked;
  const checked = typeof checkedRaw === "boolean" ? checkedRaw : null;
  const children = asArray(rawNode.children).flatMap((child) => parseBlockNode(child));
  return {
    blocks: children,
    checked,
  };
}

function parseListNode(node: UnknownRecord): ParsedListBlock {
  const rawListType = asString(node.listType).trim().toLowerCase();
  const listType: ParsedListBlock["listType"] =
    rawListType === "number" ? "number" : rawListType === "check" ? "check" : "bullet";
  const parsedStart = asNumber(node.start);
  const start = parsedStart && parsedStart > 0 ? Math.floor(parsedStart) : 1;
  const rawItems = asArray(node.children);
  const items = rawItems
    .filter((child) => isRecord(child) && asString(child.type).toLowerCase() === "listitem")
    .map((child) => parseListItemNode(child));

  return {
    kind: "list",
    listType,
    start,
    items: items.length > 0 ? items : [{ blocks: [], checked: null }],
  };
}

function parseTableCellNode(rawNode: unknown): ParsedTableCell {
  if (!isRecord(rawNode)) {
    return {
      blocks: [],
      header: false,
    };
  }

  const widthPx = asNumber(rawNode.width);
  const headerState = asNumber(rawNode.headerState) ?? 0;
  const colSpan = asNumber(rawNode.colSpan);
  const rowSpan = asNumber(rawNode.rowSpan);
  const verticalAlignRaw = asString(rawNode.verticalAlign).trim().toLowerCase();

  let verticalAlign: TableVerticalAlign | undefined;
  if (verticalAlignRaw === "center" || verticalAlignRaw === "middle") {
    verticalAlign = VerticalAlignTable.CENTER;
  } else if (verticalAlignRaw === "bottom") {
    verticalAlign = VerticalAlignTable.BOTTOM;
  } else if (verticalAlignRaw === "top") {
    verticalAlign = VerticalAlignTable.TOP;
  }

  const nestedBlocks = asArray(rawNode.children).flatMap((child) => parseBlockNode(child));

  return {
    blocks: nestedBlocks.length > 0 ? nestedBlocks : [],
    header: headerState > 0,
    colSpan: colSpan && colSpan > 1 ? clampInt(colSpan, 2, 64) : undefined,
    rowSpan: rowSpan && rowSpan > 1 ? clampInt(rowSpan, 2, 64) : undefined,
    widthPx: widthPx && widthPx > 0 ? clampInt(widthPx, 1, 10_000) : undefined,
    backgroundHex: normalizeDocxColor(asString(rawNode.backgroundColor)),
    verticalAlign,
  };
}

function parseTableNode(node: UnknownRecord): ParsedTableBlock | null {
  const rowsRaw = asArray(node.children);
  const rows: ParsedTableRow[] = [];
  const colWidthsPx: number[] = [];

  rowsRaw.forEach((rawRow, rowIndex) => {
    if (!isRecord(rawRow) || asString(rawRow.type).toLowerCase() !== "tablerow") return;
    const cellsRaw = asArray(rawRow.children);
    const cells = cellsRaw
      .filter((cell) => isRecord(cell) && asString(cell.type).toLowerCase() === "tablecell")
      .map((cell) => parseTableCellNode(cell));
    if (cells.length === 0) return;

    if (rowIndex === 0) {
      cells.forEach((cell) => {
        if (!cell.widthPx) return;
        if (cell.colSpan && cell.colSpan > 1) {
          const perCol = Math.max(1, Math.round(cell.widthPx / cell.colSpan));
          for (let i = 0; i < cell.colSpan; i += 1) {
            colWidthsPx.push(perCol);
          }
        } else {
          colWidthsPx.push(cell.widthPx);
        }
      });
    }

    rows.push({ cells });
  });

  if (rows.length === 0) return null;
  return {
    kind: "table",
    rows,
    colWidthsPx,
  };
}

function parseBlockNode(rawNode: unknown): ParsedBlock[] {
  if (!isRecord(rawNode)) return [];
  const type = asString(rawNode.type).trim().toLowerCase();

  if (type === "paragraph") {
    return [paragraphBlockFromNode(rawNode, "paragraph")];
  }
  if (type === "quote") {
    return [paragraphBlockFromNode(rawNode, "quote")];
  }
  if (type === "code") {
    return [paragraphBlockFromNode(rawNode, "code")];
  }
  if (type === "heading") {
    const tag = asString(rawNode.tag).trim().toLowerCase();
    const headingTag: ParsedParagraphBlock["headingTag"] =
      tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6"
        ? (tag as ParsedParagraphBlock["headingTag"])
        : "h2";
    return [paragraphBlockFromNode(rawNode, "heading", headingTag)];
  }
  if (type === "list") {
    return [parseListNode(rawNode)];
  }
  if (type === "table") {
    const parsed = parseTableNode(rawNode);
    if (parsed) return [parsed];
    return [];
  }
  if (type === "listitem" || type === "tablerow" || type === "tablecell") {
    return asArray(rawNode.children).flatMap((child) => parseBlockNode(child));
  }

  const fallbackText = textFromLexicalNode(rawNode);
  if (fallbackText.trim()) {
    return [
      {
        kind: "paragraph",
        variant: "paragraph",
        alignment: "",
        indentLevel: 0,
        inlines: [
          {
            kind: "text",
            text: fallbackText,
            style: {
              bold: false,
              italic: false,
              underline: false,
              strikethrough: false,
              code: false,
              subscript: false,
              superscript: false,
            },
          },
        ],
      },
    ];
  }

  return [];
}

function fallbackBlocksFromPlainText(plainText: string): ParsedBlock[] {
  const normalized = plainText.replace(/\r\n/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return [
      {
        kind: "paragraph",
        variant: "paragraph",
        alignment: "",
        indentLevel: 0,
        inlines: [
          {
            kind: "text",
            text: "",
            style: {
              bold: false,
              italic: false,
              underline: false,
              strikethrough: false,
              code: false,
              subscript: false,
              superscript: false,
            },
          },
        ],
      },
    ];
  }

  return paragraphs.map((paragraph) => ({
    kind: "paragraph" as const,
    variant: "paragraph" as const,
    alignment: "",
    indentLevel: 0,
    inlines: [
      {
        kind: "text" as const,
        text: paragraph,
        style: {
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          code: false,
          subscript: false,
          superscript: false,
        },
      },
    ],
  }));
}

function extractBlocksFromEditorState(editorState: LexicalEditorState | null, plainText: string): ParsedBlock[] {
  const root = isRecord(editorState?.root) ? (editorState?.root as UnknownRecord) : null;
  const rootChildren = root ? asArray(root.children) : [];
  const parsed = rootChildren.flatMap((child) => parseBlockNode(child));
  if (parsed.length > 0) return parsed;
  return fallbackBlocksFromPlainText(plainText);
}

function withDefaultTextStyle(partial?: Partial<LexicalInlineStyle>): LexicalInlineStyle {
  return {
    bold: Boolean(partial?.bold),
    italic: Boolean(partial?.italic),
    underline: Boolean(partial?.underline),
    strikethrough: Boolean(partial?.strikethrough),
    code: Boolean(partial?.code),
    subscript: Boolean(partial?.subscript),
    superscript: Boolean(partial?.superscript),
    fontSizeHalfPoints: partial?.fontSizeHalfPoints,
    colorHex: partial?.colorHex,
    highlight: partial?.highlight,
    fontFamily: partial?.fontFamily,
  };
}

function textFromInlines(inlines: ExportInlineNode[]): string {
  let out = "";
  for (const inline of inlines) {
    if (inline.kind === "text") {
      out += inline.text;
      continue;
    }
    if (inline.kind === "break") {
      out += "\n";
      continue;
    }
    out += textFromInlines(inline.children);
  }
  return out;
}

function alignmentToDocx(alignment: BlockAlignment) {
  if (alignment === "left") return AlignmentType.LEFT;
  if (alignment === "center") return AlignmentType.CENTER;
  if (alignment === "right") return AlignmentType.RIGHT;
  if (alignment === "justify") return AlignmentType.JUSTIFIED;
  return undefined;
}

function headingToDocxLevel(tag: ParsedParagraphBlock["headingTag"]) {
  if (tag === "h1") return HeadingLevel.HEADING_1;
  if (tag === "h2") return HeadingLevel.HEADING_2;
  if (tag === "h3") return HeadingLevel.HEADING_3;
  if (tag === "h4") return HeadingLevel.HEADING_4;
  if (tag === "h5") return HeadingLevel.HEADING_5;
  if (tag === "h6") return HeadingLevel.HEADING_6;
  return HeadingLevel.HEADING_2;
}

function buildTextRunFromStyle(
  text: string,
  style: LexicalInlineStyle,
  options?: { forceLinkLook?: boolean },
) {
  const runStyle = withDefaultTextStyle(style);
  const useLinkLook = Boolean(options?.forceLinkLook);
  const effectiveColor = runStyle.colorHex || (useLinkLook ? "0563C1" : undefined);

  return new TextRun({
    text,
    bold: runStyle.bold,
    italics: runStyle.italic,
    strike: runStyle.strikethrough,
    underline: runStyle.underline || useLinkLook ? { type: UnderlineType.SINGLE } : undefined,
    subScript: runStyle.subscript && !runStyle.superscript,
    superScript: runStyle.superscript,
    size: runStyle.fontSizeHalfPoints,
    color: effectiveColor,
    highlight: runStyle.highlight,
    font: runStyle.code ? "Consolas" : runStyle.fontFamily,
  });
}

function inlineNodesToParagraphChildren(inlines: ExportInlineNode[]): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  for (const inline of inlines) {
    if (inline.kind === "text") {
      const parts = inline.text.split("\n");
      parts.forEach((part, idx) => {
        children.push(buildTextRunFromStyle(part, inline.style));
        if (idx < parts.length - 1) {
          children.push(new TextRun({ text: "", break: 1 }));
        }
      });
      continue;
    }

    if (inline.kind === "break") {
      children.push(new TextRun({ text: "", break: 1 }));
      continue;
    }

    const linkChildren: ParagraphChild[] = [];
    for (const linkInline of inline.children) {
      if (linkInline.kind === "break") {
        linkChildren.push(new TextRun({ text: "", break: 1 }));
        continue;
      }
      if (linkInline.kind === "link") {
        const nestedText = textFromInlines(linkInline.children) || linkInline.url;
        linkChildren.push(
          buildTextRunFromStyle(nestedText, withDefaultTextStyle(), {
            forceLinkLook: true,
          }),
        );
        continue;
      }

      const parts = linkInline.text.split("\n");
      parts.forEach((part, idx) => {
        linkChildren.push(
          buildTextRunFromStyle(part, linkInline.style, {
            forceLinkLook: true,
          }),
        );
        if (idx < parts.length - 1) {
          linkChildren.push(new TextRun({ text: "", break: 1 }));
        }
      });
    }

    if (linkChildren.length === 0) {
      linkChildren.push(
        buildTextRunFromStyle(inline.url, withDefaultTextStyle(), {
          forceLinkLook: true,
        }),
      );
    }

    children.push(
      new ExternalHyperlink({
        link: inline.url,
        children: linkChildren,
      }),
    );
  }

  if (children.length === 0) {
    children.push(new TextRun(""));
  }
  return children;
}

function buildParagraphFromParsedBlock(
  block: ParsedParagraphBlock,
  options?: {
    listType?: ParsedListBlock["listType"];
    listLevel?: number;
    checklistChecked?: boolean | null;
    forceExtraIndentLevels?: number;
  },
) {
  const listLevel = clampInt(options?.listLevel ?? 0, 0, MAX_LIST_DEPTH);
  const indentLevels = clampInt(
    block.indentLevel + (options?.forceExtraIndentLevels ?? 0),
    0,
    MAX_LIST_DEPTH,
  );

  const codeAdjustedInlines =
    block.variant === "code"
      ? block.inlines.map((inline) => {
          if (inline.kind === "text") {
            return {
              ...inline,
              style: withDefaultTextStyle({
                ...inline.style,
                code: true,
              }),
            };
          }
          if (inline.kind === "link") {
            return {
              ...inline,
              children: inline.children.map((child) =>
                child.kind === "text"
                  ? {
                      ...child,
                      style: withDefaultTextStyle({
                        ...child.style,
                        code: true,
                      }),
                    }
                  : child,
              ),
            };
          }
          return inline;
        })
      : block.inlines;

  const baseChildren = inlineNodesToParagraphChildren(codeAdjustedInlines);
  const children =
    options?.listType === "check"
      ? [
          buildTextRunFromStyle(
            options.checklistChecked ? "[x] " : "[ ] ",
            withDefaultTextStyle(),
          ),
          ...baseChildren,
        ]
      : baseChildren;

  const spacing =
    block.variant === "heading"
      ? { before: 120, after: 160 }
      : block.variant === "quote"
        ? { before: 60, after: 120 }
        : block.variant === "code"
          ? { before: 60, after: 100 }
          : { after: 120 };

  const baseIndentLeft = indentLevels > 0 ? indentLevels * 600 : undefined;
  const quoteIndentLeft =
    block.variant === "quote" ? (baseIndentLeft || 0) + 600 : baseIndentLeft;

  const paragraphOptions: ConstructorParameters<typeof Paragraph>[0] = {
    children,
    alignment: alignmentToDocx(block.alignment),
    spacing,
    ...(block.variant === "heading" ? { heading: headingToDocxLevel(block.headingTag) } : {}),
    ...(options?.listType === "number"
      ? {
          numbering: {
            reference: ORDERED_LIST_REFERENCE,
            level: listLevel,
          },
        }
      : {}),
    ...(options?.listType === "bullet" || options?.listType === "check"
      ? { bullet: { level: listLevel } }
      : {}),
    ...(options?.listType ? {} : quoteIndentLeft ? { indent: { left: quoteIndentLeft } } : {}),
  };

  return new Paragraph(paragraphOptions);
}

function buildEmptyListMarkerParagraph(args: {
  listType: ParsedListBlock["listType"];
  listLevel: number;
  checklistChecked: boolean | null;
}) {
  const text = args.listType === "check" ? (args.checklistChecked ? "[x]" : "[ ]") : "";
  return buildParagraphFromParsedBlock(
    {
      kind: "paragraph",
      variant: "paragraph",
      alignment: "",
      indentLevel: 0,
      inlines: [
        {
          kind: "text",
          text,
          style: withDefaultTextStyle(),
        },
      ],
    },
    {
      listType: args.listType,
      listLevel: args.listLevel,
      checklistChecked: args.checklistChecked,
    },
  );
}

function tableCellChildrenFromBlocks(blocks: ParsedBlock[]) {
  const built = buildDocxChildrenFromBlocks(blocks);
  if (built.length === 0) {
    return [new Paragraph("")];
  }
  return built;
}
function buildTableFromParsedBlock(tableBlock: ParsedTableBlock) {
  const rows = tableBlock.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const cellChildren = tableCellChildrenFromBlocks(cell.blocks);
      return new TableCell({
        children: cellChildren,
        columnSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
        width: cell.widthPx
          ? {
              size: pxToTwip(cell.widthPx),
              type: WidthType.DXA,
            }
          : undefined,
        verticalAlign: cell.verticalAlign,
        shading: cell.backgroundHex
          ? {
              fill: cell.backgroundHex,
              color: "auto",
            }
          : cell.header
            ? {
                fill: "F1F5F9",
                color: "auto",
              }
            : undefined,
      });
    });
    return new TableRow({ children: cells });
  });

  const colWidths = tableBlock.colWidthsPx.map((width) => pxToTwip(width));
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: colWidths.length > 0 ? colWidths : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
    },
  });
}

function buildDocxChildrenFromListBlock(listBlock: ParsedListBlock, depth = 0): Array<Paragraph | Table> {
  const listLevel = clampInt(depth, 0, MAX_LIST_DEPTH);
  const result: Array<Paragraph | Table> = [];

  listBlock.items.forEach((item) => {
    const itemBlocks = item.blocks.length > 0 ? item.blocks : fallbackBlocksFromPlainText("");
    let markerApplied = false;

    for (const itemBlock of itemBlocks) {
      if (itemBlock.kind === "list") {
        result.push(...buildDocxChildrenFromListBlock(itemBlock, listLevel + 1));
        continue;
      }

      if (itemBlock.kind === "paragraph") {
        if (!markerApplied) {
          result.push(
            buildParagraphFromParsedBlock(itemBlock, {
              listType: listBlock.listType,
              listLevel,
              checklistChecked: item.checked,
            }),
          );
          markerApplied = true;
        } else {
          result.push(
            buildParagraphFromParsedBlock(itemBlock, {
              forceExtraIndentLevels: listLevel + 1,
            }),
          );
        }
        continue;
      }

      if (!markerApplied) {
        result.push(
          buildEmptyListMarkerParagraph({
            listType: listBlock.listType,
            listLevel,
            checklistChecked: item.checked,
          }),
        );
        markerApplied = true;
      }

      result.push(buildTableFromParsedBlock(itemBlock));
    }
  });

  return result;
}

function buildDocxChildrenFromBlocks(blocks: ParsedBlock[]): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      result.push(buildParagraphFromParsedBlock(block));
      continue;
    }
    if (block.kind === "list") {
      result.push(...buildDocxChildrenFromListBlock(block));
      continue;
    }
    result.push(buildTableFromParsedBlock(block));
  }
  if (result.length === 0) {
    result.push(new Paragraph(""));
  }
  return result;
}

async function buildDocxBuffer(blocks: ParsedBlock[], title: string) {
  const contentChildren = buildDocxChildrenFromBlocks(blocks);
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(title || "Document")],
      spacing: { after: 240 },
    }),
    ...contentChildren,
  ];

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REFERENCE,
          levels: Array.from({ length: MAX_LIST_DEPTH + 1 }, (_, index) => ({
            level: index,
            format: index % 3 === 1 ? "lowerLetter" : index % 3 === 2 ? "lowerRoman" : "decimal",
            text: `%${index + 1}.`,
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: {
                  left: 720 + index * 360,
                  hanging: 260,
                },
              },
            },
          })),
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

type PdfLine = {
  text: string;
  size: number;
  bold?: boolean;
  indent?: number;
};

function collectPdfLinesFromBlocks(
  blocks: ParsedBlock[],
  depth = 0,
  out: PdfLine[] = [],
) {
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      const text = textFromInlines(block.inlines).trim();
      if (!text) continue;
      if (block.variant === "heading") {
        out.push({
          text,
          size: block.headingTag === "h1" ? 16 : block.headingTag === "h2" ? 14 : 13,
          bold: true,
          indent: depth * 10,
        });
      } else if (block.variant === "quote") {
        out.push({ text, size: 11, indent: 16 + depth * 10 });
      } else {
        out.push({ text, size: 11, indent: depth * 10 });
      }
      continue;
    }

    if (block.kind === "list") {
      block.items.forEach((item, index) => {
        const listPrefix =
          block.listType === "number"
            ? `${block.start + index}. `
            : block.listType === "check"
              ? `${item.checked ? "[x]" : "[ ]"} `
              : "- ";

        const firstParagraph = item.blocks.find(
          (candidate) => candidate.kind === "paragraph",
        ) as ParsedParagraphBlock | undefined;

        if (firstParagraph) {
          const firstText = textFromInlines(firstParagraph.inlines).trim();
          if (firstText) {
            out.push({
              text: `${listPrefix}${firstText}`,
              size: 11,
              indent: depth * 12,
            });
          }
          const rest = item.blocks.filter((candidate) => candidate !== firstParagraph);
          collectPdfLinesFromBlocks(rest, depth + 1, out);
        } else {
          out.push({
            text: listPrefix.trim(),
            size: 11,
            indent: depth * 12,
          });
          collectPdfLinesFromBlocks(item.blocks, depth + 1, out);
        }
      });
      continue;
    }

    block.rows.forEach((row) => {
      const cellTexts = row.cells.map((cell) => {
        const parts: string[] = [];
        for (const cellBlock of cell.blocks) {
          if (cellBlock.kind === "paragraph") {
            const value = textFromInlines(cellBlock.inlines).trim();
            if (value) parts.push(value);
          } else if (cellBlock.kind === "list") {
            const before = parts.length;
            const nestedLines: PdfLine[] = [];
            collectPdfLinesFromBlocks([cellBlock], 0, nestedLines);
            const merged = nestedLines.map((line) => line.text).join(" ");
            if (merged) parts.push(merged);
            if (before === parts.length) parts.push("");
          }
        }
        return parts.join(" ").trim();
      });
      out.push({
        text: cellTexts.filter(Boolean).join(" | "),
        size: 10,
        indent: depth * 8,
      });
    });
  }
  return out;
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

async function buildPdfBuffer(blocks: ParsedBlock[], title: string) {
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

  const lines = collectPdfLinesFromBlocks(blocks);
  if (lines.length === 0) {
    drawTextBlock("", { size: 11 });
  } else {
    lines.forEach((line) => {
      drawTextBlock(line.text, {
        size: line.size,
        bold: line.bold,
        indent: line.indent,
      });
    });
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
    error instanceof Error
      ? error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
      : "Unknown export error";
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

