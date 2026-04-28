import React, { useState, useEffect, useCallback, useRef } from 'react';
import Messages from './Messages';
import InputBar from './InputBar';
import type { Message } from './Messages';

interface ChatAreaProps {
  currentSession: string | null;
  onNewSession: () => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({ currentSession, onNewSession }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(currentSession);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubChunkRef = useRef<(() => void) | null>(null);
  const unsubDoneRef = useRef<(() => void) | null>(null);
  const unsubErrorRef = useRef<(() => void) | null>(null);
  const fullResponseRef = useRef('');

  // Sync session
  useEffect(() => {
    setSessionId(currentSession);
    if (currentSession) {
      loadSession(currentSession);
    } else {
      setMessages([]);
    }
  }, [currentSession]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Cleanup subscriptions
  useEffect(() => {
    return () => {
      unsubChunkRef.current?.();
      unsubDoneRef.current?.();
      unsubErrorRef.current?.();
    };
  }, []);

  const loadSession = useCallback(async (id: string) => {
    if (!window.hermesAPI) return;
    try {
      const msgs = await window.hermesAPI.getSessionMessages(id);
      setMessages(
        (msgs || []).map((m: { role: string; content: string }, i: number) => ({
          id: `${id}-${i}`,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }))
      );
    } catch (_) {}
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      if (!window.hermesAPI) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      fullResponseRef.current = '';

      let activeSessionId = sessionId;
      if (!activeSessionId) {
        onNewSession();
        activeSessionId = `session-${Date.now()}`;
        setSessionId(activeSessionId);
      }

      // Subscribe to streaming events
      unsubChunkRef.current = window.hermesAPI.onChatChunk((chunk: string) => {
        fullResponseRef.current += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              { ...last, content: fullResponseRef.current },
            ];
          }
          return [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant' as const,
              content: chunk,
            },
          ];
        });
      });

      unsubDoneRef.current = window.hermesAPI.onChatDone((newSessionId: string | undefined) => {
        setSessionId(newSessionId || activeSessionId);
        setIsLoading(false);
        unsubChunkRef.current?.();
        unsubDoneRef.current?.();
        unsubErrorRef.current?.();
      });

      unsubErrorRef.current = window.hermesAPI.onChatError((error: string) => {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: `**Error:** ${error}`,
          },
        ]);
        setIsLoading(false);
        unsubChunkRef.current?.();
        unsubDoneRef.current?.();
        unsubErrorRef.current?.();
      });

      try {
        await window.hermesAPI.sendMessage(text, 'default', activeSessionId || undefined, []);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: `**Error:** ${err}`,
          },
        ]);
        setIsLoading(false);
        unsubChunkRef.current?.();
        unsubDoneRef.current?.();
        unsubErrorRef.current?.();
      }
    },
    [sessionId, onNewSession]
  );

  return (
    <div className="main-80m">
      <Messages messages={messages} isLoading={isLoading} />
      <div ref={messagesEndRef} />
      <InputBar onSend={handleSend} disabled={isLoading} />
    </div>
  );
};

export default ChatArea;
