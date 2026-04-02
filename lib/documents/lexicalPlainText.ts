type LexicalNode = {
  type?: unknown;
  text?: unknown;
  children?: unknown;
};

function normalizeBlockText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeFinalText(value: string, maxChars: number) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function textFromLexicalNode(node: LexicalNode): string {
  if (typeof node.text === "string") return node.text;

  if (node.type === "linebreak") return "\n";

  const children = Array.isArray(node.children) ? (node.children as unknown[]) : [];
  if (children.length === 0) return "";

  return children
    .map((child) => {
      if (!child || typeof child !== "object") return "";
      return textFromLexicalNode(child as LexicalNode);
    })
    .join("");
}

function blocksFromLexicalRoot(root: LexicalNode | null) {
  const children = Array.isArray(root?.children) ? (root.children as unknown[]) : [];
  if (children.length === 0) return [];

  const blocks: string[] = [];

  for (const rawChild of children) {
    if (!rawChild || typeof rawChild !== "object") continue;
    const child = rawChild as LexicalNode;
    const type = typeof child.type === "string" ? child.type : "";

    if (type === "list") {
      const listItems = Array.isArray(child.children) ? (child.children as unknown[]) : [];
      for (const rawItem of listItems) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const value = normalizeBlockText(textFromLexicalNode(rawItem as LexicalNode));
        if (value) blocks.push(value);
      }
      continue;
    }

    const value = normalizeBlockText(textFromLexicalNode(child));
    if (value) blocks.push(value);
  }

  return blocks;
}

export function derivePlainTextFromLexicalEditorState(
  editorState: Record<string, unknown> | null,
  maxChars = 200_000,
) {
  const lexicalRoot =
    editorState?.root && typeof editorState.root === "object"
      ? (editorState.root as LexicalNode)
      : null;

  const blocks = blocksFromLexicalRoot(lexicalRoot);
  const joined = blocks.join("\n\n");
  return normalizeFinalText(joined, maxChars);
}

