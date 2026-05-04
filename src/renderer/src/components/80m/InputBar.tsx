import React, { useState, useRef, useCallback, useEffect } from "react";
import { Send } from "lucide-react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const InputBar: React.FC<Props> = ({ onSend, disabled }) => {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartRef = useRef<number>(0);

  // Slash commands
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);

  const COMMANDS = [
    { cmd: "/new", desc: "Start a new chat session" },
    { cmd: "/clear", desc: "Clear current chat" },
    { cmd: "/model", desc: "Switch model (e.g. /model anthropic)" },
    { cmd: "/settings", desc: "Open settings panel" },
  ];

  const filteredCommands = COMMANDS.filter((c) =>
    c.cmd.startsWith(text.split(" ")[0].toLowerCase()),
  );

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
  }, [text]);

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
      if (cmd === "/model" && parts[1]) {
        window.hermesAPI?.setModelConfig("openrouter", parts[1], "");
        setText("");
        onSend(`[System: Switched model to ${parts[1]}]`);
        return;
      }
    }

    playClickSound();
    onSend(trimmed);
    setText("");
    setShowCommands(false);
    textareaRef.current?.focus();
  }, [text, disabled, onSend, playClickSound, showCommands, filteredCommands]);

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
            playClickSound();
            onSend(transcript.trim());
            setText("");
          }
        } catch (err) {
          console.error("Transcription failed:", err);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);

      // Auto-stop after 30s
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 30000);
    } catch (_) {
      // Mic not available
    }
  }, [onSend, playClickSound]);

  const handleMicClick = useCallback(() => {
    if (isRecording || isTranscribing) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, isTranscribing, startRecording, stopRecording]);

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

  return (
    <div className="input-80m">
      <div className={`input-80m-form ${disabled ? "thinking" : ""}`}>
        <div className="input-80m-wrapper">
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
              disabled
                ? "Processing..."
                : isTranscribing
                  ? "Transcribing..."
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
          className={`input-80m-mic${isRecording ? " recording" : ""}${isTranscribing ? " transcribing" : ""}`}
          onClick={handleMicClick}
          title="Hold to record (Ctrl+Shift+Space)"
          type="button"
          disabled={isTranscribing}
        >
          {/* Animated mic SVG with sound wave bars */}
          <svg
            viewBox="0 0 36 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`mic-svg ${isRecording ? "animate-sound-wave" : ""}`}
          >
            {/* Mic body */}
            <rect
              x="13"
              y="4"
              width="10"
              height="14"
              rx="5"
              fill="currentColor"
              opacity="0.9"
            />
            {/* Mic stand arc */}
            <path
              d="M9 14a9 9 0 0 0 18 0"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
            {/* Stand stem */}
            <path
              d="M18 23v5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Base */}
            <line
              x1="12"
              y1="28"
              x2="24"
              y2="28"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Spinning indicator when transcribing */}
            {isTranscribing && (
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="#22c55e"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                className="transcribe-spin"
              />
            )}
          </svg>
        </button>
        <button
          className="input-80m-send"
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          title="Send"
          type="button"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default InputBar;
