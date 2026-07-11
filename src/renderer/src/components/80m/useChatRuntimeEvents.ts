import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { playDoneSound, playTTS, playTypingSound } from "./chatAreaAudio";
import type { Message } from "./Messages";
import type {
  ActiveRequest,
  ChatAreaProps,
  ChatToolProgressPayload,
  QueuedChatTurn,
} from "./chatAreaTypes";
import {
  makeAssistantMessage,
  makeToolProgressMessage,
  mergeMessages,
  requestDisplaySession,
  upsertMessage,
} from "./chatAreaUtils";

interface UseChatRuntimeEventsArgs {
  activeRequestsRef: MutableRefObject<Record<string, ActiveRequest>>;
  cacheOverlayMessage: (key: string, msg: Message) => void;
  conversationId: string | undefined;
  drainQueuedTurn: (preferredSessionId?: string | null) => Promise<void>;
  isAudible: boolean;
  isRequestVisible: (req: ActiveRequest) => boolean;
  loadSession: (id: string) => Promise<void>;
  onSessionChange: ChatAreaProps["onSessionChange"];
  pendingMessagesRef: MutableRefObject<Record<string, Message[]>>;
  queuedTurnsRef: MutableRefObject<QueuedChatTurn[]>;
  resolveRequest: (requestId?: string) => ActiveRequest | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  syncVisibleLoading: (targetSession?: string | null) => void;
}

export function useChatRuntimeEvents({
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
}: UseChatRuntimeEventsArgs): void {
  useEffect(() => {
    if (!window.hermesAPI) return;

    const cleanupChunk = window.hermesAPI.onChatChunk(
      (chunk: string, requestId?: string) => {
        const req = resolveRequest(requestId);
        if (!req) return;
        req.response += chunk;
        if (!isRequestVisible(req)) return;

        playTypingSound();
        setMessages((prev) => {
          const assistant = makeAssistantMessage(req);
          return assistant ? upsertMessage(prev, assistant) : prev;
        });
      },
    );

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress(
      (tool: ChatToolProgressPayload, requestId?: string) => {
        const req = resolveRequest(requestId);
        if (!req) return;

        const toolMsg = makeToolProgressMessage(req, tool);
        cacheOverlayMessage(req.localKey, toolMsg);
        if (!isRequestVisible(req)) return;
        setMessages((prev) => upsertMessage(prev, toolMsg));
      },
    );

    const cleanupDone = window.hermesAPI.onChatDone(
      (newSessionId: string | undefined, requestId?: string) => {
        const req = resolveRequest(requestId);
        if (!req) return;

        const isVisible = isRequestVisible(req);
        const resolvedSessionId = newSessionId || req.sessionId || null;
        const displaySessionId = requestDisplaySession(req);
        const overlayKey =
          req.kind === "background"
            ? displaySessionId || req.localKey
            : resolvedSessionId || req.localKey;
        const finalAssistant = makeAssistantMessage(req);
        if (overlayKey) {
          const finalMessages = [
            ...(pendingMessagesRef.current[req.localKey] || []),
            ...(finalAssistant ? [finalAssistant] : []),
          ];
          pendingMessagesRef.current[overlayKey] = mergeMessages(
            pendingMessagesRef.current[overlayKey] || [],
            finalMessages,
          );
        }
        if (overlayKey !== req.localKey) {
          delete pendingMessagesRef.current[req.localKey];
        }
        delete activeRequestsRef.current[req.id];
        syncVisibleLoading();
        window.dispatchEvent(new CustomEvent("sessions-updated"));
        window.dispatchEvent(
          new CustomEvent("chat-finished", {
            detail: {
              conversationId,
              requestId: req.id,
              sessionId: resolvedSessionId,
              background: req.kind === "background",
            },
          }),
        );

        if (req.kind === "background") {
          if (isVisible && finalAssistant) {
            setMessages((prev) => upsertMessage(prev, finalAssistant));
          }
          return;
        }

        const shouldDrainQueue = queuedTurnsRef.current.length > 0;

        onSessionChange?.(resolvedSessionId);
        if (resolvedSessionId) {
          loadSession(resolvedSessionId);
        }

        if (isAudible) {
          playDoneSound();
          void playTTS(req.response);
        }
        if (isVisible && finalAssistant) {
          setMessages((prev) => upsertMessage(prev, finalAssistant));
        }

        if (shouldDrainQueue) {
          window.setTimeout(() => {
            void drainQueuedTurn(resolvedSessionId);
          }, 0);
        }
      },
    );

    const cleanupError = window.hermesAPI.onChatError(
      (error: string, requestId?: string) => {
        const req = resolveRequest(requestId);
        if (!req) return;
        const isVisible = isRequestVisible(req);
        const errorMsg: Message = {
          id: `error-${req.id}`,
          role: "assistant" as const,
          content: `**Error:** ${error}`,
          createdAt: req.createdAt + 1,
        };
        const errorOverlayKey = requestDisplaySession(req) || req.localKey;
        cacheOverlayMessage(errorOverlayKey, errorMsg);

        if (errorOverlayKey !== req.localKey) {
          delete pendingMessagesRef.current[req.localKey];
        }
        delete activeRequestsRef.current[req.id];
        syncVisibleLoading();
        window.dispatchEvent(
          new CustomEvent("chat-finished", {
            detail: {
              conversationId,
              requestId: req.id,
              error,
              background: req.kind === "background",
            },
          }),
        );

        if (!isVisible) return;
        setMessages((prev) => upsertMessage(prev, errorMsg));
        if (req.kind === "foreground" && queuedTurnsRef.current.length > 0) {
          window.setTimeout(() => {
            void drainQueuedTurn(req.sessionId);
          }, 0);
        }
      },
    );

    return () => {
      cleanupChunk();
      cleanupToolProgress();
      cleanupDone();
      cleanupError();
    };
  }, [
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
  ]);
}
