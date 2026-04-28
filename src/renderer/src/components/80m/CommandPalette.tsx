import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Command {
  label: string;
  icon: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpenSessions: () => void;
  onOpenMemory: () => void;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNewChat,
  onOpenSessions,
  onOpenMemory,
  onOpenSkills,
  onOpenSettings,
}) => {
  const [search, setSearch] = useState('');

  const commands: Command[] = [
    { label: 'New Chat', icon: '💬', action: () => { onNewChat(); onClose(); } },
    { label: 'Open Sessions', icon: '📋', action: () => { onOpenSessions(); onClose(); } },
    { label: 'Open Memory', icon: '🧠', action: () => { onOpenMemory(); onClose(); } },
    { label: 'Open Skills', icon: '🛠️', action: () => { onOpenSkills(); onClose(); } },
    { label: 'Open Settings', icon: '⚙️', action: () => { onOpenSettings(); onClose(); } },
    { label: 'Toggle Dark Mode', icon: '🌙', action: () => {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
      onClose();
    }},
  ];

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(search.toLowerCase())
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="command-palette-overlay"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="command-palette"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="command-palette-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="command-palette-search-icon">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a command..."
                className="command-palette-input"
              />
              <kbd className="command-palette-esc">ESC</kbd>
            </div>
            <div className="command-palette-list">
              {filtered.length === 0 ? (
                <div className="command-palette-empty">No commands found</div>
              ) : (
                filtered.map((cmd, i) => (
                  <button
                    key={i}
                    className="command-palette-item"
                    onClick={cmd.action}
                  >
                    <span className="command-palette-item-icon">{cmd.icon}</span>
                    <span className="command-palette-item-label">{cmd.label}</span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CommandPalette;
