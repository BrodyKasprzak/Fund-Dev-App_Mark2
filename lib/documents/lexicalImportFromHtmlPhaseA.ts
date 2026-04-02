import { DOMParser } from "@xmldom/xmldom";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 1 << 1;
const FORMAT_STRIKETHROUGH = 1 << 2;
const FORMAT_UNDERLINE = 1 << 3;
const FORMAT_SUBSCRIPT = 1 << 5;
const FORMAT_SUPERSCRIPT = 1 << 6;

type ElementFormatType = "left" | "start" | "center" | "right" | "end" | "justify" | "";
type StyleMap = Record<string, string>;

type ParseContext = {
  mappedFeatures: Set<string>;
  downgradedFeatures: Set<string>;
};

type Marks = {
  format: number;
  styles: StyleMap;
};

type SerializedTextNode = {
  detail: number;
  format: number;
  mode: "normal";
  style: string;
  text: string;
  type: "text";
  version: 1;
};

type SerializedLinkNode = {
  children: SerializedInlineNode[];
  direction: null;
  format: "";
  indent: 0;
  rel: null;
  target: null;
  title: null;
  type: "link";
  url: string;
  version: 1;
};

type SerializedInlineNode = SerializedTextNode | SerializedLinkNode;

type SerializedParagraphNode = {
  children: SerializedInlineNode[];
  direction: null;
  format: ElementFormatType;
  indent: number;
  type: "paragraph" | "heading" | "quote";
  version: 1;
  tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
};

type SerializedListItemNode = {
  children: SerializedRootChildNode[];
  direction: null;
  format: ElementFormatType;
  indent: number;
  type: "listitem";
  version: 1;
  value?: number;
};

type SerializedListNode = {
  children: SerializedListItemNode[];
  direction: null;
  format: ElementFormatType;
  indent: number;
  listType: "bullet" | "number";
  start: number;
  tag: "ul" | "ol";
  type: "list";
  version: 1;
};

type SerializedTableCellNode = {
  children: SerializedRootChildNode[];
  direction: null;
  format: ElementFormatType;
  indent: 0;
  type: "tablecell";
  version: 1;
  headerState: number;
  colSpan?: number;
  rowSpan?: number;
  width?: number;
  backgroundColor?: string | null;
  verticalAlign?: string;
};

type SerializedTableRowNode = {
  children: SerializedTableCellNode[];
  direction: null;
  format: "";
  indent: 0;
  type: "tablerow";
  version: 1;
};

type SerializedTableNode = {
  children: SerializedTableRowNode[];
  direction: null;
  format: ElementFormatType;
  indent: 0;
  type: "table";
  version: 1;
  colWidths?: number[];
};

type SerializedRootChildNode =
  | SerializedParagraphNode
  | SerializedListNode
  | SerializedTableNode;

type BlockStyle = {
  format: ElementFormatType;
  indent: number;
};

export type LexicalImportPhaseASummary = {
  mappedFeatures: string[];
  downgradedFeatures: string[];
};

export type LexicalImportPhaseAResult = {
  editorState: Record<string, unknown> | null;
  summary: LexicalImportPhaseASummary;
};

