import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import AtmMascot from './AtmMascot';
import { AgentTab, AGENTS, type AgentId } from './AgentTab';
import Animated80MLogo from '../Animated80MLogo';
import { Plus } from 'lucide-react';

interface Session {
  id: string;
  name: string;
  agent: string;
  updatedAt: number;
}

interface SidebarProps {
  onSelectSession: (id: string | null) => void;
  currentSession: string | null;
  activeView: string;
  onViewChange: (view: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const Sidebar: React.FC<SidebarProps> = ({
  onSelectSession,
  currentSession,
  activeView,
  onViewChange,
}) => {
  const [selectedAgent, setSelectedAgent] = useState<AgentId>('prawnius');
  const [isAgentWorking] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);

  const loadSessions = useCallback(async () => {
    if (!window.hermesAPI) return;
    try {
      const list = await window.hermesAPI.listSessions();
      setSessions(
        (list || []).map((s: { id: string; name?: string; updatedAt?: number }) => ({
          id: s.id,
          name: s.name || `Session ${s.id.slice(0, 6)}`,
          agent: 'prawnius',
          updatedAt: s.updatedAt || Date.now(),
        }))
      );
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Nav items for the 80m app
  const navItems = [
    {
      id: 'chat',
      label: 'Chat',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: 'sessions',
      label: 'History',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      id: 'memory',
      label: 'Memory',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
          <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        </svg>
      ),
    },
    {
      id: 'soul',
      label: 'Soul',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    },
    {
      id: 'skills',
      label: 'Skills',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z" />
        </svg>
      ),
    },
    {
      id: 'tools',
      label: 'Tools',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      ),
    },
    {
      id: 'gateway',
      label: 'Gateway',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  // Sessions filtered by selected agent
  const filteredSessions = sessions.filter((s) => {
    if (s.agent) return s.agent === selectedAgent;
    const nameLower = s.name.toLowerCase();
    return (
      nameLower.includes(selectedAgent) ||
      nameLower.includes(AGENTS.find((a) => a.id === selectedAgent)?.name.toLowerCase() || '')
    );
  });

  return (
    <div className="sidebar-80m">
      {/* Brand Header with Animated80MLogo */}
      <div className="sidebar-80m-brand">
        <img 
          src="https://i.postimg.cc/d18ByxQX/Beige-ATM-with-transparent-screen.png" 
          alt="80M ATM Mascot" 
          style={{ height: 48, width: 'auto', objectFit: 'contain', display: 'block', margin: '0 auto' }} 
        />
        <Animated80MLogo />
      </div>

      {/* Agent Tabs */}
      <div className="sidebar-80m-agents">
        {AGENTS.map((agent) => (
          <AgentTab
            key={agent.id}
            agent={agent}
            isActive={selectedAgent === agent.id}
            isWorking={isAgentWorking && selectedAgent === agent.id}
            onClick={() => setSelectedAgent(agent.id)}
          />
        ))}
      </div>

      {/* Navigation */}
      <div className="sidebar-80m-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-80m-nav-item${activeView === item.id ? ' active' : ''}`}
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
            {filteredSessions.length > 0 ? (
              filteredSessions.map((s) => (
                <button
                  key={s.id}
                  className={`sidebar-80m-session-item${currentSession === s.id ? ' active' : ''}`}
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

      {/* ATM Mascot at bottom */}
      <div className="sidebar-80m-mascot">
        <AtmMascot state="default" />
      </div>
    </div>
  );
};

export default Sidebar;
