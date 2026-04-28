import React, { useState, useEffect, useCallback } from 'react';
import AtmMascot from './AtmMascot';

interface Session {
  id: string;
  name: string;
  agent: string;
  updatedAt: number;
}

interface SidebarProps {
  onSelectSession: (id: string | null) => void;
  currentSession: string | null;
  activeView: 'chat' | 'settings';
  onViewChange: (view: 'chat' | 'settings') => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  onSelectSession,
  currentSession,
  activeView,
  onViewChange,
}) => {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    loadSessions();
  }, []);

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
      id: 'settings',
      label: 'Config',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="sidebar-80m">
      <div className="sidebar-80m-brand">
        80<span>M</span>
      </div>

      <div className="sidebar-80m-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-80m-nav-item${activeView === item.id ? ' active' : ''}`}
            onClick={() => {
              if (item.id === 'chat' || item.id === 'settings') {
                onViewChange(item.id as 'chat' | 'settings');
              }
            }}
            title={item.label}
          >
            <span className="nav-indicator" />
            {item.icon}
            <span className="sidebar-80m-nav-label">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Session list */}
      {sessions.length > 0 && (
        <div className="sidebar-80m-sessions">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`sidebar-80m-session-item${currentSession === s.id ? ' active' : ''}`}
              onClick={() => onSelectSession(s.id)}
              title={s.name}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* ATM Mascot at bottom */}
      <div className="sidebar-80m-mascot">
        <AtmMascot state="default" />
      </div>
    </div>
  );
};

export default Sidebar;
