import React, { useCallback, useEffect, useRef, useState } from "react";
import { Clipboard, ClipboardPaste } from "lucide-react";

interface SelectionState {
  text: string;
  x: number;
  y: number;
  canPaste: boolean;
}

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function showToast(
  title: string,
  body: string,
  tone: "info" | "success" | "warning" | "error" = "info",
): void {
  window.dispatchEvent(
    new CustomEvent("desktop-toast", {
      detail: { title, body, tone },
    }),
  );
}

function isEditableTarget(
  target: EventTarget | null,
): target is EditableTarget {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit"].includes(
      target.type,
    );
  }
  return target.isContentEditable;
}

function insertText(target: EditableTarget, text: string): void {
  target.focus();
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement
  ) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(text, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  document.execCommand("insertText", false, text);
}

const SelectionToolbar: React.FC = () => {
  const [selectionState, setSelectionState] = useState<SelectionState | null>(
    null,
  );
  const lastTargetRef = useRef<EditableTarget | null>(null);
  const selectedTextRef = useRef("");

  const updateSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    const activeTarget = isEditableTarget(document.activeElement)
      ? document.activeElement
      : null;

    if (!selection || selection.rangeCount === 0 || !text) {
      selectedTextRef.current = "";
      setSelectionState(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setSelectionState(null);
      return;
    }

    selectedTextRef.current = text;
    lastTargetRef.current = activeTarget;
    setSelectionState({
      text,
      x: rect.left + rect.width / 2,
      y: Math.max(46, rect.top - 8),
      canPaste: Boolean(activeTarget),
    });
  }, []);

  useEffect(() => {
    const scheduleUpdate = () => window.setTimeout(updateSelection, 0);
    document.addEventListener("selectionchange", scheduleUpdate);
    window.addEventListener("mouseup", scheduleUpdate);
    window.addEventListener("keyup", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      document.removeEventListener("selectionchange", scheduleUpdate);
      window.removeEventListener("mouseup", scheduleUpdate);
      window.removeEventListener("keyup", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [updateSelection]);

  const copySelection = useCallback(async () => {
    const text = selectedTextRef.current || selectionState?.text || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied", "Selected text is on the clipboard.", "success");
      setSelectionState(null);
    } catch {
      showToast("Copy failed", "Clipboard permission was denied.", "error");
    }
  }, [selectionState]);

  const pasteIntoTarget = useCallback(async () => {
    const target = lastTargetRef.current;
    if (!target) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        showToast("Clipboard empty", "Nothing to paste right now.", "warning");
        return;
      }
      insertText(target, text);
      showToast("Pasted", "Clipboard text inserted.", "success");
      setSelectionState(null);
    } catch {
      showToast("Paste failed", "Clipboard permission was denied.", "error");
    }
  }, []);

  if (!selectionState) return null;

  return (
    <div
      className="selection-toolbar"
      style={{
        left: selectionState.x,
        top: selectionState.y,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={copySelection} title="Copy selection">
        <Clipboard size={13} />
        <span>Copy</span>
      </button>
      {selectionState.canPaste && (
        <button type="button" onClick={pasteIntoTarget} title="Paste here">
          <ClipboardPaste size={13} />
          <span>Paste</span>
        </button>
      )}
    </div>
  );
};

export default SelectionToolbar;
