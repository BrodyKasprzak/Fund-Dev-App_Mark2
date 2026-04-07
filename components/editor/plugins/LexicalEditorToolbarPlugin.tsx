"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  type ListType,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from "@lexical/rich-text";
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
  $setBlocksType,
} from "@lexical/selection";
import {
  $createParagraphNode,
  type ElementNode,
  $getRoot,
  $findMatchingParent,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type ElementFormatType,
  type LexicalEditor,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";

type ToolbarBlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "quote"
  | "code";
type ToolbarAlignment = "left" | "center" | "right" | "justify";
type ToolbarListType = ListType | null;

type ToolbarState = {
  canUndo: boolean;
  canRedo: boolean;
  blockType: ToolbarBlockType;
  alignment: ToolbarAlignment;
  listType: ToolbarListType;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikethrough: boolean;
  isInlineCode: boolean;
  isLink: boolean;
  fontSize: string;
  fontFamily: string;
  lineSpacing: string;
  textColor: string;
  highlight: string;
};

type ToolbarPluginProps = {
  readOnly?: boolean;
};

const DEFAULT_FONT_SIZE = "11pt";
const DEFAULT_FONT_FAMILY = "Calibri";
const DEFAULT_TEXT_COLOR = "#111827";
const DEFAULT_HIGHLIGHT = "transparent";
const DEFAULT_LINE_SPACING = "1.15";
const WORD_POINT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const FONT_SIZE_OPTIONS = WORD_POINT_SIZES.map((size) => `${size}pt`);
const LINE_SPACING_OPTIONS = [
  { label: "Single", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "Double", value: "2" },
] as const;
const FONT_FAMILY_OPTIONS = [
  { label: "Calibri", value: "Calibri" },
  { label: "Arial", value: "Arial" },
  { label: "Times New Roman", value: "\"Times New Roman\"" },
  { label: "Georgia", value: "Georgia" },
  { label: "Verdana", value: "Verdana" },
  { label: "Tahoma", value: "Tahoma" },
  { label: "Trebuchet MS", value: "\"Trebuchet MS\"" },
  { label: "Courier New", value: "\"Courier New\"" },
];
const TEXT_COLOR_OPTIONS = [
  { label: "Auto", value: DEFAULT_TEXT_COLOR },
  { label: "Black", value: "#000000" },
  { label: "Gray", value: "#374151" },
  { label: "Red", value: "#b91c1c" },
  { label: "Orange", value: "#c2410c" },
  { label: "Gold", value: "#a16207" },
  { label: "Green", value: "#166534" },
  { label: "Blue", value: "#1d4ed8" },
  { label: "Purple", value: "#7e22ce" },
];
const HIGHLIGHT_OPTIONS = [
  { label: "None", value: "transparent" },
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Rose", value: "#fecdd3" },
];

const INITIAL_TOOLBAR_STATE: ToolbarState = {
  canUndo: false,
  canRedo: false,
  blockType: "paragraph",
  alignment: "left",
  listType: null,
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  isInlineCode: false,
  isLink: false,
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  lineSpacing: DEFAULT_LINE_SPACING,
  textColor: DEFAULT_TEXT_COLOR,
  highlight: DEFAULT_HIGHLIGHT,
};

function normalizeAlignment(value: ElementFormatType | ""): ToolbarAlignment {
  if (value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

function normalizeFontSize(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_FONT_SIZE;
  const match = normalized.match(/^(\d+(?:\.\d+)?)(pt|px)?$/);
  if (!match) return DEFAULT_FONT_SIZE;

  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_FONT_SIZE;
  const unit = match[2] || "pt";
  const points = unit === "px" ? (raw * 72) / 96 : raw;

  const nearest = WORD_POINT_SIZES.reduce((best, candidate) => {
    return Math.abs(candidate - points) < Math.abs(best - points) ? candidate : best;
  }, WORD_POINT_SIZES[0]);
  return `${nearest}pt`;
}

function normalizeFontFamily(value: string) {
  const normalized = value.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!normalized) return DEFAULT_FONT_FAMILY;
  const matched = FONT_FAMILY_OPTIONS.find((option) => {
    const candidate = option.value.replace(/^["']|["']$/g, "").toLowerCase();
    return candidate === normalized;
  });
  return matched?.value || DEFAULT_FONT_FAMILY;
}

function normalizeLineSpacing(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_LINE_SPACING;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LINE_SPACING;
  const nearest = LINE_SPACING_OPTIONS.reduce((best, option) => {
    const current = Number.parseFloat(option.value);
    return Math.abs(current - parsed) < Math.abs(best - parsed) ? current : best;
  }, Number.parseFloat(DEFAULT_LINE_SPACING));
  return String(nearest);
}

function normalizeTextColor(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_TEXT_COLOR;

  const shortHex = normalized.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    const hex = `#${r}${r}${g}${g}${b}${b}`;
    return TEXT_COLOR_OPTIONS.some((option) => option.value === hex)
      ? hex
      : DEFAULT_TEXT_COLOR;
  }

  const longHex = normalized.match(/^#([0-9a-f]{6})$/i);
  if (longHex) {
    const hex = `#${longHex[1].toLowerCase()}`;
    return TEXT_COLOR_OPTIONS.some((option) => option.value === hex)
      ? hex
      : DEFAULT_TEXT_COLOR;
  }

  const rgbMatch = normalized.match(/^rgb\((.+)\)$/);
  if (!rgbMatch) return DEFAULT_TEXT_COLOR;
  const channels = rgbMatch[1].split(",").map((part) => part.trim());
  if (channels.length < 3) return DEFAULT_TEXT_COLOR;

  const nums = channels.slice(0, 3).map((raw) => Number(raw));
  if (nums.some((num) => !Number.isFinite(num))) return DEFAULT_TEXT_COLOR;
  const toHex = (num: number) => Math.max(0, Math.min(255, Math.round(num))).toString(16).padStart(2, "0");
  const hex = `#${toHex(nums[0])}${toHex(nums[1])}${toHex(nums[2])}`;
  return TEXT_COLOR_OPTIONS.some((option) => option.value === hex)
    ? hex
    : DEFAULT_TEXT_COLOR;
}

function normalizeHighlight(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "transparent") return DEFAULT_HIGHLIGHT;
  return normalized;
}

function normalizeUrl(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (value.includes("@") && !value.includes(" ")) return `mailto:${value}`;
  return `https://${value}`;
}

function readStyleProperty(style: string, property: string) {
  const target = property.trim().toLowerCase();
  if (!target) return "";
  const declarations = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const declaration of declarations) {
    const idx = declaration.indexOf(":");
    if (idx <= 0) continue;
    const key = declaration.slice(0, idx).trim().toLowerCase();
    if (key !== target) continue;
    return declaration.slice(idx + 1).trim();
  }
  return "";
}

function writeStyleProperty(style: string, property: string, value: string | null) {
  const target = property.trim().toLowerCase();
  const map = new Map<string, string>();
  const declarations = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const declaration of declarations) {
    const idx = declaration.indexOf(":");
    if (idx <= 0) continue;
    const key = declaration.slice(0, idx).trim().toLowerCase();
    const val = declaration.slice(idx + 1).trim();
    if (key && val) map.set(key, val);
  }
  if (value === null || value.trim().length === 0) map.delete(target);
  else map.set(target, value.trim());
  return [...map.entries()].map(([key, val]) => `${key}: ${val}`).join("; ");
}

function isSameToolbarState(a: ToolbarState, b: ToolbarState) {
  return (
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.blockType === b.blockType &&
    a.alignment === b.alignment &&
    a.listType === b.listType &&
    a.isBold === b.isBold &&
    a.isItalic === b.isItalic &&
    a.isUnderline === b.isUnderline &&
    a.isStrikethrough === b.isStrikethrough &&
    a.isInlineCode === b.isInlineCode &&
    a.isLink === b.isLink &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.lineSpacing === b.lineSpacing &&
    a.textColor === b.textColor &&
    a.highlight === b.highlight
  );
}

function readToolbarState(editor: LexicalEditor): ToolbarState {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return INITIAL_TOOLBAR_STATE;

    const anchorNode = selection.anchor.getNode();
    const topLevel = anchorNode.getTopLevelElementOrThrow();
    const listNode = $findMatchingParent(anchorNode, $isListNode);
    const linkNode = $findMatchingParent(anchorNode, $isLinkNode);

    let blockType: ToolbarBlockType = "paragraph";
    if ($isHeadingNode(topLevel)) {
      const tag = topLevel.getTag();
      if (
        tag === "h1" ||
        tag === "h2" ||
        tag === "h3" ||
        tag === "h4" ||
        tag === "h5" ||
        tag === "h6"
      )
        blockType = tag;
      else blockType = "paragraph";
    } else if ($isQuoteNode(topLevel)) {
      blockType = "quote";
    } else if ($isCodeNode(topLevel)) {
      blockType = "code";
    }

    const lineSpacingFromBlock = $isElementNode(topLevel)
      ? readStyleProperty(topLevel.getStyle(), "line-height")
      : "";

    return {
      ...INITIAL_TOOLBAR_STATE,
      blockType,
      alignment: $isElementNode(topLevel)
        ? normalizeAlignment(topLevel.getFormatType())
        : "left",
      listType: listNode ? listNode.getListType() : null,
      isBold: selection.hasFormat("bold"),
      isItalic: selection.hasFormat("italic"),
      isUnderline: selection.hasFormat("underline"),
      isStrikethrough: selection.hasFormat("strikethrough"),
      isInlineCode: selection.hasFormat("code"),
      isLink: Boolean(linkNode),
      fontSize: normalizeFontSize(
        $getSelectionStyleValueForProperty(selection, "font-size", DEFAULT_FONT_SIZE),
      ),
      fontFamily: normalizeFontFamily(
        $getSelectionStyleValueForProperty(selection, "font-family", DEFAULT_FONT_FAMILY),
      ),
      lineSpacing: normalizeLineSpacing(
        lineSpacingFromBlock ||
          $getSelectionStyleValueForProperty(selection, "line-height", DEFAULT_LINE_SPACING),
      ),
      textColor: normalizeTextColor(
        $getSelectionStyleValueForProperty(selection, "color", DEFAULT_TEXT_COLOR),
      ),
      highlight: normalizeHighlight(
        $getSelectionStyleValueForProperty(
          selection,
          "background-color",
          DEFAULT_HIGHLIGHT,
        ),
      ),
    };
  });
}

