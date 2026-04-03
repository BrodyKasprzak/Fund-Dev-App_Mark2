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
  paragraph: "lexical-doc-paragraph whitespace-pre-wrap",
  code: "my-3 block rounded-md bg-slate-900 px-3 py-2 font-mono text-[13px] leading-6 text-slate-100",
  quote: "lexical-doc-quote border-l-2 border-slate-300 pl-4 text-slate-700",
  heading: {
    h1: "lexical-doc-h1",
    h2: "lexical-doc-h2",
    h3: "lexical-doc-h3",
    h4: "lexical-doc-h4",
    h5: "lexical-doc-h5",
    h6: "lexical-doc-h6",
  },
  list: {
    listitem: "lexical-doc-listitem",
    listitemChecked: "lexical-doc-listitem lexical-doc-listitem-check list-none",
    listitemUnchecked: "lexical-doc-listitem lexical-doc-listitem-check list-none",
    nested: {
      listitem: "lexical-doc-listitem-nested",
    },
    olDepth: [
      "lexical-doc-ol-depth-1 list-decimal",
      "lexical-doc-ol-depth-2 list-[lower-alpha]",
      "lexical-doc-ol-depth-3 list-[lower-roman]",
    ],
    ul: "lexical-doc-ul list-disc",
  },
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.95em]",
  },
  link: "lexical-doc-link text-sky-700 underline decoration-sky-500/70 underline-offset-2",
  table: "lexical-doc-table",
  tableRow: "lexical-doc-table-row",
  tableCell: "lexical-doc-table-cell align-top",
  tableCellHeader:
    "lexical-doc-table-cell lexical-doc-table-header align-top font-semibold text-slate-800",
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
          <ContentEditable className="lexical-doc-viewer min-h-[48vh] w-full overflow-auto p-0 text-[15px] leading-7 text-slate-700 outline-none" />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ListPlugin hasStrictIndent />
      <CheckListPlugin />
      <LinkPlugin />
      <TablePlugin hasCellMerge hasCellBackgroundColor />
      <style jsx global>{`
        .lexical-doc-viewer {
          --lexical-indent-base-value: 34px;
          color: #334155;
          line-height: 1.58;
          word-break: break-word;
        }

        .lexical-doc-viewer .lexical-doc-paragraph {
          margin: 0 0 0.62em 0;
        }

        .lexical-doc-viewer .lexical-doc-h1 {
          margin: 0.92em 0 0.42em;
          color: #0f172a;
          font-size: 2rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.24;
        }

        .lexical-doc-viewer .lexical-doc-h2 {
          margin: 0.84em 0 0.4em;
          color: #0f172a;
          font-size: 1.48rem;
          font-weight: 700;
          letter-spacing: -0.006em;
          line-height: 1.28;
        }

        .lexical-doc-viewer .lexical-doc-h3 {
          margin: 0.78em 0 0.36em;
          color: #0f172a;
          font-size: 1.2rem;
          font-weight: 650;
          line-height: 1.32;
        }

        .lexical-doc-viewer .lexical-doc-h4 {
          margin: 0.72em 0 0.32em;
          color: #0f172a;
          font-size: 1.06rem;
          font-weight: 650;
          line-height: 1.34;
        }

        .lexical-doc-viewer .lexical-doc-h5 {
          margin: 0.62em 0 0.3em;
          color: #0f172a;
          font-size: 0.94rem;
          font-weight: 650;
          line-height: 1.34;
        }

        .lexical-doc-viewer .lexical-doc-h6 {
          margin: 0.58em 0 0.26em;
          color: #334155;
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          line-height: 1.36;
          text-transform: uppercase;
        }

        .lexical-doc-viewer .lexical-doc-quote {
          margin: 0.78em 0;
          color: #475569;
          font-style: italic;
        }

        .lexical-doc-viewer ul.lexical-doc-ul,
        .lexical-doc-viewer ol[class*="lexical-doc-ol-depth"] {
          margin: 0.2em 0 0.66em;
          padding-inline-start: 1.55em;
        }

        .lexical-doc-viewer li.lexical-doc-listitem {
          margin: 0.08em 0;
          padding-inline-start: 0.12em;
        }

        .lexical-doc-viewer li.lexical-doc-listitem > ul.lexical-doc-ul,
        .lexical-doc-viewer li.lexical-doc-listitem > ol[class*="lexical-doc-ol-depth"] {
          margin-top: 0.24em;
          margin-bottom: 0.24em;
        }

        .lexical-doc-viewer .lexical-doc-table {
          margin: 0.95em 0 1em;
          width: 100%;
          border-collapse: collapse;
          table-layout: auto;
        }

        .lexical-doc-viewer .lexical-doc-table-cell {
          border: 1px solid #cbd5e1;
          padding: 0.34rem 0.46rem;
          line-height: 1.42;
          vertical-align: top;
        }

        .lexical-doc-viewer .lexical-doc-table-header {
          background: #f8fafc;
          font-weight: 700;
        }

        .lexical-doc-viewer .lexical-doc-link {
          text-decoration-thickness: from-font;
        }
      `}</style>
    </LexicalComposer>
  );
}
