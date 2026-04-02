"use client";

import { useMemo } from "react";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { TRANSFORMERS } from "@lexical/markdown";
import { $getRoot } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { LexicalEditorToolbarPlugin } from "@/components/editor/plugins/LexicalEditorToolbarPlugin";
import { LexicalPasteCleanupPlugin } from "@/components/editor/plugins/LexicalPasteCleanupPlugin";

type LexicalRichTextEditorProps = {
  namespace: string;
  initialEditorState?: Record<string, unknown> | null;
  placeholder?: string;
  readOnly?: boolean;
  onChange?: (payload: {
    editorState: unknown;
    plainText: string;
  }) => void;
};

const lexicalTheme: InitialConfigType["theme"] = {
  paragraph: "mb-2",
  code: "my-3 block rounded-md bg-slate-900 px-3 py-2 font-mono text-[13px] leading-6 text-slate-100",
  quote: "border-l-2 border-slate-300 pl-3 italic text-slate-700",
  heading: {
    h1: "text-2xl font-semibold leading-tight mt-4 mb-2",
    h2: "text-xl font-semibold leading-tight mt-4 mb-2",
    h3: "text-lg font-semibold leading-tight mt-3 mb-2",
    h4: "text-base font-semibold leading-tight mt-3 mb-2",
    h5: "text-sm font-semibold leading-tight mt-2 mb-1",
    h6: "text-xs font-semibold leading-tight mt-2 mb-1 uppercase tracking-wide",
  },
  list: {
    listitem: "ml-5",
    listitemChecked: "ml-5 list-none",
    listitemUnchecked: "ml-5 list-none",
    nested: {
      listitem: "ml-4",
    },
    olDepth: ["list-decimal", "list-[lower-alpha]", "list-[lower-roman]"],
    ul: "list-disc",
  },
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.95em]",
  },
  link: "text-sky-700 underline",
  table: "my-3 w-full border-collapse border border-slate-300",
  tableRow: "border border-slate-300",
  tableCell: "border border-slate-300 px-2 py-1 align-top",
  tableCellHeader:
    "border border-slate-300 bg-slate-100 px-2 py-1 align-top font-semibold text-slate-800",
};

function parseInitialEditorState(value: Record<string, unknown> | null | undefined) {
  if (!value) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function LexicalRichTextEditor(props: LexicalRichTextEditorProps) {
  const { namespace, initialEditorState, placeholder, readOnly = false, onChange } = props;

  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace,
      theme: lexicalTheme,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        CodeNode,
        TableNode,
        TableRowNode,
        TableCellNode,
      ],
      onError: (error: Error) => {
        throw error;
      },
      editable: !readOnly,
      editorState: parseInitialEditorState(initialEditorState),
    }),
    [namespace, readOnly, initialEditorState],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="rounded-lg border border-slate-300 bg-white">
        <LexicalEditorToolbarPlugin readOnly={readOnly} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="min-h-[320px] w-full resize-y overflow-auto px-4 py-3 text-sm leading-7 text-slate-800 outline-none" />
          }
          placeholder={
            <div className="pointer-events-none absolute px-4 py-3 text-sm text-slate-400">
              {placeholder || "Start writing..."}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin hasStrictIndent />
        <CheckListPlugin />
        <LinkPlugin />
        <TablePlugin hasCellMerge hasCellBackgroundColor />
        <LexicalPasteCleanupPlugin disabled={readOnly} />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin
          onChange={(editorState) => {
            if (!onChange) return;
            editorState.read(() => {
              onChange({
                editorState: editorState.toJSON(),
                plainText: $getRoot().getTextContent(),
              });
            });
          }}
        />
      </div>
    </LexicalComposer>
  );
}
