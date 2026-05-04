import React, { useState, useEffect, useCallback, useRef } from "react";
import Messages from "./Messages";
import InputBar from "./InputBar";
import type { Message } from "./Messages";

interface ChatAreaProps {
  currentSession: string | null;
  onNewSession: () => void;
  onSessionChange?: (sessionId: string | null) => void;
  profile?: string;
  activeProject?: string | null;
}

interface ActiveRequest {
  id: string;
  sessionId: string | null;
  localKey: string;
  response: string;
}

function localFileUrl(filePath: string): string {
  return `file://${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

function plainSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*#_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ChatArea: React.FC<ChatAreaProps> = ({
  currentSession,
  onNewSession,
  onSessionChange,
  profile,
  activeProject,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingRequestId, setLoadingRequestId] = useState<string | null>(null);

  const messagesRef = useRef<Message[]>([]);
  const currentSessionRef = useRef<string | null>(currentSession);
  const activeRequestsRef = useRef<Record<string, ActiveRequest>>({});
  const visibleRequestIdRef = useRef<string | null>(null);
  const pendingMessagesRef = useRef<Record<string, Message[]>>({});

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const playDoneSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (_) {
      // Audio not available.
    }
  }, []);

  const playBrowserTTS = useCallback((text: string) => {
    try {
      if (!window.speechSynthesis) return false;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 0.95;
      utterance.onstart = () =>
        window.dispatchEvent(new CustomEvent("agent-speaking-start"));
      utterance.onend = () =>
        window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
      utterance.onerror = () =>
        window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      console.warn("Browser TTS failed:", err);
      return false;
    }
  }, []);

  const playTTS = useCallback(
    async (text: string) => {
      const clean = plainSpeechText(text);
      if (!clean) return;

      window.dispatchEvent(new CustomEvent("agent-speaking-start"));
      try {
        const audioPath = await window.hermesAPI?.ttsSpeak(clean);
        if (audioPath) {
          const audio = new Audio(localFileUrl(audioPath));
          audio.volume = 0.9;
          audio.onended = () =>
            window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
          audio.onerror = () => {
            window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
            playBrowserTTS(clean);
          };
          await audio.play();
          return;
        }
      } catch (err) {
        console.warn("Hermes TTS failed:", err);
      }

      window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
      playBrowserTTS(clean);
    },
    [playBrowserTTS],
  );

  const playTypingSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "square";
      osc.frequency.setValueAtTime(150 + Math.random() * 50, ctx.currentTime);

      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch (_) {
      // Audio not available.
    }
  }, []);

  const findRequestForSession = useCallback((targetSession: string | null) => {
    return Object.values(activeRequestsRef.current).find((req) =>
      targetSession ? req.sessionId === targetSession : req.sessionId === null,
    );
  }, []);

  const resolveRequest = useCallback((requestId?: string) => {
    if (requestId && activeRequestsRef.current[requestId]) {
      return activeRequestsRef.current[requestId];
    }
    return Object.values(activeRequestsRef.current)[0] || null;
  }, []);

  const syncVisibleLoading = useCallback(
    (targetSession: string | null = currentSessionRef.current) => {
      const visibleReq = findRequestForSession(targetSession);
      visibleRequestIdRef.current = visibleReq?.id || null;
      setLoadingRequestId(visibleReq?.id || null);
    },
    [findRequestForSession],
  );

  const loadSession = useCallback(async (id: string) => {
    if (!window.hermesAPI) return;
    try {
      const msgs = await window.hermesAPI.getSessionMessages(id);
      const loaded = (msgs || []).map((m, i) => ({
        id: `${id}-${m.id || i}`,
        role: m.role as "user" | "assistant" | "system" | "tool",
        content: m.content,
        tool_calls: m.tool_calls,
        tool_name: m.tool_name,
      }));

      const pending = Object.values(activeRequestsRef.current)
        .filter((req) => req.sessionId === id)
        .flatMap((req) => [
          ...(pendingMessagesRef.current[req.localKey] || []),
          ...(req.response
            ? [
                {
                  id: `assistant-${req.id}`,
                  role: "assistant" as const,
                  content: req.response,
                },
              ]
            : []),
        ]);
      setMessages([...loaded, ...pending]);
    } catch (_) {
      // Session load failures leave the current view unchanged.
    }
  }, []);

  useEffect(() => {
    const req = findRequestForSession(currentSession);
    visibleRequestIdRef.current = req?.id || null;
    setLoadingRequestId(req?.id || null);

    if (currentSession) {
      loadSession(currentSession);
    } else {
      setMessages(
        req
          ? [
              ...(pendingMessagesRef.current[req.localKey] || []),
              ...(req.response
                ? [
                    {
                      id: `assistant-${req.id}`,
                      role: "assistant" as const,
                      content: req.response,
                    },
                  ]
                : []),
            ]
          : [],
      );
    }
  }, [currentSession, findRequestForSession, loadSession]);

  useEffect(() => {
    const container = document.querySelector(".messages-80m");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, loadingRequestId]);

  useEffect(() => {
    if (!window.hermesAPI) return;

    const cleanupChunk = window.hermesAPI.onChatChunk(
      (chunk: string, requestId?: string) => {
        const req = resolveRequest(requestId);
        if (!req) return;
        req.response += chunk;
        if (visibleRequestIdRef.current !== req.id) return;

        playTypingSound();
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), { ...last, content: req.response }];
          }
          return [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant" as const,
              content: chunk,
            },
          ];
        });
      },
    );

    const cleanupDone = window.hermesAPI.onChatDone(
      (newSessionId: string | undefined, requestId?: string) => {
        const req = resolveRequest(requestId);
        if (!req) return;

        const isVisible = visibleRequestIdRef.current === req.id;
        const resolvedSessionId = newSessionId || req.sessionId || null;
        delete pendingMessagesRef.current[req.localKey];
        delete activeRequestsRef.current[req.id];
        syncVisibleLoading();
        window.dispatchEvent(new CustomEvent("sessions-updated"));
        window.dispatchEvent(
          new CustomEvent("chat-finished", {
            detail: { requestId: req.id, sessionId: resolvedSessionId },
          }),
        );

        if (!isVisible) return;

        onSessionChange?.(resolvedSessionId);
        if (resolvedSessionId) {
          loadSession(resolvedSessionId);
        }

        playDoneSound();
        void playTTS(req.response);
      },
    );

    const cleanupError = window.hermesAPI.onChatError(
      (error: string, requestId?: string) => {
        const req = resolveRequest(requestId);
        if (!req) return;
        const isVisible = visibleRequestIdRef.current === req.id;

        delete pendingMessagesRef.current[req.localKey];
        delete activeRequestsRef.current[req.id];
        syncVisibleLoading();
        window.dispatchEvent(
          new CustomEvent("chat-finished", {
            detail: { requestId: req.id, error },
          }),
        );

        if (!isVisible) return;
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant" as const,
            content: `**Error:** ${error}`,
          },
        ]);
      },
    );

    return () => {
      cleanupChunk();
      cleanupDone();
      cleanupError();
    };
  }, [
    loadSession,
    onSessionChange,
    playDoneSound,
    playTTS,
    playTypingSound,
    resolveRequest,
    syncVisibleLoading,
  ]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!window.hermesAPI) return;

      const requestId = `chat-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const activeSessionId = currentSessionRef.current;
      const localKey = activeSessionId || `request:${requestId}`;
      const alreadyRunning = Object.values(activeRequestsRef.current).some(
        (req) => req.localKey === localKey,
      );
      if (alreadyRunning) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };

      pendingMessagesRef.current[localKey] = [
        ...(pendingMessagesRef.current[localKey] || []),
        userMsg,
      ];
      activeRequestsRef.current[requestId] = {
        id: requestId,
        sessionId: activeSessionId,
        localKey,
        response: "",
      };
      visibleRequestIdRef.current = requestId;
      setLoadingRequestId(requestId);
      setMessages((prev) => [...prev, userMsg]);

      if (!activeSessionId) {
        onNewSession();
      }

      window.dispatchEvent(
        new CustomEvent("chat-started", {
          detail: { requestId, sessionId: activeSessionId },
        }),
      );

      try {
        const history = messagesRef.current
          .filter((msg) => msg.role === "user" || msg.role === "assistant")
          .slice(-20)
          .map((msg) => ({ role: msg.role, content: msg.content }));
        await window.hermesAPI.sendMessage(
          text,
          profile || "default",
          activeSessionId || undefined,
          history,
          activeProject,
          requestId,
        );
      } catch (err) {
        const req = activeRequestsRef.current[requestId];
        if (!req) return;
        delete pendingMessagesRef.current[localKey];
        delete activeRequestsRef.current[requestId];
        syncVisibleLoading();
        window.dispatchEvent(
          new CustomEvent("chat-finished", {
            detail: { requestId, error: String(err) },
          }),
        );
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant" as const,
            content: `**Error:** ${err}`,
          },
        ]);
      }
    },
    [activeProject, onNewSession, profile, syncVisibleLoading],
  );

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!window.hermesAPI || !e.dataTransfer.files.length) return;

    const file = e.dataTransfer.files[0];
    const filePath = (file as { path?: string }).path;
    if (!filePath) return;

    try {
      const destPath = await window.hermesAPI.copyFileToWorkspace(filePath);
      if (destPath) {
        const promptInjection = `[User uploaded a file at ${destPath}. Use your tools to read it if asked.]\n`;
        handleSend(promptInjection + "I've uploaded a file.");
      }
    } catch (err) {
      console.error("Failed to copy dropped file:", err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div className="main-80m" onDrop={handleDrop} onDragOver={handleDragOver}>
      <Messages messages={messages} isLoading={Boolean(loadingRequestId)} />
      <InputBar onSend={handleSend} disabled={Boolean(loadingRequestId)} />
    </div>
  );
};

export default ChatArea;
