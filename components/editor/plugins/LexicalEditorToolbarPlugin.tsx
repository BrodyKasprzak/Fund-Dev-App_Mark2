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

type ToolbarBlockType = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";
type ToolbarAlignment = "left" | "center" | "right";
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
  highlight: string;
};

type ToolbarPluginProps = {
  readOnly?: boolean;
};

const DEFAULT_FONT_SIZE = "14px";
const DEFAULT_HIGHLIGHT = "transparent";
const FONT_SIZE_OPTIONS = ["12px", "14px", "16px", "18px", "20px", "24px", "28px"];
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
  highlight: DEFAULT_HIGHLIGHT,
};

function normalizeAlignment(value: ElementFormatType | ""): ToolbarAlignment {
  if (value === "center" || value === "right") return value;
  return "left";
}

function normalizeFontSize(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_FONT_SIZE;
  if (/^\d+px$/.test(normalized)) return normalized;
  return DEFAULT_FONT_SIZE;
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
      if (tag === "h1" || tag === "h2" || tag === "h3") blockType = tag;
      else blockType = "paragraph";
    } else if ($isQuoteNode(topLevel)) {
      blockType = "quote";
    } else if ($isCodeNode(topLevel)) {
      blockType = "code";
    }

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
    if (blockType === "h1" || blockType === "h2" || blockType === "h3") {
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
      "background-color": null,
      color: null,
    });

    const nodes = selection.getNodes();
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
