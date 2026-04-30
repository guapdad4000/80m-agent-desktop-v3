import React, { useState, useEffect, useCallback, useRef } from 'react';
import Messages from './Messages';
import InputBar from './InputBar';
import type { Message } from './Messages';

interface ChatAreaProps {
  currentSession: string | null;
  onNewSession: () => void;
  onSessionChange?: (sessionId: string | null) => void;
  profile?: string;
}

const ChatArea: React.FC<ChatAreaProps> = ({ currentSession, onNewSession, onSessionChange, profile }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(currentSession);

  const unsubChunkRef = useRef<(() => void) | null>(null);
  const unsubDoneRef = useRef<(() => void) | null>(null);
  const unsubErrorRef = useRef<(() => void) | null>(null);
  const fullResponseRef = useRef('');

  const playDoneSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (_) {
      // Audio not available
    }
  }, []);

  const playTypingSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(150 + Math.random() * 50, ctx.currentTime);
      
      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch (_) {
      // Audio not available
    }
  }, []);

  // Sync session
  useEffect(() => {
    setSessionId(currentSession);
    if (currentSession) {
      loadSession(currentSession);
    } else {
      setMessages([]);
    }
  }, [currentSession]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const container = document.querySelector('.messages-80m');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
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
        // Do not invent local/UUID session ids here. Hermes owns session ids.
        // The first successful response returns the real Hermes session id.
        onNewSession();
        activeSessionId = null;
      }

      // Subscribe to streaming events
      unsubChunkRef.current = window.hermesAPI.onChatChunk((chunk: string) => {
        fullResponseRef.current += chunk;
        playTypingSound();
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
        const resolvedSessionId = newSessionId || activeSessionId || null;
        setSessionId(resolvedSessionId);
        onSessionChange?.(resolvedSessionId);
        setIsLoading(false);
        playDoneSound();
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

      // Notify the mascot that we are thinking
      window.dispatchEvent(new CustomEvent('chat-started'));

      try {
        const history = messages
          .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
          .slice(-20)
          .map((msg) => ({ role: msg.role, content: msg.content }));
        await window.hermesAPI.sendMessage(text, profile || 'default', activeSessionId || undefined, history);
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
    [sessionId, onNewSession, onSessionChange, playDoneSound, profile, messages]
  );

  return (
    <div className="main-80m">
      <Messages messages={messages} isLoading={isLoading} />
      <InputBar onSend={handleSend} disabled={isLoading} />
    </div>
  );
};

export default ChatArea;
