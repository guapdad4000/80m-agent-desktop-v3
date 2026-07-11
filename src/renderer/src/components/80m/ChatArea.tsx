import React, { useState, useEffect, useCallback, useRef } from "react";
import Messages from "./Messages";
import InputBar from "./InputBar";
import { ChatFileDropOverlay } from "./ChatFileDropOverlay";
import type { Message } from "./Messages";
import type {
  ActiveRequest,
  ChatAreaProps,
  QueuedChatTurn,
} from "./chatAreaTypes";
import {
  buildSteerTurnPrompt,
  makeAssistantMessage,
  mergeMessages,
  parseBusyCommand,
  requestDisplaySession,
  upsertMessage,
} from "./chatAreaUtils";
import { useChatBusySendMode } from "./useChatBusySendMode";
import { useChatFileDrop } from "./useChatFileDrop";
import { useChatRuntimeEvents } from "./useChatRuntimeEvents";
import { useDesktopToast } from "./useDesktopToast";

function normalizeBrowserTarget(value: string): string {
  const target = value.trim();
  if (!target) return "";

  if (target.startsWith("http://") || target.startsWith("https://")) {
    return target;
  }

  const shortcut = target.toLowerCase();
  const shortcuts: Record<string, string> = {
    google: "https://www.google.com",
    youtube: "https://www.youtube.com",
    yt: "https://www.youtube.com",
    gmail: "https://mail.google.com",
    chatgpt: "https://chatgpt.com",
    rym: "https://rateyourmusic.com",
    rateyourmusic: "https://rateyourmusic.com",
    "rate your music": "https://rateyourmusic.com",
  };
  if (shortcuts[shortcut]) return shortcuts[shortcut];

  const looksLikeDomain = /^[^\s]+\.[^\s]+$/.test(target);
  if (looksLikeDomain) return `https://${target}`;

  return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
}

