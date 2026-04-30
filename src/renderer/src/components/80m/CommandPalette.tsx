import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Command {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: string) => void;
  onNewChat: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onNewChat,
}) => {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: Command[] = [
    { id: "new-chat", label: "New Chat", icon: "💬", action: onNewChat },
    {
      id: "chat",
      label: "Go to Chat",
      icon: "💬",
      action: () => onNavigate("chat"),
    },
    {
      id: "sessions",
      label: "Open History",
      icon: "📋",
      action: () => onNavigate("sessions"),
    },
    {
      id: "memory",
      label: "Open Memory",
      icon: "🧠",
      action: () => onNavigate("memory"),
    },
    {
      id: "soul",
      label: "Open Soul",
      icon: "⚡",
      action: () => onNavigate("soul"),
    },
    {
      id: "skills",
      label: "Open Skills",
      icon: "🛠️",
      action: () => onNavigate("skills"),
    },
    {
      id: "tools",
      label: "Open Tools",
      icon: "🔧",
      action: () => onNavigate("tools"),
    },
    {
      id: "gateway",
      label: "Open Gateway",
      icon: "🌐",
      action: () => onNavigate("gateway"),
    },
    {
      id: "models",
      label: "Open Models",
      icon: "🤖",
      action: () => onNavigate("models"),
    },
    {
      id: "schedules",
      label: "Open Schedules",
      icon: "📅",
      action: () => onNavigate("schedules"),
    },
    {
      id: "settings",
      label: "Open Settings",
      icon: "⚙️",
      action: () => onNavigate("settings"),
    },
  ];

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(search.toLowerCase()),
  );

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
      if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        filtered[selectedIndex]?.action();
      }
    },
    [onClose, filtered, selectedIndex],
  );

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

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
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="command-palette-search-icon"
              >
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
            <div className="command-palette-list" ref={listRef}>
              {filtered.length === 0 ? (
                <div className="command-palette-empty">No commands found</div>
              ) : (
                filtered.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    className={`command-palette-item${i === selectedIndex ? " selected" : ""}`}
                    onClick={cmd.action}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <span className="command-palette-item-icon">
                      {cmd.icon}
                    </span>
                    <span className="command-palette-item-label">
                      {cmd.label}
                    </span>
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