function getSelectedTopLevelElements(includeAllWhenSelectionMissing = false) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    if (!includeAllWhenSelectionMissing) return [] as ElementNode[];
    return $getRoot()
      .getChildren()
      .filter((node): node is ElementNode => $isElementNode(node));
  }
  const elements = new Map<string, ElementNode>();
  for (const node of selection.getNodes()) {
    const topLevel = node.getTopLevelElementOrThrow();
    if ($isElementNode(topLevel)) elements.set(topLevel.getKey(), topLevel);
  }
  if (elements.size === 0) {
    const anchorTopLevel = selection.anchor.getNode().getTopLevelElementOrThrow();
    if ($isElementNode(anchorTopLevel)) elements.set(anchorTopLevel.getKey(), anchorTopLevel);
  }
  return [...elements.values()];
}

function applyLineSpacing(editor: LexicalEditor, value: string) {
  const normalized = normalizeLineSpacing(value);
  editor.focus(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { "line-height": normalized });
      }
      const elements = getSelectedTopLevelElements(true);
      for (const element of elements) {
        const nextStyle = writeStyleProperty(element.getStyle(), "line-height", normalized);
        element.setStyle(nextStyle);
      }
    });
  });
}

function ToolbarButton(args: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const { label, onClick, active = false, disabled = false } = args;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded border px-2 py-1 text-xs font-semibold transition ${
        active
          ? "border-sky-600 bg-sky-50 text-sky-700"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {label}
    </button>
  );
}

