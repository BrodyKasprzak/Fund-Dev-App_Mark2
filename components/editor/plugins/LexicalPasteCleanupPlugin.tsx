"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
} from "lexical";

type PasteCleanupPluginProps = {
  disabled?: boolean;
};

function getClipboardData(event: unknown): DataTransfer | null {
  if (!event || typeof event !== "object") return null;
  if (!("clipboardData" in event)) return null;
  const clipboardData = (event as { clipboardData?: DataTransfer | null }).clipboardData;
  return clipboardData ?? null;
}

export function LexicalPasteCleanupPlugin(props: PasteCleanupPluginProps) {
  const { disabled = false } = props;
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (disabled) return;
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = getClipboardData(event);
        if (!clipboardData) return false;
        if (clipboardData.files && clipboardData.files.length > 0) {
          return false;
        }

        const plainText = clipboardData.getData("text/plain");
        if (!plainText) return false;

        event.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          selection.insertText(plainText);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [disabled, editor]);

  return null;
}
