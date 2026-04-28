import React, { useState, useCallback, useEffect } from 'react';
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

  const handleNewSession = useCallback(() => {
    setCurrentSession(null);
  }, []);

  const handleSelectSession = useCallback((id: string | null) => {
    setCurrentSession(id);
    setActiveView('chat');
  }, []);

  const handleBackToChat = useCallback(() => {
    setActiveView('chat');
  }, []);

  const handleOpenSessions = useCallback(() => {
    setActiveView('sessions');
  }, []);

  const handleOpenMemory = useCallback(() => {
    setActiveView('memory');
  }, []);

  const handleOpenSkills = useCallback(() => {
    setActiveView('skills');
  }, []);

  const handleOpenSettings = useCallback(() => {
    setActiveView('settings');
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
    switch (activeView) {
      case 'chat':
        return (
          <ChatArea
            currentSession={currentSession}
            onNewSession={handleNewSession}
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
        return <Memory />;
      case 'soul':
        return <Soul />;
      case 'skills':
        return <Skills />;
      case 'tools':
        return <Tools />;
      case 'gateway':
        return <Gateway />;
      case 'settings':
        return <Settings onBack={handleBackToChat} />;
      case 'models':
        return <Models />;
      case 'schedules':
        return <Schedules />;
      default:
        return (
          <ChatArea
            currentSession={currentSession}
            onNewSession={handleNewSession}
          />
        );
    }
  };

  return (
    <div className="layout-80m">
      <Sidebar
        activeView={activeView}
        onViewChange={(v) => setActiveView(v as View)}
        currentSession={currentSession}
        onSelectSession={handleSelectSession}
      />
      {renderMainContent()}

      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onNewChat={() => {
          handleNewSession();
          setActiveView('chat');
          setShowCommandPalette(false);
        }}
        onOpenSessions={handleOpenSessions}
        onOpenMemory={handleOpenMemory}
        onOpenSkills={handleOpenSkills}
        onOpenSettings={handleOpenSettings}
      />

      {/* Expose toggle for Ctrl+K via a custom event */}
      <div
        id="layout80m-cmd-toggle"
        style={{ display: 'none' }}
        onClick={() => setShowCommandPalette((p) => !p)}
      />
    </div>
  );
};

export default Layout80m;
