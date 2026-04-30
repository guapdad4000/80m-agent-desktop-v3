import React, { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const InputBar: React.FC<Props> = ({ onSend, disabled }) => {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Slash commands
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);

  const COMMANDS = [
    { cmd: "/new", desc: "Start a new chat session" },
    { cmd: "/clear", desc: "Clear current chat" },
    { cmd: "/model", desc: "Switch model (e.g. /model anthropic)" },
    { cmd: "/settings", desc: "Open settings panel" }
  ];

  const filteredCommands = COMMANDS.filter(c => c.cmd.startsWith(text.split(" ")[0].toLowerCase()));

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
    } catch (_) {
      // Audio not available
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    if (showCommands && filteredCommands.length > 0 && !text.includes(" ")) {
      // Autocomplete command
      setText(filteredCommands[commandIndex].cmd + " ");
      setShowCommands(false);
      textareaRef.current?.focus();
      return;
    }

    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(" ");
      const cmd = parts[0].toLowerCase();
      
      // Dispatch custom events for layout/chat area to handle
      if (cmd === "/new" || cmd === "/clear") {
        window.dispatchEvent(new CustomEvent("layout-cmd", { detail: "new" }));
        setText("");
        return;
      }
      if (cmd === "/settings") {
        window.dispatchEvent(new CustomEvent("layout-cmd", { detail: "settings" }));
        setText("");
        return;
      }
      if (cmd === "/model" && parts[1]) {
        // Quick model switch
        window.hermesAPI?.setModelConfig("openrouter", parts[1], "");
        setText("");
        // Notify user in chat?
        onSend(`[System: Switched model to ${parts[1]}]`);
        return;
      }
    }

    playClickSound();
    onSend(trimmed);
    setText("");
    setShowCommands(false);
    textareaRef.current?.focus();
  }, [text, disabled, onSend, playClickSound, showCommands, filteredCommands, commandIndex]);

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
          setCommandIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          setText(filteredCommands[commandIndex].cmd + " ");
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

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (val.startsWith("/") && !val.includes(" ")) {
      setShowCommands(true);
      setCommandIndex(0);
    } else {
      setShowCommands(false);
    }
  };

  useEffect(() => {
    const handleInject = (e: Event) => {
      const customEv = e as CustomEvent<string>;
      setText((prev) => prev ? prev + "\n" + customEv.detail : customEv.detail);
      textareaRef.current?.focus();
    };
    window.addEventListener("inject-chat", handleInject);
    return () => window.removeEventListener("inject-chat", handleInject);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
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
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

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
            placeholder={disabled ? "Processing..." : "Type a message or /command..."}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
          />
        </div>
        <button
          className={`input-80m-mic${isRecording ? " recording" : ""}`}
          onClick={handleMicClick}
          title="Hold to record (Ctrl+Shift+Space)"
          type="button"
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
            <path
              d="M13 31h10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="input-80m-send"
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          title="Send (Enter)"
          type="button"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default InputBar;
