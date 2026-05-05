import React, { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import AtmMascot from "./AtmMascot";
import Animated80MLogo from "../Animated80MLogo";
import { Brain, Plus } from "lucide-react";

interface Session {
  id: string;
  name: string;
  agent: string;
  updatedAt: number;
}

interface Profile {
  name: string;
  isActive: boolean;
}

interface SidebarProps {
  onSelectSession: (id: string | null) => void;
  currentSession: string | null;
  activeView: string;
  onViewChange: (view: string) => void;
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const playPowerUpSound = () => {
  try {
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(100, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.3);

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) {
    // Audio not available
  }
};

const Sidebar: React.FC<SidebarProps> = ({
  onSelectSession,
  currentSession,
  activeView,
  onViewChange,
  selectedAgent,
  onAgentChange,
}) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [mascotState, setMascotState] = useState<
    | "default"
    | "processing"
    | "typing"
    | "sleep"
    | "error"
    | "searching"
    | "jackpot"
    | "lobster"
    | "urgent"
    | "job-done"
  >("default");
  const activeMascotRequestsRef = React.useRef<Set<string>>(new Set());
  const mascotTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mascotPulseRef = React.useRef(0);

  useEffect(() => {
    if (!window.hermesAPI) return;

    const activeMascotRequests = activeMascotRequestsRef.current;

    const clearMascotTimer = () => {
      if (mascotTimerRef.current) {
        clearTimeout(mascotTimerRef.current);
        mascotTimerRef.current = null;
      }
    };

    const hasActiveWork = () => activeMascotRequests.size > 0;

    const scheduleWorkingPulse = () => {
      clearMascotTimer();
      if (!hasActiveWork()) return;
      mascotTimerRef.current = setTimeout(() => {
        const states = ["processing", "searching", "typing"] as const;
        mascotPulseRef.current = (mascotPulseRef.current + 1) % states.length;
        setMascotState(states[mascotPulseRef.current]);
        scheduleWorkingPulse();
      }, 4500);
    };

    const markActive = (requestId?: string) => {
      activeMascotRequests.add(requestId || "default");
      setMascotState("processing");
      scheduleWorkingPulse();
    };

    const markSettled = (requestId?: string) => {
      if (requestId) {
        activeMascotRequests.delete(requestId);
      } else {
        activeMascotRequests.clear();
      }
      clearMascotTimer();
    };

    const settleToDefault = (state: "job-done" | "error") => {
      if (hasActiveWork()) {
        setMascotState("processing");
        scheduleWorkingPulse();
        return;
      }
      setMascotState(state);
      mascotTimerRef.current = setTimeout(
        () => setMascotState("default"),
        3500,
      );
    };

    const unsubChunk = window.hermesAPI.onChatChunk?.((_chunk, requestId) => {
      if (requestId && !activeMascotRequests.has(requestId)) {
        activeMascotRequests.add(requestId);
      }
      setMascotState("typing");
      scheduleWorkingPulse();
    });

    const unsubTool = window.hermesAPI.onChatToolProgress?.(
      (_tool, requestId) => {
        if (requestId && !activeMascotRequests.has(requestId)) {
          activeMascotRequests.add(requestId);
        }
        setMascotState("searching");
        scheduleWorkingPulse();
      },
    );

    const unsubDone = window.hermesAPI.onChatDone?.((_sessionId, requestId) => {
      markSettled(requestId);
      settleToDefault("job-done");
    });

    const unsubError = window.hermesAPI.onChatError?.((_error, requestId) => {
      markSettled(requestId);
      settleToDefault("error");
    });

    const handleChatStart = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string }>).detail;
      markActive(detail?.requestId);
    };
    window.addEventListener("chat-started", handleChatStart);

    const handleSpeakingStart = () => {
      setMascotState("typing");
      scheduleWorkingPulse();
    };
    const handleSpeakingStop = () => {
      if (hasActiveWork()) {
        setMascotState("processing");
        scheduleWorkingPulse();
      } else {
        setMascotState("default");
      }
    };
    window.addEventListener("agent-speaking-start", handleSpeakingStart);
    window.addEventListener("agent-speaking-stop", handleSpeakingStop);

    return () => {
      unsubChunk?.();
      unsubTool?.();
      unsubDone?.();
      unsubError?.();
      window.removeEventListener("chat-started", handleChatStart);
      window.removeEventListener("agent-speaking-start", handleSpeakingStart);
      window.removeEventListener("agent-speaking-stop", handleSpeakingStop);
      clearMascotTimer();
      activeMascotRequests.clear();
    };
  }, []);

  const loadSessions = useCallback(async () => {
    if (!window.hermesAPI) return;
    try {
      const list = await window.hermesAPI.listSessions();
      setSessions(
        (list || []).map(
          (s: { id: string; title?: string | null; startedAt?: number }) => ({
            id: s.id,
            name: s.title || `Session ${s.id.slice(0, 6)}`,
            agent: selectedAgent,
            updatedAt: s.startedAt || Date.now() / 1000,
          }),
        ),
      );
    } catch (_) {}
  }, [selectedAgent]);

  const loadProfiles = useCallback(async () => {
    if (!window.hermesAPI) return;
    try {
      const list = await window.hermesAPI.listProfiles();
      setProfiles(
        (list || []).map((p) => ({
          name: p.name,
          isActive: p.isActive,
        })),
      );
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions, currentSession]);

  useEffect(() => {
    const refresh = () => {
      void loadSessions();
    };
    window.addEventListener("sessions-updated", refresh);
    return () => window.removeEventListener("sessions-updated", refresh);
  }, [loadSessions]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Nav items for the 80m app
  const navItems = [
    {
      id: "chat",
      label: "Chat",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: "sessions",
      label: "History",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      id: "soul",
      label: "Soul",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    },
    {
      id: "skills",
      label: "Skills",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z" />
        </svg>
      ),
    },
    {
      id: "tools",
      label: "Tools",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      ),
    },
    {
      id: "gateway",
      label: "Gateway",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
    },
    {
      id: "settings",
      label: "Settings",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="sidebar-80m">
      {/* Brand Header with logo + ATM mascot */}
      <div className="sidebar-80m-brand">
        <div className="sidebar-80m-brand-row">
          <Animated80MLogo />
        </div>
        <div className="sidebar-80m-atm-container">
          <AtmMascot state={mascotState} />
        </div>
      </div>

      {/* Agent Switcher — always visible */}
      <div className="sidebar-80m-agent-switcher">
        <select
          className="sidebar-80m-agent-select"
          value={selectedAgent}
          onChange={(e) => {
            playPowerUpSound();
            onAgentChange(e.target.value);
          }}
        >
          <option value="default">Default Agent</option>
          {profiles
            .filter((p) => p.name !== "default")
            .map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
        </select>
      </div>

      <button
        className={`sidebar-80m-second-brain${activeView === "memory" ? " active" : ""}`}
        onClick={() => onViewChange("memory")}
        title="Second Brain"
      >
        <Brain size={16} />
        <span>Second Brain</span>
      </button>

      {/* Navigation */}
      <div className="sidebar-80m-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-80m-nav-item${activeView === item.id ? " active" : ""}`}
            onClick={() => onViewChange(item.id)}
          >
            <span className="nav-indicator" />
            <span className="nav-icon">{item.icon}</span>
            <span className="sidebar-80m-nav-label">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Sessions List */}
      <div className="sidebar-80m-sessions">
        <div className="sidebar-80m-sessions-header">
          <span>Sessions</span>
          <button
            className="sidebar-80m-new-chat"
            onClick={() => onSelectSession(null)}
            title="New Chat"
          >
            <Plus size={14} />
          </button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedAgent}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {sessions.length > 0 ? (
              sessions.map((s) => (
                <button
                  key={s.id}
                  className={`sidebar-80m-session-item${currentSession === s.id ? " active" : ""}`}
                  onClick={() => onSelectSession(s.id)}
                  title={s.name}
                >
                  <span className="session-name">{s.name}</span>
                  <span className="session-time">{timeAgo(s.updatedAt)}</span>
                </button>
              ))
            ) : (
              <div className="sidebar-80m-sessions-empty">No sessions</div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Sidebar;
