import { useCallback, useRef, useState } from "react";

export type ConversationViewMode = "tabs" | "split";

export interface ConversationTab {
  id: string;
  sessionId: string | null;
  profile: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export function createConversationTab(
  profile = "default",
  sessionId: string | null = null,
): ConversationTab {
  const now = Date.now();
  const id = `conversation-${now}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    sessionId,
    profile,
    title: sessionId ? `Session ${sessionId.slice(0, 6)}` : "New chat",
    createdAt: now,
    updatedAt: now,
  };
}

export function labelForProfile(profile: string): string {
  const labels: Record<string, string> = {
    default: "80M Agent",
    prawnius: "Prawnius",
    sirclawthchilds: "Sir Clawthchilds",
    sir_clawthchilds: "Sir Clawthchilds",
    claudnelius: "Claudnelius",
    caludnelius: "Claudnelius",
    knowledge_knaight: "Knowledge Knaight",
    knaight_of_affairs: "Knaight of Affairs",
    labrina: "Labrina",
    clawdette: "Clawdette",
    gpt55coder: "GPT 5.5 Coder",
    claudeorchestrator: "Claude Orchestrator",
  };
  return (
    labels[profile] ||
    profile
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export function labelForConversation(tab: ConversationTab): string {
  return tab.sessionId ? tab.title : "New chat";
}

export function useConversationTabs() {
  const initialConversationRef = useRef<ConversationTab | null>(null);
  if (!initialConversationRef.current) {
    initialConversationRef.current = createConversationTab();
  }

  const [conversations, setConversations] = useState<ConversationTab[]>(() => [
    initialConversationRef.current!,
  ]);
  const [activeConversationId, setActiveConversationId] = useState<string>(
    () => initialConversationRef.current!.id,
  );
  const [conversationViewMode, setConversationViewMode] =
    useState<ConversationViewMode>("tabs");

  const activeConversation =
    conversations.find((tab) => tab.id === activeConversationId) ||
    conversations[0];
  const selectedAgent = activeConversation?.profile || "default";
  const currentSession = activeConversation?.sessionId || null;

  const openConversation = useCallback(
    (sessionId: string | null = null, profile = selectedAgent) => {
      if (sessionId) {
        const existing = conversations.find(
          (tab) => tab.sessionId === sessionId && tab.profile === profile,
        );
        if (existing) {
          setActiveConversationId(existing.id);
          return;
        }
      }

      const tab = createConversationTab(profile, sessionId);
      setConversations((current) => [...current, tab]);
      setActiveConversationId(tab.id);
    },
    [conversations, selectedAgent],
  );

  const updateConversationSession = useCallback(
    (conversationId: string, sessionId: string | null) => {
      setConversations((current) =>
        current.map((tab) => {
          if (tab.id !== conversationId) return tab;
          return {
            ...tab,
            sessionId,
            title: sessionId ? `Session ${sessionId.slice(0, 6)}` : "New chat",
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [],
  );

  const closeConversation = useCallback(
    (id: string, runningConversationIds: Set<string>) => {
      if (runningConversationIds.has(id)) return;

      setConversations((current) => {
        if (current.length <= 1) {
          const replacement = createConversationTab(selectedAgent);
          setActiveConversationId(replacement.id);
          return [replacement];
        }

        const closeIndex = current.findIndex((tab) => tab.id === id);
        const next = current.filter((tab) => tab.id !== id);
        if (activeConversationId === id) {
          const nextIndex = Math.max(0, closeIndex - 1);
          setActiveConversationId(next[nextIndex]?.id || next[0].id);
        }
        return next;
      });
    },
    [activeConversationId, selectedAgent],
  );

  const setActiveConversationProfile = useCallback(
    (agent: string) => {
      setConversations((current) =>
        current.map((tab) => {
          if (tab.id !== activeConversationId) return tab;
          return {
            ...tab,
            profile: agent,
            sessionId: agent !== tab.profile ? null : tab.sessionId,
            title: agent !== tab.profile ? "New chat" : tab.title,
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeConversationId],
  );

  return {
    activeConversationId,
    closeConversation,
    conversationViewMode,
    conversations,
    currentSession,
    openConversation,
    selectedAgent,
    setActiveConversationId,
    setActiveConversationProfile,
    setConversationViewMode,
    updateConversationSession,
  };
}