function inferBrowserTargetFromPrompt(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const directCommand = trimmed.match(/^\/(?:browser|browse|open|search)\s+(.+)$/i);
  if (directCommand?.[1]) return normalizeBrowserTarget(directCommand[1]);

  const explicitUrl = trimmed.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (explicitUrl) return normalizeBrowserTarget(explicitUrl);

  const lower = trimmed.toLowerCase();
  if (/\b(chatgpt|chat gpt)\b/.test(lower)) return "https://chatgpt.com";
  if (/\b(rateyourmusic|rate your music|rym)\b/.test(lower)) {
    const query = trimmed
      .replace(/\b(?:open|pull up|go to|search|look up|find|on|in|using|rateyourmusic|rate your music|rym)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return query
      ? `https://rateyourmusic.com/search?searchterm=${encodeURIComponent(query)}`
      : "https://rateyourmusic.com";
  }

  const searchIntent = trimmed.match(
    /\b(?:google|search for|look up|look for|find me|pull up)\b\s+(.+)/i,
  );
  if (searchIntent?.[1]) return normalizeBrowserTarget(searchIntent[1]);

  return null;
}

function openBrowserPreview(target: string): void {
  window.dispatchEvent(
    new CustomEvent("open-agent-preview-url", {
      detail: { url: target },
    }),
  );
}

const ChatArea: React.FC<ChatAreaProps> = ({
  conversationId,
  currentSession,
  onNewSession,
  onSessionChange,
  profile,
  assistantLabel,
  activeProject,
  isAudible = true,
  acceptsDesktopBuddyInput = false,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingRequestId, setLoadingRequestId] = useState<string | null>(null);
  const [draftInsert, setDraftInsert] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<
    NonNullable<Message["attachments"]>
  >([]);
  const [queuedTurns, setQueuedTurns] = useState<QueuedChatTurn[]>([]);
  const [busySendMode, setBusySendMode] = useChatBusySendMode();
  const messagesRef = useRef<Message[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentSessionRef = useRef<string | null>(currentSession);
  const activeRequestsRef = useRef<Record<string, ActiveRequest>>({});
  const visibleRequestIdRef = useRef<string | null>(null);
  const pendingMessagesRef = useRef<Record<string, Message[]>>({});
  const queuedTurnsRef = useRef<QueuedChatTurn[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const updateQueuedTurns = useCallback((next: QueuedChatTurn[]) => {
    queuedTurnsRef.current = next;
    setQueuedTurns(next);
  }, []);
  const showToast = useDesktopToast();

  const { isDraggingFiles, dragHandlers } = useChatFileDrop({
    onAttachmentsAdded: (attachments) =>
      setDraftAttachments((current) => [...current, ...attachments]),
    setDraftInsert,
    showToast,
  });

  const findRequestForSession = useCallback((targetSession: string | null) => {
    return Object.values(activeRequestsRef.current).find(
      (req) =>
        req.kind === "foreground" &&
        (targetSession
          ? requestDisplaySession(req) === targetSession
          : requestDisplaySession(req) === null),
    );
  }, []);

  const resolveRequest = useCallback((requestId?: string) => {
    if (requestId && activeRequestsRef.current[requestId]) {
      return activeRequestsRef.current[requestId];
    }
    if (requestId) return null;
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

  const cacheOverlayMessage = useCallback((key: string, msg: Message) => {
    pendingMessagesRef.current[key] = upsertMessage(
      pendingMessagesRef.current[key] || [],
      msg,
    );
  }, []);

  const isRequestVisible = useCallback((req: ActiveRequest) => {
    return (
      visibleRequestIdRef.current === req.id ||
      requestDisplaySession(req) === currentSessionRef.current
    );
  }, []);

  const buildOverlayMessages = useCallback((targetSession: string | null) => {
    const direct =
      targetSession !== null
        ? pendingMessagesRef.current[targetSession] || []
        : [];
    const active = Object.values(activeRequestsRef.current)
      .filter((req) =>
        targetSession
          ? requestDisplaySession(req) === targetSession
          : requestDisplaySession(req) === null,
      )
      .flatMap((req) => {
        const pending =
          req.localKey === targetSession
            ? []
            : pendingMessagesRef.current[req.localKey] || [];
        const assistant = makeAssistantMessage(req);
        return assistant ? [...pending, assistant] : pending;
      });
    return mergeMessages(direct, active);
  }, []);

  const loadSession = useCallback(
    async (id: string) => {
      if (!window.hermesAPI) return;
      try {
        const msgs = await window.hermesAPI.getSessionMessages(
          id,
          profile || "default",
        );
        const loaded = (msgs || []).map((m, i) => ({
          id: `${id}-${m.id || i}`,
          role: m.role as "user" | "assistant" | "system" | "tool",
          content: m.content,
          createdAt:
            typeof m.timestamp === "number" ? m.timestamp * 1000 + i / 1000 : i,
          tool_calls: m.tool_calls,
          tool_name: m.tool_name,
        }));

        setMessages(mergeMessages(loaded, buildOverlayMessages(id)));
      } catch (_) {
        // Session load failures leave the current view unchanged.
      }
    },
    [buildOverlayMessages, profile],
  );

  useEffect(() => {
    const req = findRequestForSession(currentSession);
    visibleRequestIdRef.current = req?.id || null;
    setLoadingRequestId(req?.id || null);

    if (currentSession) {
      loadSession(currentSession);
    } else {
      setMessages(req ? buildOverlayMessages(null) : []);
    }
  }, [
    buildOverlayMessages,
    currentSession,
    findRequestForSession,
    loadSession,
  ]);

  useEffect(() => {
    const container = rootRef.current?.querySelector(".messages-80m");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, loadingRequestId]);

  const startChatRequest = useCallback(
    async (
      text: string,
      options: {
        attachments?: Message["attachments"];
        kind?: "foreground" | "background";
        displayUserMessage?: boolean;
        sessionId?: string | null;
        displaySessionId?: string | null;
        excludeMessageId?: string;
      } = {},
    ) => {
      if (!window.hermesAPI) return;

      const kind = options.kind || "foreground";
      const startedAt = Date.now();
      const requestId = `chat-${startedAt}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const activeSessionId =
        kind === "background"
          ? null
          : options.sessionId !== undefined
            ? options.sessionId
            : currentSessionRef.current;
      const displaySessionId =
        options.displaySessionId !== undefined
          ? options.displaySessionId
          : currentSessionRef.current;
      const localKey =
        displaySessionId ||
        activeSessionId ||
        `${kind === "background" ? "background" : "request"}:${requestId}`;
      const displayUserMessage = options.displayUserMessage !== false;

      const userMsg: Message = {
        id: `user-${startedAt}-${Math.random().toString(16).slice(2)}`,
        role: "user",
        content: text,
        createdAt: startedAt,
        attachments: options.attachments?.length
          ? options.attachments
          : undefined,
      };

      if (displayUserMessage) {
        pendingMessagesRef.current[localKey] = [
          ...(pendingMessagesRef.current[localKey] || []),
          userMsg,
        ];
        setMessages((prev) => [...prev, userMsg]);
      }

      const initialResponse =
        kind === "background" ? "**Background run started**\n\n" : "";
      const request: ActiveRequest = {
        id: requestId,
        sessionId: activeSessionId,
        displaySessionId,
        localKey,
        response: initialResponse,
        createdAt: startedAt,
        kind,
      };
      activeRequestsRef.current[requestId] = request;

      if (kind === "foreground") {
        visibleRequestIdRef.current = requestId;
        setLoadingRequestId(requestId);
        if (!activeSessionId) onNewSession?.();
      } else if (isRequestVisible(request)) {
        const assistant = makeAssistantMessage(request);
        if (assistant) setMessages((prev) => upsertMessage(prev, assistant));
      }

      window.dispatchEvent(
        new CustomEvent("chat-started", {
          detail: {
            conversationId,
            requestId,
            sessionId: activeSessionId,
            background: kind === "background",
          },
        }),
      );

      try {
        const history =
          kind === "background"
            ? []
            : messagesRef.current
                .filter(
                  (msg) =>
                    msg.id !== options.excludeMessageId &&
                    (msg.role === "user" || msg.role === "assistant"),
                )
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
        const errorMsg: Message = {
          id: `error-${requestId}`,
          role: "assistant",
          content: `**Error:** ${err}`,
          createdAt: req.createdAt + 1,
        };
        cacheOverlayMessage(req.localKey, errorMsg);
        delete activeRequestsRef.current[requestId];
        syncVisibleLoading();
        window.dispatchEvent(
          new CustomEvent("chat-finished", {
            detail: {
              conversationId,
              requestId,
              error: String(err),
              background: kind === "background",
            },
          }),
        );
        if (isRequestVisible(req)) {
          setMessages((prev) => upsertMessage(prev, errorMsg));
        }
      }
    },
    [
      activeProject,
      cacheOverlayMessage,
      conversationId,
      isRequestVisible,
      onNewSession,
      profile,
      syncVisibleLoading,
    ],
  );

  const drainQueuedTurn = useCallback(
    async (preferredSessionId?: string | null) => {
      const [next, ...rest] = queuedTurnsRef.current;
      if (!next) return;
      updateQueuedTurns(rest);
      const text =
        next.mode === "steer" ? buildSteerTurnPrompt(next.text) : next.text;
      await startChatRequest(text, {
        kind: "foreground",
        displayUserMessage: false,
        sessionId:
          preferredSessionId !== undefined
            ? preferredSessionId
            : currentSessionRef.current,
        excludeMessageId: next.messageId,
      });
    },
    [startChatRequest, updateQueuedTurns],
  );

  const enqueueBusyTurn = useCallback(
    (
      text: string,
      mode: "queue" | "steer",
      attachments?: Message["attachments"],
    ) => {
      const request = loadingRequestId
        ? activeRequestsRef.current[loadingRequestId]
        : null;
      const localKey =
        currentSessionRef.current ||
        request?.localKey ||
        `queued:${Date.now()}`;
      const createdAt = Date.now();
      const messageId = `queued-user-${createdAt}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const userMsg: Message = {
        id: messageId,
        role: "user",
        content: text,
        createdAt,
        attachments: attachments?.length ? attachments : undefined,
      };
      pendingMessagesRef.current[localKey] = [
        ...(pendingMessagesRef.current[localKey] || []),
        userMsg,
      ];
      const next = [
        ...queuedTurnsRef.current,
        {
          id: `queued-${createdAt}-${Math.random().toString(16).slice(2)}`,
          text,
          mode,
          messageId,
          createdAt,
        },
      ];
      updateQueuedTurns(next);
      setMessages((prev) => [...prev, userMsg]);
      showToast(
        mode === "steer" ? "Steer staged" : "Message queued",
        mode === "steer"
          ? "Hermes API has no native steer endpoint yet, so this will run at the next turn boundary."
          : "This will send after the current run finishes.",
        "info",
      );
    },
    [loadingRequestId, showToast, updateQueuedTurns],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const attachments = draftAttachments;
      const parsed = parseBusyCommand(text);
      const command = parsed.command;
      const payload = parsed.command ? parsed.payload : text.trim();
      if (!payload) {
        showToast("Missing prompt", "Add text after the command.", "warning");
        return;
      }

      const isBusy = Boolean(loadingRequestId);
      if (isBusy) {
        const effectiveMode = command || busySendMode;
        if (effectiveMode === "background") {
          await startChatRequest(payload, { attachments, kind: "background" });
          setDraftAttachments([]);
          return;
        }
        enqueueBusyTurn(payload, effectiveMode, attachments);
        setDraftAttachments([]);
        return;
      }

      if (command === "background") {
        await startChatRequest(payload, { attachments, kind: "background" });
        setDraftAttachments([]);
        return;
      }

      const browserTarget = inferBrowserTargetFromPrompt(payload);
      if (browserTarget) {
        openBrowserPreview(browserTarget);
        showToast(
          "Browser opened",
          browserTarget,
          "info",
        );
      }

      await startChatRequest(payload, { attachments, kind: "foreground" });
      setDraftAttachments([]);
    },
    [
      busySendMode,
      draftAttachments,
      enqueueBusyTurn,
      loadingRequestId,
      showToast,
      startChatRequest,
    ],
  );

  useEffect(() => {
    if (!acceptsDesktopBuddyInput) return undefined;
    const cleanup = window.hermesAPI?.onDesktopBuddyTranscript?.((payload) => {
      const text = String(payload?.text || "").trim();
      if (!text) return;
      void handleSend(text);
    });
    return () => cleanup?.();
  }, [acceptsDesktopBuddyInput, handleSend]);

  const handleStopRequest = useCallback(() => {
    if (!loadingRequestId) return;
    void window.hermesAPI?.abortChat(loadingRequestId);
  }, [loadingRequestId]);

  useChatRuntimeEvents({
    activeRequestsRef,
    cacheOverlayMessage,
    conversationId,
    drainQueuedTurn,
    isAudible,
    isRequestVisible,
    loadSession,
    onSessionChange,
    pendingMessagesRef,
    queuedTurnsRef,
    resolveRequest,
    setMessages,
    syncVisibleLoading,
  });

  return (
    <div
      ref={rootRef}
      className={`main-80m ${isDraggingFiles ? "file-drop-active" : ""}`}
      {...dragHandlers}
    >
      {isDraggingFiles ? <ChatFileDropOverlay /> : null}
      <Messages
        messages={messages}
        isLoading={Boolean(loadingRequestId)}
        assistantLabel={assistantLabel || profile || "80M Agent"}
      />
      <InputBar
        onSend={handleSend}
        isBusy={Boolean(loadingRequestId)}
        busyMode={busySendMode}
        queuedCount={queuedTurns.length}
        onBusyModeChange={setBusySendMode}
        onStop={handleStopRequest}
        draftInsert={draftInsert}
        attachments={draftAttachments}
        onRemoveAttachment={(path) =>
          setDraftAttachments((current) =>
            current.filter((attachment) => attachment.path !== path),
          )
        }
        onDraftInsertConsumed={() => setDraftInsert(null)}
      />
    </div>
  );
};

export default ChatArea;
