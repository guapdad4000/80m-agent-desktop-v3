import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";

type NotificationTone = "info" | "success" | "warning" | "error";

interface AppNotificationPayload {
  title: string;
  body?: string;
  tone?: NotificationTone;
  createdAt?: number;
}

interface Toast extends AppNotificationPayload {
  id: string;
  tone: NotificationTone;
}

const iconForTone = (tone: NotificationTone): React.JSX.Element => {
  switch (tone) {
    case "success":
      return <CheckCircle2 size={16} />;
    case "warning":
      return <TriangleAlert size={16} />;
    case "error":
      return <XCircle size={16} />;
    default:
      return <Info size={16} />;
  }
};

const AppNotifications: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (payload: AppNotificationPayload) => {
      if (!payload.title && !payload.body) return;
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const toast: Toast = {
        ...payload,
        id,
        tone: payload.tone ?? "info",
      };
      setToasts((current) => [toast, ...current].slice(0, 4));
      window.setTimeout(() => removeToast(id), 5200);
    },
    [removeToast],
  );

  useEffect(() => {
    const cleanup = window.hermesAPI.onAppNotification(addToast);
    const handleLocalToast = ((event: CustomEvent<AppNotificationPayload>) => {
      addToast(event.detail);
    }) as EventListener;

    window.addEventListener("desktop-toast", handleLocalToast);
    return () => {
      cleanup();
      window.removeEventListener("desktop-toast", handleLocalToast);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="app-notification-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`app-notification app-notification-${toast.tone}`}
        >
          <div className="app-notification-icon">{iconForTone(toast.tone)}</div>
          <div className="app-notification-copy">
            <div className="app-notification-title">{toast.title}</div>
            {toast.body && (
              <div className="app-notification-body">{toast.body}</div>
            )}
          </div>
          <button
            type="button"
            className="app-notification-close"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => removeToast(toast.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default AppNotifications;
