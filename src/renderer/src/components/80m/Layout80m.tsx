import React, { useState, useCallback, useEffect, ReactNode } from 'react';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import Settings from './Settings';
import Sessions from '../../screens/Sessions/Sessions';
import Memory from '../../screens/Memory/Memory';
import Soul from '../../screens/Soul/Soul';
import Skills from '../../screens/Skills/Skills';
import Tools from '../../screens/Tools/Tools';
import Gateway from '../../screens/Gateway/Gateway';
import Models from '../../screens/Models/Models';
import Schedules from '../../screens/Schedules/Schedules';
import CommandPalette from './CommandPalette';

type View =
  | 'chat'
  | 'sessions'
  | 'memory'
  | 'soul'
  | 'skills'
  | 'tools'
  | 'gateway'
  | 'settings'
  | 'models'
  | 'schedules';

const Layout80m: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('chat');
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>('default');

  const handleNewSession = useCallback(async () => {
    // Hermes owns session ids. Do not pre-create UUID rows in state.db;
    // first send creates a real Hermes session and ChatArea reports it back.
    setCurrentSession(null);
    setActiveView('chat');
  }, []);

  const handleSelectSession = useCallback((id: string | null) => {
    if (id === null) {
      // New chat requested via sidebar
      handleNewSession();
      return;
    }
    setCurrentSession(id);
    setActiveView('chat');
  }, [handleNewSession]);

  const handleBackToChat = useCallback(() => {
    setActiveView('chat');
  }, []);

  const handleViewChange = useCallback((v: string) => {
    setActiveView(v as View);
  }, []);

  // Ctrl+K / Cmd+K to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const renderMainContent = () => {
    const wrap = (_title: string, el: ReactNode) => (
      <div className="main-80m">
        <div className="screen-content-80m">
          {el}
        </div>
      </div>
    );
    switch (activeView) {
      case 'chat':
        return (
          <ChatArea
            currentSession={currentSession}
            onNewSession={handleNewSession}
            onSessionChange={setCurrentSession}
            profile={selectedAgent !== 'default' ? selectedAgent : undefined}
          />
        );
      case 'sessions':
        return (
          <Sessions
            onResumeSession={(id) => {
              setCurrentSession(id);
              setActiveView('chat');
            }}
            onNewChat={handleNewSession}
            currentSessionId={currentSession}
          />
        );
      case 'memory':
        return <Memory profile={selectedAgent !== 'default' ? selectedAgent : undefined} />;
      case 'soul':
        return wrap('SOUL', <Soul profile={selectedAgent !== 'default' ? selectedAgent : undefined} />);
      case 'skills':
        return wrap('SKILLS', <Skills profile={selectedAgent !== 'default' ? selectedAgent : undefined} />);
      case 'tools':
        return wrap('TOOLS', <Tools profile={selectedAgent !== 'default' ? selectedAgent : undefined} />);
      case 'gateway':
        return wrap('GATEWAY', <Gateway />);
      case 'settings':
        return <Settings onBack={handleBackToChat} />;
      case 'models':
        return wrap('MODELS', <Models />);
      case 'schedules':
        return wrap('SCHEDULES', <Schedules profile={selectedAgent !== 'default' ? selectedAgent : undefined} />);
      default:
        return (
          <ChatArea
            currentSession={currentSession}
            onNewSession={handleNewSession}
            onSessionChange={setCurrentSession}
            profile={selectedAgent !== 'default' ? selectedAgent : undefined}
          />
        );
    }
  };

  const handleAgentChange = useCallback((agent: string) => {
    if (agent !== selectedAgent) {
      // Switching agents invalidates any active session — clear it so the new
      // agent doesn't accidentally continue a session from the previous agent.
      setCurrentSession(null);
    }
    setSelectedAgent(agent);
  }, [selectedAgent]);

  const agentThemeClass = selectedAgent && selectedAgent !== 'default' 
    ? `theme-${selectedAgent.toLowerCase().replace(/\s+/g, '-')}` 
    : '';

  return (
    <div className={`layout-80m ${agentThemeClass}`}>
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        currentSession={currentSession}
        onSelectSession={handleSelectSession}
        selectedAgent={selectedAgent}
        onAgentChange={handleAgentChange}
      />
      {renderMainContent()}

      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onNavigate={(view) => {
          setActiveView(view as View);
          setShowCommandPalette(false);
        }}
        onNewChat={() => {
          handleNewSession();
          setShowCommandPalette(false);
        }}
      />

      {/* Expose toggle for Ctrl+K via a custom event */}
      <div
        id="layout80m-cmd-toggle"
        style={{ display: 'none' }}
        onClick={() => setShowCommandPalette((p) => !p)}
      />

      {/* Global CRT Scanlines Overlay */}
      <div className="crt-overlay pointer-events-none" />
    </div>
  );
};

export default Layout80m;
