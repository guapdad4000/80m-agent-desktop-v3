import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  CircleStop,
  ClipboardPaste,
  GitBranch,
  ListPlus,
  Mic,
  Radio,
  Send,
  Square,
} from "lucide-react";
import { formatBytes } from "./messageToolUtils";
import type { DroppedAttachment } from "./chatAreaTypes";

export type BusySendMode = "queue" | "steer" | "background";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  isBusy?: boolean;
  busyMode?: BusySendMode;
  queuedCount?: number;
  onBusyModeChange?: (mode: BusySendMode) => void;
  onStop?: () => void;
  draftInsert?: { id: string; text: string } | null;
  attachments?: DroppedAttachment[];
  onRemoveAttachment?: (path: string) => void;
  onDraftInsertConsumed?: () => void;
}

const InputBar: React.FC<Props> = ({
  onSend,
  disabled,
  isBusy = false,
  busyMode = "queue",
  queuedCount = 0,
  onBusyModeChange,
  onStop,
  draftInsert,
  attachments = [],
  onRemoveAttachment,
  onDraftInsertConsumed,
}) => {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartRef = useRef<number>(0);
  const lastDraftInsertRef = useRef<string | null>(null);

  // Slash commands
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);

  const COMMANDS = [
    { cmd: "/new", desc: "Start a new chat session" },
    { cmd: "/clear", desc: "Clear current chat" },
    { cmd: "/queue", desc: "Queue next turn" },
    { cmd: "/steer", desc: "Steer current work" },
    { cmd: "/background", desc: "Start background run" },
    { cmd: "/model", desc: "Open model settings" },
    { cmd: "/settings", desc: "Open settings panel" },
  ];

  const filteredCommands = COMMANDS.filter((c) =>
    c.cmd.startsWith(text.split(" ")[0].toLowerCase()),
  );

  const showToast = useCallback(
    (
      title: string,
      body: string,
      tone: "info" | "success" | "warning" | "error" = "info",
    ) => {
      window.dispatchEvent(
        new CustomEvent("desktop-toast", {
          detail: { title, body, tone },
        }),
      );
    },
    [],
  );

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
  }, [text]);

  useEffect(() => {
    if (!draftInsert || lastDraftInsertRef.current === draftInsert.id) return;
    lastDraftInsertRef.current = draftInsert.id;
    setText((current) => {
      const prefix = current.trimEnd();
      return prefix ? `${prefix}\n\n${draftInsert.text}` : draftInsert.text;
    });
    setShowCommands(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
    onDraftInsertConsumed?.();
  }, [draftInsert, onDraftInsertConsumed]);

  const playClickSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } catch (_) {}
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    if (showCommands && filteredCommands.length > 0 && !text.includes(" ")) {
      setShowCommands(false);
      textareaRef.current?.focus();
      return;
    }

    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(" ");
      const cmd = parts[0].toLowerCase();

      if (cmd === "/new" || cmd === "/clear") {
        window.dispatchEvent(new CustomEvent("layout-cmd", { detail: "new" }));
        setText("");
        return;
      }
      if (cmd === "/settings") {
        window.dispatchEvent(
          new CustomEvent("layout-cmd", { detail: "settings" }),
        );
        setText("");
        return;
      }
      if (cmd === "/model") {
        // Route to Settings instead of writing a hardcoded-provider config.
        // The old behavior forced provider "openrouter" and broke routing.
        window.dispatchEvent(
          new CustomEvent("layout-cmd", { detail: "settings" }),
        );
        setText("");
        return;
      }
    }

    playClickSound();
    onSend(trimmed);
    setText("");
    setShowCommands(false);
    textareaRef.current?.focus();
  }, [text, disabled, onSend, playClickSound, showCommands, filteredCommands]);

  const handlePaste = useCallback(async () => {
    if (disabled || isTranscribing) return;
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) {
        showToast("Clipboard empty", "Nothing to paste right now.", "warning");
        return;
      }

      const textarea = textareaRef.current;
      if (!textarea) {
        setText((current) => `${current}${clip}`);
        return;
      }

      const start = textarea.selectionStart ?? text.length;
      const end = textarea.selectionEnd ?? start;
      const next = `${text.slice(0, start)}${clip}${text.slice(end)}`;
      setText(next);
      window.requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + clip.length;
        textarea.setSelectionRange(cursor, cursor);
      });
      showToast("Pasted", "Clipboard text inserted.", "success");
    } catch {
      showToast("Paste failed", "Clipboard permission was denied.", "error");
    }
  }, [disabled, isTranscribing, showToast, text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showCommands && filteredCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCommandIndex((i) => (i + 1) % filteredCommands.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCommandIndex(
            (i) => (i - 1 + filteredCommands.length) % filteredCommands.length,
          );
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (filteredCommands[commandIndex]) {
            setText(filteredCommands[commandIndex].cmd + " ");
            setShowCommands(false);
          }
          return;
        }
        if (e.key === "Escape") {
          setShowCommands(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, showCommands, filteredCommands, commandIndex],
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setText(val);
      if (val.startsWith("/")) {
        setShowCommands(true);
        setCommandIndex(0);
      } else {
        setShowCommands(false);
      }
    },
    [],
  );

  // ─── Voice Recording ─────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const appendTranscriptToDraft = useCallback((transcript: string) => {
    setText((current) => {
      const prefix = current.trimEnd();
      return prefix ? `${prefix} ${transcript}` : transcript;
    });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;
      recordingStartRef.current = Date.now();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);

        // Discard recordings shorter than 500ms
        const duration = Date.now() - recordingStartRef.current;
        if (duration < 500 || audioChunksRef.current.length === 0) {
          return;
        }

        setIsTranscribing(true);

        try {
          const blob = new Blob(audioChunksRef.current, {
            type: mediaRecorder.mimeType || "audio/webm",
          });
          const arrayBuffer = await blob.arrayBuffer();
          const audioData = Array.from(new Uint8Array(arrayBuffer));
          const transcript = await window.hermesAPI?.transcribeAudio(
            audioData,
            blob.type || "audio/webm",
          );
          if (transcript && transcript.trim()) {
            appendTranscriptToDraft(transcript.trim());
            showToast(
              "Transcript ready",
              "Voice text was added to your draft.",
              "success",
            );
          }
        } catch (err) {
          console.error("Transcription failed:", err);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
    } catch (_) {
      // Mic not available
    }
  }, [appendTranscriptToDraft, showToast]);

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
      return;
    }
    if (isTranscribing) return;
    startRecording();
  }, [isRecording, isTranscribing, startRecording, stopRecording]);

  const hasText = Boolean(text.trim());
  const primaryActionLabel = isBusy
    ? busyMode === "background"
      ? "Send background"
      : busyMode === "steer"
        ? "Steer"
        : "Queue"
    : "Send";
  const micActionLabel = isRecording
    ? "Stop voice recording"
    : isTranscribing
      ? "Transcribing voice"
      : "Start voice recording";

  const handlePrimaryAction = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  const handleRemoveAttachment = useCallback(
    (attachment: DroppedAttachment) => {
      onRemoveAttachment?.(attachment.path);
      setText((current) => {
        let next = current
          .split("\n")
          .filter((line) => !line.includes(attachment.path))
          .join("\n")
          .trimStart();
        if (attachments.length <= 1) {
          next = next
            .replace(/^\[Attached files?\]\s*\n?/i, "")
            .replace(
              /\n?Use the file paths above when you need to inspect the dropped content\./i,
              "",
            )
            .trimStart();
        }
        return next;
      });
    },
    [attachments.length, onRemoveAttachment],
  );

  // Keyboard shortcut: Cmd/Ctrl+Shift+Space for mic
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        handleMicClick();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleMicClick]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      if (recorder.state === "recording") {
        recorder.stop();
      } else {
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const formStateClass = [
    "input-80m-form",
    isBusy ? "thinking" : "",
    text.trim() ? "has-text" : "",
    attachments.length ? "has-attachments" : "",
    isRecording ? "recording" : "",
    isTranscribing ? "transcribing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inputShellClass = ["input-80m", isBusy ? "agent-working" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={inputShellClass}
      data-busy-mode={isBusy ? busyMode : undefined}
    >
      {isBusy && (
        <div className="input-80m-busy-row">
          <div className="input-80m-mode-switch" aria-label="Busy send mode">
            <button
              className={busyMode === "queue" ? "active" : ""}
              onClick={() => onBusyModeChange?.("queue")}
              title="Queue follow-up"
              type="button"
            >
              <ListPlus size={13} />
              <span>Queue{queuedCount ? ` ${queuedCount}` : ""}</span>
            </button>
            <button
              className={busyMode === "steer" ? "active" : ""}
              onClick={() => onBusyModeChange?.("steer")}
              title="Steer after current work"
              type="button"
            >
              <GitBranch size={13} />
              <span>Steer</span>
            </button>
            <button
              className={busyMode === "background" ? "active" : ""}
              onClick={() => onBusyModeChange?.("background")}
              title="Send as background run"
              type="button"
            >
              <Radio size={13} />
              <span>BG</span>
            </button>
          </div>
          <button
            className="input-80m-stop"
            onClick={onStop}
            title="Stop current run"
            type="button"
          >
            <CircleStop size={14} />
          </button>
        </div>
      )}
      <div className={formStateClass}>
        <div className="input-80m-wrapper">
          {attachments.length > 0 && (
            <div className="input-attachment-preview-tray">
              {attachments.map((attachment) => (
                <div className="input-attachment-preview" key={attachment.path}>
                  {attachment.kind === "image" && attachment.fileUrl ? (
                    <img src={attachment.fileUrl} alt="" />
                  ) : (
                    <span className="input-attachment-filetype">
                      {attachment.kind === "pdf"
                        ? "PDF"
                        : attachment.kind === "directory"
                          ? "DIR"
                          : "FILE"}
                    </span>
                  )}
                  <span className="input-attachment-copy">
                    <span>{attachment.name}</span>
                    {typeof attachment.size === "number" && (
                      <small>{formatBytes(attachment.size)}</small>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => handleRemoveAttachment(attachment)}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          {(isBusy || isTranscribing) && (
            <span
              className="input-80m-inline-spinner"
              aria-label={isTranscribing ? "Transcribing" : "Agent working"}
              role="status"
            >
              <span className="input-80m-spinner-glyph">⠋</span>
              <span>80m</span>
            </span>
          )}
          {showCommands && filteredCommands.length > 0 && (
            <div className="slash-commands-popup">
              {filteredCommands.map((cmd, idx) => (
                <div
                  key={cmd.cmd}
                  className={`slash-command-item ${idx === commandIndex ? "active" : ""}`}
                  onClick={() => {
                    setText(cmd.cmd + " ");
                    setShowCommands(false);
                    textareaRef.current?.focus();
                  }}
                >
                  <span className="slash-command-name">{cmd.cmd}</span>
                  <span className="slash-command-desc">{cmd.desc}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="input-80m-textarea"
            placeholder={
              isRecording
                ? "Recording... click the mic to stop"
                : isTranscribing
                  ? "Transcribing..."
                  : isBusy
                    ? busyMode === "background"
                      ? "Send a background task..."
                      : busyMode === "steer"
                        ? "Steer this run..."
                        : "Queue a follow-up..."
                    : "Type a message or /command..."
            }
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled || isTranscribing}
            rows={1}
          />
        </div>
        <button
          className="input-80m-paste"
          onClick={handlePaste}
          title="Paste"
          type="button"
          disabled={disabled || isTranscribing}
        >
          <ClipboardPaste size={16} />
        </button>
        <button
          className={`input-80m-mic${isRecording ? " recording" : ""}${isTranscribing ? " transcribing" : ""}`}
          onClick={handleMicClick}
          disabled={(disabled && !isRecording) || isTranscribing}
          title={micActionLabel}
          aria-label={micActionLabel}
          aria-pressed={isRecording}
          type="button"
        >
          {isRecording ? (
            <Square size={13} fill="currentColor" strokeWidth={1.5} />
          ) : (
            <Mic size={16} />
          )}
        </button>
        <button
          className="input-80m-send input-80m-primary-action send-mode"
          onClick={handlePrimaryAction}
          disabled={!hasText || disabled || isRecording || isTranscribing}
          title={primaryActionLabel}
          type="button"
        >
          <span className="input-primary-action-send">
            <Send size={18} />
          </span>
        </button>
      </div>
    </div>
  );
};

export default InputBar;
