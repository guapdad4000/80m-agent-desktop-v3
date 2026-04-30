import React, { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const InputBar: React.FC<Props> = ({ onSend, disabled }) => {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }, [text]);

  const playClickSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
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
    playClickSound();
    onSend(trimmed);
    setText('');
    textareaRef.current?.focus();
  }, [text, disabled, onSend, playClickSound]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
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
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 30000);
    } catch (_) {
      // Mic not available
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
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
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        handleMicClick();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleMicClick]);

  return (
    <div className="input-80m">
      <div className={`input-80m-form ${disabled ? 'thinking' : ''}`}>
      <textarea
        ref={textareaRef}
        className="input-80m-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Agent is thinking..." : "Send a message..."}
        disabled={disabled}
        rows={1}
      />
      <button
        className={`input-80m-mic${isRecording ? ' recording' : ''}`}
        onClick={handleMicClick}
        title="Hold to record (Ctrl+Shift+Space)"
        type="button"
      >
        {/* Animated mic SVG with sound wave bars */}
        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`mic-svg ${isRecording ? 'animate-sound-wave' : ''}`}
        >
          {/* Mic body */}
          <rect x="13" y="4" width="10" height="14" rx="5" fill="currentColor" opacity="0.9" />
          {/* Mic stand arc */}
          <path d="M9 14a9 9 0 0 0 18 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          {/* Stand stem */}
          <path d="M18 23v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          {/* Base */}
          <path d="M13 31h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="input-80m-send"
        onClick={handleSubmit}
        disabled={disabled || !text.trim()}
        title="Send (Enter)"
        type="button"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
      </div>
    </div>
  );
};

export default InputBar;