function applyTextStyle(editor: LexicalEditor, style: Record<string, string | null>) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    $patchStyleText(selection, style);
  });
}

function applyBlockType(editor: LexicalEditor, blockType: ToolbarBlockType) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    if (blockType === "paragraph") {
      $setBlocksType(selection, () => $createParagraphNode());
      return;
    }
    if (
      blockType === "h1" ||
      blockType === "h2" ||
      blockType === "h3" ||
      blockType === "h4" ||
      blockType === "h5" ||
      blockType === "h6"
    ) {
      $setBlocksType(selection, () => $createHeadingNode(blockType));
      return;
    }
    if (blockType === "quote") {
      $setBlocksType(selection, () => $createQuoteNode());
      return;
    }
    $setBlocksType(selection, () => $createCodeNode());
  });
}

function clearFormatting(editor: LexicalEditor) {
  editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left");
  editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);

  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    $setBlocksType(selection, () => $createParagraphNode());
    $patchStyleText(selection, {
      "font-size": null,
      "font-family": null,
      "background-color": null,
      color: null,
    });

    const nodes = selection.getNodes();
    const blockElements = getSelectedTopLevelElements();
    for (const element of blockElements) {
      const nextStyle = writeStyleProperty(element.getStyle(), "line-height", null);
      element.setStyle(nextStyle);
    }
    for (const node of nodes) {
      if (!$isTextNode(node)) continue;
      node.setFormat(0);
      node.setStyle("");
    }
  });
}

