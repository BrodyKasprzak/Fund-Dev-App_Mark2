import { DOMParser } from "@xmldom/xmldom";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 1 << 1;
const FORMAT_STRIKETHROUGH = 1 << 2;
const FORMAT_UNDERLINE = 1 << 3;
const FORMAT_SUBSCRIPT = 1 << 5;
const FORMAT_SUPERSCRIPT = 1 << 6;

type StyleMap = Record<string, string>;

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

type SerializedBlockNode = {
  children: Array<SerializedInlineNode | SerializedListNode>;
  direction: null;
  format: "";
  indent: 0;
  type: "paragraph" | "heading" | "quote" | "listitem";
  version: 1;
  tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  value?: number;
};

type SerializedListNode = {
  children: SerializedBlockNode[];
  direction: null;
  format: "";
  indent: 0;
  listType: "bullet" | "number";
  start: number;
  tag: "ul" | "ol";
  type: "list";
  version: 1;
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

function parseStyleAttribute(raw: string | null | undefined): StyleMap {
  if (!raw) return {};
  const out: StyleMap = {};
  const allowed = new Set(["font-size", "color", "background-color", "font-family"]);
  for (const rule of raw.split(";")) {
    const [k, ...rest] = rule.split(":");
    if (!k || rest.length === 0) continue;
    const key = k.trim().toLowerCase();
    if (!allowed.has(key)) continue;
    const value = rest.join(":").trim();
    if (!value) continue;
    out[key] = value.slice(0, 64);
  }
  return out;
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

function baseMarks(): Marks {
  return { format: 0, styles: {} };
}

function applyElementMarks(node: unknown, current: Marks): Marks {
  const tag = toTagName(node);
  const next: Marks = {
    format: current.format,
    styles: cloneStyles(current.styles),
  };

  if (tag === "strong" || tag === "b") next.format |= FORMAT_BOLD;
  if (tag === "em" || tag === "i") next.format |= FORMAT_ITALIC;
  if (tag === "u") next.format |= FORMAT_UNDERLINE;
  if (tag === "s" || tag === "strike" || tag === "del") next.format |= FORMAT_STRIKETHROUGH;
  if (tag === "sup") next.format |= FORMAT_SUPERSCRIPT;
  if (tag === "sub") next.format |= FORMAT_SUBSCRIPT;

  const styleAttr = parseStyleAttribute(getAttr(node, "style"));
  next.styles = mergeStyles(next.styles, styleAttr);

  const fontWeight = (getAttr(node, "style") || "").toLowerCase();
  if (fontWeight.includes("font-weight") && (fontWeight.includes("bold") || /font-weight:\s*[5-9]00/.test(fontWeight))) {
    next.format |= FORMAT_BOLD;
  }
  if (fontWeight.includes("font-style: italic")) next.format |= FORMAT_ITALIC;
  if (fontWeight.includes("text-decoration") && fontWeight.includes("underline")) {
    next.format |= FORMAT_UNDERLINE;
  }
  if (fontWeight.includes("text-decoration") && fontWeight.includes("line-through")) {
    next.format |= FORMAT_STRIKETHROUGH;
  }

  return next;
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

function parseInlineNodes(node: unknown, marks: Marks): SerializedInlineNode[] {
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

  const nextMarks = applyElementMarks(node, marks);
  const parsedChildren = childNodes(node).flatMap((child) => parseInlineNodes(child, nextMarks));

  if (tag === "a") {
    const href = getAttr(node, "href");
    const url = (href || "").trim();
    if (!url) return parsedChildren;
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
  type: "paragraph" | "quote" = "paragraph",
): SerializedBlockNode {
  return {
    children: ensureInlineContent(children),
    direction: null,
    format: "",
    indent: 0,
    type,
    version: 1,
  };
}

function headingNode(
  children: SerializedInlineNode[],
  tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
): SerializedBlockNode {
  return {
    children: ensureInlineContent(children),
    direction: null,
    format: "",
    indent: 0,
    type: "heading",
    tag,
    version: 1,
  };
}

function parseListNode(node: unknown): SerializedListNode | null {
  const tag = toTagName(node);
  if (tag !== "ul" && tag !== "ol") return null;

  const listItems = childNodes(node)
    .filter((child) => nodeType(child) === ELEMENT_NODE && toTagName(child) === "li")
    .map((liNode, index) => {
      const inlineParts: SerializedInlineNode[] = [];
      const nestedLists: SerializedListNode[] = [];

      for (const liChild of childNodes(liNode)) {
        if (nodeType(liChild) === ELEMENT_NODE) {
          const childTag = toTagName(liChild);
          if (childTag === "ul" || childTag === "ol") {
            const nested = parseListNode(liChild);
            if (nested) nestedLists.push(nested);
            continue;
          }
        }
        inlineParts.push(...parseInlineNodes(liChild, baseMarks()));
      }

      const children: Array<SerializedInlineNode | SerializedListNode> = [
        ...ensureInlineContent(inlineParts),
        ...nestedLists,
      ];

      return {
        children,
        direction: null,
        format: "",
        indent: 0,
        type: "listitem",
        value: index + 1,
        version: 1,
      } satisfies SerializedBlockNode;
    });

  const startAttr = getAttr(node, "start");
  const parsedStart = Number(startAttr);
  const start = Number.isFinite(parsedStart) && parsedStart > 0 ? Math.floor(parsedStart) : 1;

  return {
    children: listItems.length ? listItems : [{ ...paragraphNode([], "paragraph"), type: "listitem", value: 1 }],
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

function parseBlockNode(node: unknown): SerializedBlockNode | SerializedListNode | null {
  if (nodeType(node) !== ELEMENT_NODE) return null;

  const tag = toTagName(node);
  const inline = childNodes(node).flatMap((child) => parseInlineNodes(child, baseMarks()));

  if (tag === "p") return paragraphNode(inline, "paragraph");
  if (tag === "blockquote") return paragraphNode(inline, "quote");
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
    return headingNode(inline, tag);
  }
  if (tag === "ul" || tag === "ol") return parseListNode(node);

  // Fallback block wrapper for unknown containers.
  return paragraphNode(inline, "paragraph");
}

function collectBlockNodes(node: unknown): Array<SerializedBlockNode | SerializedListNode> {
  const parsed = parseBlockNode(node);
  if (parsed) {
    const isWrapperParagraph =
      parsed.type === "paragraph" &&
      parsed.children.length === 1 &&
      parsed.children[0].type === "text" &&
      !parsed.children[0].text.trim() &&
      nodeType(node) === ELEMENT_NODE &&
      !["p", "blockquote"].includes(toTagName(node));
    if (!isWrapperParagraph) return [parsed];
  }

  const nested: Array<SerializedBlockNode | SerializedListNode> = [];
  for (const child of childNodes(node)) {
    nested.push(...collectBlockNodes(child));
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

export function lexicalEditorStateFromHtml(html: string): Record<string, unknown> | null {
  const normalized = (html || "").trim();
  if (!normalized) return null;

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
    return null;
  }

  const rootContainer = findRootContainer(parsed);
  const blockNodes: Array<SerializedBlockNode | SerializedListNode> = [];

  for (const child of childNodes(rootContainer)) {
    blockNodes.push(...collectBlockNodes(child));
  }

  if (!blockNodes.length) {
    blockNodes.push(paragraphNode([], "paragraph"));
  }

  return {
    root: {
      children: blockNodes,
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}