function safeText(input: string) {
  return input.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeInlineText(input: string) {
  const value = safeText(input);
  if (!value.trim()) {
    return value.includes("\n") ? " " : value;
  }
  return value.replace(/[ \t]*\n[ \t]*/g, " ").replace(/[ \t]{2,}/g, " ");
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function cloneStyles(styles: StyleMap): StyleMap {
  return { ...styles };
}

function mergeStyles(base: StyleMap, extra: StyleMap) {
  return { ...base, ...extra };
}

function styleMapToLexicalStyle(styles: StyleMap) {
  const entries = Object.entries(styles).filter(([, value]) => Boolean(value && value.trim()));
  if (!entries.length) return "";
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}: ${v}`).join("; ");
}

function markMappedFeature(ctx: ParseContext, feature: string) {
  if (!feature) return;
  ctx.mappedFeatures.add(feature.slice(0, 80));
}

function markDowngradedFeature(ctx: ParseContext, feature: string) {
  if (!feature) return;
  ctx.downgradedFeatures.add(feature.slice(0, 80));
}

function parseStyleDeclarations(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const rule of raw.split(";")) {
    const [k, ...rest] = rule.split(":");
    if (!k || rest.length === 0) continue;
    const key = k.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!key || !value) continue;
    out[key] = value.slice(0, 128);
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

function parseInlineStyleMap(declarations: Record<string, string>): StyleMap {
  const out: StyleMap = {};
  const fontSize = declarations["font-size"];
  if (fontSize) out["font-size"] = fontSize.slice(0, 64);
  const color = declarations.color;
  if (color) out.color = color.slice(0, 64);
  const bg = declarations["background-color"];
  if (bg) out["background-color"] = bg.slice(0, 64);
  const family = declarations["font-family"];
  if (family) out["font-family"] = family.slice(0, 64);
  return out;
}

function parseBlockStyle(node: unknown, ctx: ParseContext): BlockStyle {
  const declarations = parseStyleDeclarations(getAttr(node, "style"));
  const alignFromStyle = declarations["text-align"]?.toLowerCase() || "";
  const alignFromAttr = (getAttr(node, "align") || "").trim().toLowerCase();
  const alignRaw = alignFromStyle || alignFromAttr;
  let format: ElementFormatType = "";
  if (alignRaw === "left" || alignRaw === "center" || alignRaw === "right" || alignRaw === "justify") {
    format = alignRaw;
    markMappedFeature(ctx, "paragraph_alignment");
  } else if (alignRaw === "start" || alignRaw === "end") {
    format = alignRaw;
    markMappedFeature(ctx, "paragraph_alignment");
  }

  const marginLeft = parseLengthToPx(declarations["margin-left"]) || 0;
  const paddingLeft = parseLengthToPx(declarations["padding-left"]) || 0;
  const textIndent = parseLengthToPx(declarations["text-indent"]) || 0;
  const totalIndentPx = Math.max(0, marginLeft + paddingLeft + textIndent);
  const indent = clampInt(Math.round(totalIndentPx / 40), 0, 7);
  if (indent > 0) {
    markMappedFeature(ctx, "paragraph_indent");
  }

  return { format, indent };
}

function textNode(text: string, marks: Marks): SerializedTextNode {
  return {
    detail: 0,
    format: marks.format,
    mode: "normal",
    style: styleMapToLexicalStyle(marks.styles),
    text,
    type: "text",
    version: 1,
  };
}

function emptyTextNode(): SerializedTextNode {
  return textNode("", { format: 0, styles: {} });
}

function ensureInlineContent(nodes: SerializedInlineNode[]) {
  if (nodes.length > 0) return nodes;
  return [emptyTextNode()];
}

function ensureBlockChildren(nodes: SerializedRootChildNode[]) {
  if (nodes.length > 0) return nodes;
  return [paragraphNode([], { format: "", indent: 0, type: "paragraph" })];
}

function toTagName(node: unknown) {
  if (!node || typeof node !== "object") return "";
  const candidate = (node as { tagName?: unknown }).tagName;
  return typeof candidate === "string" ? candidate.toLowerCase() : "";
}

function getAttr(node: unknown, key: string) {
  if (!node || typeof node !== "object") return null;
  const attrs = (node as { attributes?: unknown }).attributes as
    | {
        getNamedItem?: (name: string) => { value?: unknown } | null;
      }
    | undefined;
  if (!attrs?.getNamedItem) return null;
  const item = attrs.getNamedItem(key);
  if (!item) return null;
  return typeof item.value === "string" ? item.value : null;
}

function childNodes(node: unknown): unknown[] {
  if (!node || typeof node !== "object") return [];
  const list = (node as { childNodes?: unknown }).childNodes as
    | {
        length?: number;
        item?: (index: number) => unknown;
        [index: number]: unknown;
      }
    | undefined;
  if (!list || typeof list.length !== "number") return [];
  const result: unknown[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = typeof list.item === "function" ? list.item(i) : list[i];
    if (item) result.push(item);
  }
  return result;
}

function nodeType(node: unknown) {
  if (!node || typeof node !== "object") return 0;
  const value = (node as { nodeType?: unknown }).nodeType;
  return typeof value === "number" ? value : 0;
}

function nodeValue(node: unknown) {
  if (!node || typeof node !== "object") return "";
  const value = (node as { nodeValue?: unknown }).nodeValue;
  return typeof value === "string" ? value : "";
}

function baseMarks(): Marks {
  return { format: 0, styles: {} };
}

function applyElementMarks(node: unknown, current: Marks, ctx: ParseContext): Marks {
  const tag = toTagName(node);
  const next: Marks = {
    format: current.format,
    styles: cloneStyles(current.styles),
  };

  if (tag === "strong" || tag === "b") {
    next.format |= FORMAT_BOLD;
    markMappedFeature(ctx, "inline_styles.bold");
  }
  if (tag === "em" || tag === "i") {
    next.format |= FORMAT_ITALIC;
    markMappedFeature(ctx, "inline_styles.italic");
  }
  if (tag === "u") {
    next.format |= FORMAT_UNDERLINE;
    markMappedFeature(ctx, "inline_styles.underline");
  }
  if (tag === "s" || tag === "strike" || tag === "del") {
    next.format |= FORMAT_STRIKETHROUGH;
    markMappedFeature(ctx, "inline_styles.strikethrough");
  }
  if (tag === "sup") next.format |= FORMAT_SUPERSCRIPT;
  if (tag === "sub") next.format |= FORMAT_SUBSCRIPT;

  const declarations = parseStyleDeclarations(getAttr(node, "style"));
  const styleAttr = parseInlineStyleMap(declarations);
  if (styleAttr["font-size"]) markMappedFeature(ctx, "inline_styles.font_size");
  if (styleAttr.color) markMappedFeature(ctx, "inline_styles.color");
  if (styleAttr["background-color"]) markMappedFeature(ctx, "inline_styles.highlight");
  if (styleAttr["font-family"]) markMappedFeature(ctx, "inline_styles.font_family");
  next.styles = mergeStyles(next.styles, styleAttr);

  const fontWeight = (declarations["font-weight"] || "").toLowerCase();
  if (fontWeight.includes("bold") || /^[5-9]00$/.test(fontWeight)) {
    next.format |= FORMAT_BOLD;
    markMappedFeature(ctx, "inline_styles.bold");
  }
  if ((declarations["font-style"] || "").toLowerCase() === "italic") {
    next.format |= FORMAT_ITALIC;
    markMappedFeature(ctx, "inline_styles.italic");
  }
  const textDecoration = (declarations["text-decoration"] || "").toLowerCase();
  if (textDecoration.includes("underline")) {
    next.format |= FORMAT_UNDERLINE;
    markMappedFeature(ctx, "inline_styles.underline");
  }
  if (textDecoration.includes("line-through")) {
    next.format |= FORMAT_STRIKETHROUGH;
    markMappedFeature(ctx, "inline_styles.strikethrough");
  }

  return next;
}

function parseInlineNodes(node: unknown, marks: Marks, ctx: ParseContext): SerializedInlineNode[] {
  const nType = nodeType(node);
  if (nType === TEXT_NODE) {
    const text = normalizeInlineText(nodeValue(node));
    if (!text) return [];
    return [textNode(text, marks)];
  }

  if (nType !== ELEMENT_NODE) return [];

  const tag = toTagName(node);
  if (tag === "br") {
    return [textNode("\n", marks)];
  }
  if (tag === "script" || tag === "style") {
    markDowngradedFeature(ctx, `unsupported_${tag}`);
    return [];
  }
  if (tag === "img" || tag === "svg" || tag === "canvas" || tag === "video" || tag === "audio") {
    markDowngradedFeature(ctx, "unsupported_media");
    return [];
  }

  const nextMarks = applyElementMarks(node, marks, ctx);
  const parsedChildren = childNodes(node).flatMap((child) => parseInlineNodes(child, nextMarks, ctx));

  if (tag === "a") {
    const href = getAttr(node, "href");
    const url = (href || "").trim();
    if (!url) return parsedChildren;
    markMappedFeature(ctx, "links");
    return [
      {
        children: ensureInlineContent(parsedChildren),
        direction: null,
        format: "",
        indent: 0,
        rel: null,
        target: null,
        title: null,
        type: "link",
        url: url.slice(0, 2048),
        version: 1,
      },
    ];
  }

  return parsedChildren;
}

function paragraphNode(
  children: SerializedInlineNode[],
  options: {
    format: ElementFormatType;
    indent: number;
    type: "paragraph" | "quote";
  },
): SerializedParagraphNode {
  return {
    children: ensureInlineContent(children),
    direction: null,
    format: options.format,
    indent: options.indent,
    type: options.type,
    version: 1,
  };
}

function headingNode(
  children: SerializedInlineNode[],
  tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  style: BlockStyle,
): SerializedParagraphNode {
  return {
    children: ensureInlineContent(children),
    direction: null,
    format: style.format,
    indent: style.indent,
    type: "heading",
    tag,
    version: 1,
  };
}

function listItemNode(children: SerializedRootChildNode[], value?: number): SerializedListItemNode {
  return {
    children: ensureBlockChildren(children),
    direction: null,
    format: "",
    indent: 0,
    type: "listitem",
    value,
    version: 1,
  };
}

function isBlockTag(tag: string) {
  return (
    tag === "p" ||
    tag === "div" ||
    tag === "blockquote" ||
    tag === "pre" ||
    tag === "ul" ||
    tag === "ol" ||
    tag === "table" ||
    tag === "li" ||
    tag === "thead" ||
    tag === "tbody" ||
    tag === "tfoot" ||
    tag === "tr" ||
    tag === "td" ||
    tag === "th" ||
    tag === "h1" ||
    tag === "h2" ||
    tag === "h3" ||
    tag === "h4" ||
    tag === "h5" ||
    tag === "h6"
  );
}

function collectMixedContentAsBlocks(
  node: unknown,
  ctx: ParseContext,
  options?: { insideListItem?: boolean },
): SerializedRootChildNode[] {
  const children = childNodes(node);
  const blocks: SerializedRootChildNode[] = [];
  let inlineBuffer: SerializedInlineNode[] = [];

  const flushInlineBuffer = () => {
    if (!inlineBuffer.length) return;
    blocks.push(
      paragraphNode(inlineBuffer, {
        format: "",
        indent: 0,
        type: "paragraph",
      }),
    );
    inlineBuffer = [];
  };

  for (const child of children) {
    if (nodeType(child) === ELEMENT_NODE) {
      const tag = toTagName(child);
      if (tag === "ul" || tag === "ol" || isBlockTag(tag)) {
        if (options?.insideListItem && (tag === "ul" || tag === "ol")) {
          markMappedFeature(ctx, "nested_lists");
        }
        flushInlineBuffer();
        const nestedBlocks = parseBlockNodes(child, ctx);
        blocks.push(...nestedBlocks);
        continue;
      }
    }

    inlineBuffer.push(...parseInlineNodes(child, baseMarks(), ctx));
  }

  flushInlineBuffer();
  return blocks;
}

function parseListNode(node: unknown, ctx: ParseContext): SerializedListNode | null {
  const tag = toTagName(node);
  if (tag !== "ul" && tag !== "ol") return null;
  markMappedFeature(ctx, "lists");

  const listItems = childNodes(node)
    .filter((child) => nodeType(child) === ELEMENT_NODE && toTagName(child) === "li")
    .map((liNode, index) => {
      const children = collectMixedContentAsBlocks(liNode, ctx, { insideListItem: true });
      return listItemNode(children, index + 1);
    });

  const startAttr = getAttr(node, "start");
  const parsedStart = Number(startAttr);
  const start = Number.isFinite(parsedStart) && parsedStart > 0 ? Math.floor(parsedStart) : 1;

  return {
    children: listItems.length ? listItems : [listItemNode([], 1)],
    direction: null,
    format: "",
    indent: 0,
    listType: tag === "ol" ? "number" : "bullet",
    start,
    tag,
    type: "list",
    version: 1,
  };
}

function parseTableRows(node: unknown) {
  const rows: unknown[] = [];
  for (const child of childNodes(node)) {
    if (nodeType(child) !== ELEMENT_NODE) continue;
    const tag = toTagName(child);
    if (tag === "tr") {
      rows.push(child);
      continue;
    }
    if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
      for (const row of childNodes(child)) {
        if (nodeType(row) === ELEMENT_NODE && toTagName(row) === "tr") {
          rows.push(row);
        }
      }
    }
  }
  return rows;
}

function parseTableNode(node: unknown, ctx: ParseContext): SerializedTableNode | null {
  if (toTagName(node) !== "table") return null;

  const rows = parseTableRows(node);
  if (!rows.length) {
    markDowngradedFeature(ctx, "table_without_rows");
    return null;
  }

  const serializedRows: SerializedTableRowNode[] = [];
  const colWidths: number[] = [];

  rows.forEach((row, rowIndex) => {
    const cells = childNodes(row).filter((cell) => {
      if (nodeType(cell) !== ELEMENT_NODE) return false;
      const tag = toTagName(cell);
      return tag === "th" || tag === "td";
    });

    if (!cells.length) return;

    const serializedCells: SerializedTableCellNode[] = cells.map((cell) => {
      const cellTag = toTagName(cell);
      const declarations = parseStyleDeclarations(getAttr(cell, "style"));

      const colSpanRaw = Number(getAttr(cell, "colspan"));
      const colSpan = Number.isFinite(colSpanRaw) && colSpanRaw > 1 ? Math.floor(colSpanRaw) : undefined;

      const rowSpanRaw = Number(getAttr(cell, "rowspan"));
      const rowSpan = Number.isFinite(rowSpanRaw) && rowSpanRaw > 1 ? Math.floor(rowSpanRaw) : undefined;

      const widthFromStyle = parseLengthToPx(declarations.width);
      const widthFromAttr = parseLengthToPx(getAttr(cell, "width"));
      const widthRaw = widthFromStyle ?? widthFromAttr;
      const width = widthRaw && widthRaw > 0 ? clampInt(widthRaw, 1, 10_000) : undefined;

      const backgroundColor = declarations["background-color"] || null;
      const verticalAlign = declarations["vertical-align"] || undefined;
      const cellBlocks = collectMixedContentAsBlocks(cell, ctx);

      return {
        children: ensureBlockChildren(cellBlocks),
        direction: null,
        format: "",
        indent: 0,
        type: "tablecell",
        version: 1,
        headerState: cellTag === "th" ? 1 : 0,
        colSpan,
        rowSpan,
        width,
        backgroundColor: backgroundColor ? backgroundColor.slice(0, 64) : null,
        verticalAlign: verticalAlign ? verticalAlign.slice(0, 24) : undefined,
      };
    });

    if (rowIndex === 0) {
      for (const cell of serializedCells) {
        if (cell.width && cell.colSpan !== undefined && cell.colSpan > 1) {
          const perCol = Math.max(1, Math.round(cell.width / cell.colSpan));
          for (let i = 0; i < cell.colSpan; i += 1) {
            colWidths.push(perCol);
          }
        } else if (cell.width) {
          colWidths.push(cell.width);
        }
      }
    }

    serializedRows.push({
      children: serializedCells.length
        ? serializedCells
        : [
            {
              children: ensureBlockChildren([]),
              direction: null,
              format: "",
              indent: 0,
              type: "tablecell",
              version: 1,
              headerState: 0,
            },
          ],
      direction: null,
      format: "",
      indent: 0,
      type: "tablerow",
      version: 1,
    });
  });

  if (!serializedRows.length) {
    markDowngradedFeature(ctx, "table_rows_dropped");
    return null;
  }

  markMappedFeature(ctx, "tables");
  return {
    children: serializedRows,
    direction: null,
    format: "",
    indent: 0,
    type: "table",
    version: 1,
    colWidths: colWidths.length ? colWidths : undefined,
  };
}

function parseBlockNodes(node: unknown, ctx: ParseContext): SerializedRootChildNode[] {
  if (nodeType(node) !== ELEMENT_NODE) return [];

  const tag = toTagName(node);
  const blockStyle = parseBlockStyle(node, ctx);

  if (tag === "p" || tag === "div") {
    const hasNestedBlocks = childNodes(node).some((child) => {
      if (nodeType(child) !== ELEMENT_NODE) return false;
      const childTag = toTagName(child);
      return isBlockTag(childTag);
    });
    if (hasNestedBlocks) {
      const nested = collectMixedContentAsBlocks(node, ctx);
      if (nested.length > 0) return nested;
    }
    const inline = childNodes(node).flatMap((child) => parseInlineNodes(child, baseMarks(), ctx));
    return [paragraphNode(inline, { ...blockStyle, type: "paragraph" })];
  }

  if (tag === "blockquote") {
    const inline = childNodes(node).flatMap((child) => parseInlineNodes(child, baseMarks(), ctx));
    return [paragraphNode(inline, { ...blockStyle, type: "quote" })];
  }

  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
    const inline = childNodes(node).flatMap((child) => parseInlineNodes(child, baseMarks(), ctx));
    markMappedFeature(ctx, "headings");
    return [headingNode(inline, tag, blockStyle)];
  }

  if (tag === "ul" || tag === "ol") {
    const parsedList = parseListNode(node, ctx);
    return parsedList ? [parsedList] : [];
  }

  if (tag === "table") {
    const parsedTable = parseTableNode(node, ctx);
    if (parsedTable) return [parsedTable];
    const fallbackInline = childNodes(node).flatMap((child) => parseInlineNodes(child, baseMarks(), ctx));
    return [paragraphNode(fallbackInline, { format: "", indent: 0, type: "paragraph" })];
  }

  if (tag === "pre") {
    const inline = childNodes(node).flatMap((child) => parseInlineNodes(child, baseMarks(), ctx));
    return [paragraphNode(inline, { ...blockStyle, type: "paragraph" })];
  }

  if (tag === "li") {
    const inline = childNodes(node).flatMap((child) => parseInlineNodes(child, baseMarks(), ctx));
    return [paragraphNode(inline, { format: "", indent: 0, type: "paragraph" })];
  }

  // Fallback block wrapper for unknown containers.
  const mixed = collectMixedContentAsBlocks(node, ctx);
  if (mixed.length > 0) {
    markDowngradedFeature(ctx, `wrapped_${tag || "unknown"}_container`);
    return mixed;
  }

  return [];
}

function collectBlockNodes(node: unknown, ctx: ParseContext): SerializedRootChildNode[] {
  const parsed = parseBlockNodes(node, ctx);
  if (parsed.length > 0) return parsed;

  const nested: SerializedRootChildNode[] = [];
  for (const child of childNodes(node)) {
    nested.push(...collectBlockNodes(child, ctx));
  }
  return nested;
}

function findRootContainer(documentNode: unknown): unknown {
  const documentChildren = childNodes(documentNode);
  const htmlNode =
    documentChildren.find(
      (child) => nodeType(child) === ELEMENT_NODE && toTagName(child) === "html",
    ) || null;
  if (!htmlNode) return documentNode;

  const htmlChildren = childNodes(htmlNode);
  const bodyNode =
    htmlChildren.find((child) => nodeType(child) === ELEMENT_NODE && toTagName(child) === "body") ||
    null;
  return bodyNode || htmlNode;
}

export function lexicalEditorStateFromHtmlPhaseA(html: string): LexicalImportPhaseAResult {
  const ctx: ParseContext = {
    mappedFeatures: new Set<string>(),
    downgradedFeatures: new Set<string>(),
  };

  const normalized = (html || "").trim();
  if (!normalized) {
    return {
      editorState: null,
      summary: { mappedFeatures: [], downgradedFeatures: [] },
    };
  }

  let parsed: unknown;
  try {
    const parser = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: () => undefined,
        fatalError: () => undefined,
      },
    });
    parsed = parser.parseFromString(`<html><body>${normalized}</body></html>`, "text/html");
  } catch {
    return {
      editorState: null,
      summary: { mappedFeatures: [], downgradedFeatures: ["html_parse_error"] },
    };
  }

  const rootContainer = findRootContainer(parsed);
  const blockNodes: SerializedRootChildNode[] = [];

  for (const child of childNodes(rootContainer)) {
    blockNodes.push(...collectBlockNodes(child, ctx));
  }

  if (!blockNodes.length) {
    blockNodes.push(
      paragraphNode([], {
        format: "",
        indent: 0,
        type: "paragraph",
      }),
    );
  }

  return {
    editorState: {
      root: {
        children: blockNodes,
        direction: null,
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    },
    summary: {
      mappedFeatures: Array.from(ctx.mappedFeatures).sort(),
      downgradedFeatures: Array.from(ctx.downgradedFeatures).sort(),
    },
  };
}
