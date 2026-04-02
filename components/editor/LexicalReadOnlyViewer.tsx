"use client";

import { useMemo } from "react";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";

type LexicalReadOnlyViewerProps = {
  namespace: string;
  editorState: Record<string, unknown>;
};

const lexicalTheme: InitialConfigType["theme"] = {
  paragraph: "mb-2 whitespace-pre-wrap",
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

function parseInitialEditorState(value: Record<string, unknown>) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function LexicalReadOnlyViewer(props: LexicalReadOnlyViewerProps) {
  const { namespace, editorState } = props;

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
      editable: false,
      editorState: parseInitialEditorState(editorState),
    }),
    [namespace, editorState],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable className="min-h-[48vh] w-full overflow-auto p-0 text-[15px] leading-7 text-slate-700 outline-none" />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ListPlugin hasStrictIndent />
      <CheckListPlugin />
      <LinkPlugin />
      <TablePlugin hasCellMerge hasCellBackgroundColor />
    </LexicalComposer>
  );
}