export function LexicalEditorToolbarPlugin(props: ToolbarPluginProps) {
  const { readOnly = false } = props;
  const [editor] = useLexicalComposerContext();
  const [toolbar, setToolbar] = useState<ToolbarState>(() => readToolbarState(editor));

  const updateToolbar = useCallback(() => {
    const next = readToolbarState(editor);
    setToolbar((prev) => (isSameToolbarState(prev, next) ? prev : next));
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        updateToolbar();
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setToolbar((prev) => (prev.canUndo === payload ? prev : { ...prev, canUndo: payload }));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setToolbar((prev) => (prev.canRedo === payload ? prev : { ...prev, canRedo: payload }));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, updateToolbar]);

  const dispatchTextFormat = useCallback(
    (format: TextFormatType) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const handleListToggle = useCallback(
    (target: ListType) => {
      if (toolbar.listType === target) {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        return;
      }
      if (target === "bullet") {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      } else if (target === "number") {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      } else if (target === "check") {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
      }
    },
    [editor, toolbar.listType],
  );

  const handleLink = useCallback(() => {
    const raw = window.prompt("Enter URL (leave empty to remove link)", "https://");
    if (raw === null) return;
    const normalized = normalizeUrl(raw);
    editor.dispatchCommand(
      TOGGLE_LINK_COMMAND,
      normalized ? { url: normalized, target: "_blank", rel: "noreferrer" } : null,
    );
  }, [editor]);

  const alignedOptions = useMemo(
    () =>
      [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
        { label: "Justify", value: "justify" },
      ] as const,
    [],
  );

  if (readOnly) return null;

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton
          label="Undo"
          onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
          disabled={!toolbar.canUndo}
        />
        <ToolbarButton
          label="Redo"
          onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
          disabled={!toolbar.canRedo}
        />

        <div className="mx-1 h-6 w-px bg-slate-300" />

        <ToolbarButton
          label="Bold"
          onClick={() => dispatchTextFormat("bold")}
          active={toolbar.isBold}
        />
        <ToolbarButton
          label="Italic"
          onClick={() => dispatchTextFormat("italic")}
          active={toolbar.isItalic}
        />
        <ToolbarButton
          label="Underline"
          onClick={() => dispatchTextFormat("underline")}
          active={toolbar.isUnderline}
        />
        <ToolbarButton
          label="Strike"
          onClick={() => dispatchTextFormat("strikethrough")}
          active={toolbar.isStrikethrough}
        />
        <ToolbarButton
          label="Inline Code"
          onClick={() => dispatchTextFormat("code")}
          active={toolbar.isInlineCode}
        />

        <div className="mx-1 h-6 w-px bg-slate-300" />

        <label className="flex items-center gap-1 text-xs text-slate-600">
          Size
          <select
            value={toolbar.fontSize}
            onChange={(event) =>
              applyTextStyle(editor, { "font-size": normalizeFontSize(event.target.value) })
            }
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
          >
            {FONT_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs text-slate-600">
          Font
          <select
            value={toolbar.fontFamily}
            onChange={(event) =>
              applyTextStyle(editor, {
                "font-family": normalizeFontFamily(event.target.value),
              })
            }
            className="max-w-[170px] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs text-slate-600">
          Spacing
          <select
            value={toolbar.lineSpacing}
            onChange={(event) => applyLineSpacing(editor, event.target.value)}
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
          >
            {LINE_SPACING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs text-slate-600">
          Color
          <select
            value={toolbar.textColor}
            onChange={(event) =>
              applyTextStyle(editor, {
                color: normalizeTextColor(event.target.value),
              })
            }
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
          >
            {TEXT_COLOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs text-slate-600">
          Highlight
          <select
            value={toolbar.highlight}
            onChange={(event) =>
              applyTextStyle(editor, {
                "background-color":
                  event.target.value === "transparent" ? null : event.target.value,
              })
            }
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
          >
            {HIGHLIGHT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mx-1 h-6 w-px bg-slate-300" />

        <label className="flex items-center gap-1 text-xs text-slate-600">
          Block
          <select
            value={toolbar.blockType}
            onChange={(event) => applyBlockType(editor, event.target.value as ToolbarBlockType)}
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
          >
            <option value="paragraph">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="h4">Heading 4</option>
            <option value="h5">Heading 5</option>
            <option value="h6">Heading 6</option>
            <option value="quote">Block Quote</option>
            <option value="code">Code Block</option>
          </select>
        </label>

        <ToolbarButton
          label="Bullet"
          onClick={() => handleListToggle("bullet")}
          active={toolbar.listType === "bullet"}
        />
        <ToolbarButton
          label="Numbered"
          onClick={() => handleListToggle("number")}
          active={toolbar.listType === "number"}
        />
        <ToolbarButton
          label="Checklist"
          onClick={() => handleListToggle("check")}
          active={toolbar.listType === "check"}
        />

        <div className="mx-1 h-6 w-px bg-slate-300" />

        {alignedOptions.map((option) => (
          <ToolbarButton
            key={option.value}
            label={option.label}
            onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, option.value)}
            active={toolbar.alignment === option.value}
          />
        ))}

        <div className="mx-1 h-6 w-px bg-slate-300" />

        <ToolbarButton label="Link" onClick={handleLink} active={toolbar.isLink} />
        <ToolbarButton label="Clear" onClick={() => clearFormatting(editor)} />
      </div>
    </div>
  );
}
