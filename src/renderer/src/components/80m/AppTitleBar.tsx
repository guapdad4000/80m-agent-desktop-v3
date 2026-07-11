import React, { useCallback, useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    document.documentElement.classList.toggle("window-maximized", isMaximized);
    return () => {
      document.documentElement.classList.remove("window-maximized");
    };
  }, [isMaximized]);

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

  const toggleMaximize = useCallback(() => {
    window.hermesAPI
      .windowToggleMaximize()
      .then(setIsMaximized)
      .catch(() => undefined);
  }, []);

  return (
    <div className="app-titlebar" onDoubleClick={toggleMaximize}>
      {/* Ticker notification area */}
      <div className="app-titlebar-ticker">
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

      {/* Window controls removed — Mac has native traffic lights top-left */}
    </div>
  );
};

export default AppTitleBar;
