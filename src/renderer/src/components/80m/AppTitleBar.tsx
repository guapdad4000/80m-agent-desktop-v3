import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Minus, Square, X } from "lucide-react";

type NotificationTone = "info" | "success" | "warning" | "error";

interface AppNotificationPayload {
  title: string;
  body?: string;
  tone?: NotificationTone;
  createdAt?: number;
}

interface TickerMessage extends AppNotificationPayload {
  id: string;
  text: string;
}

const formatTickerMessage = (payload: AppNotificationPayload): string => {
  const title = payload.title?.trim();
  const body = payload.body?.trim();
  return [title, body].filter(Boolean).join("  /  ");
};

const AppTitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [tickerMessages, setTickerMessages] = useState<TickerMessage[]>([]);
  const [tickerIndex, setTickerIndex] = useState(0);
  const platform = (window.electron?.process?.platform || "desktop")
    .toLowerCase()
    .replace(/\s+/g, "-");

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .windowIsMaximized()
      .then((value) => {
        if (!cancelled) setIsMaximized(value);
      })
      .catch(() => undefined);

    const cleanup = window.hermesAPI.onWindowMaximized(setIsMaximized);
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  const addTickerMessage = useCallback((payload: AppNotificationPayload) => {
    const text = formatTickerMessage(payload);
    if (!text) return;

    const id = `${payload.createdAt ?? Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    setTickerMessages((current) =>
      [
        {
          ...payload,
          id,
          text,
          createdAt: payload.createdAt ?? Date.now(),
        },
        ...current,
      ].slice(0, 8),
    );
    setTickerIndex(0);
  }, []);

  useEffect(() => {
    const cleanup = window.hermesAPI.onAppNotification(addTickerMessage);
    const handleLocalTicker = ((event: CustomEvent<AppNotificationPayload>) => {
      addTickerMessage(event.detail);
    }) as EventListener;

    window.addEventListener("desktop-toast", handleLocalTicker);
    return () => {
      cleanup();
      window.removeEventListener("desktop-toast", handleLocalTicker);
    };
  }, [addTickerMessage]);

  useEffect(() => {
    if (tickerMessages.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setTickerIndex((current) => (current + 1) % tickerMessages.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [tickerMessages.length]);

  const activeTicker = useMemo(() => {
    if (tickerMessages.length === 0) return null;
    return tickerMessages[tickerIndex % tickerMessages.length];
  }, [tickerIndex, tickerMessages]);

  const minimize = useCallback(() => {
    void window.hermesAPI.windowMinimize();
  }, []);

  const toggleMaximize = useCallback(() => {
    window.hermesAPI
      .windowToggleMaximize()
      .then(setIsMaximized)
      .catch(() => undefined);
  }, []);

  const close = useCallback(() => {
    void window.hermesAPI.windowClose();
  }, []);

  return (
    <div className={`app-titlebar app-titlebar-${platform}`}>
      <div className="app-titlebar-ticker" onDoubleClick={toggleMaximize}>
        {activeTicker && (
          <div
            key={activeTicker.id}
            className={`app-titlebar-ticker-track app-titlebar-ticker-${activeTicker.tone ?? "info"}`}
            aria-live="polite"
          >
            <span className="app-titlebar-ticker-count">
              {tickerMessages.length}
            </span>
            <span className="app-titlebar-ticker-copy">
              {activeTicker.text}
            </span>
          </div>
        )}
      </div>
      <div className="app-titlebar-drag" onDoubleClick={toggleMaximize} />
      <div className="app-titlebar-controls">
        <button
          type="button"
          className="app-titlebar-control"
          title="Minimize"
          aria-label="Minimize"
          onClick={minimize}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="app-titlebar-control"
          title={isMaximized ? "Restore" : "Maximize"}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={toggleMaximize}
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          className="app-titlebar-control close"
          title="Close"
          aria-label="Close"
          onClick={close}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default AppTitleBar;
