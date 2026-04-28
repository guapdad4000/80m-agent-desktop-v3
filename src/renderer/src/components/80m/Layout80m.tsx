import React, { useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import Settings from './Settings';

type View = 'chat' | 'settings';

const Layout80m: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('chat');
  const [currentSession, setCurrentSession] = useState<string | null>(null);

  const handleNewSession = useCallback(() => {
    setCurrentSession(null);
  }, []);

  const handleSelectSession = useCallback((id: string | null) => {
    setCurrentSession(id);
    setActiveView('chat');
  }, []);

  return (
    <div className="layout-80m">
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        currentSession={currentSession}
        onSelectSession={handleSelectSession}
      />
      {activeView === 'chat' ? (
        <ChatArea
          currentSession={currentSession}
          onNewSession={handleNewSession}
        />
      ) : (
        <Settings onBack={() => setActiveView('chat')} />
      )}
    </div>
  );
};

export default Layout80m;
