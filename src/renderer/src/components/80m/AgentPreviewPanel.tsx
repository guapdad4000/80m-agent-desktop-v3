import React, { useState, useEffect } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const AgentPreviewPanel: React.FC<Props> = ({ isOpen, onClose }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState<string>("");
  const [isActive, setIsActive] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    // Check initial state
    // @ts-ignore
    window.hermesAPI.getBrowserState().then((state: any) => {
      if (state && state.url && state.url !== "about:blank") {
        setUrl(state.url);
        setInputUrl(state.url);
        setIsActive(true);
      }
    });

    // Listen to playwright navigation
    // @ts-ignore
    const cleanup = window.hermesAPI.onPlaywrightNavigated((newUrl: string) => {
      if (newUrl !== "about:blank") {
        setUrl(newUrl);
        setInputUrl(newUrl);
        setIsActive(true);
      }
    });

    return cleanup;
  }, [isOpen]);

  const handleStartPlaywright = async () => {
    // @ts-ignore
    await window.hermesAPI.startBrowser();
    setIsActive(true);
  };

  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl) return;
    let target = inputUrl;
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = "https://" + target;
    }
    if (!isActive) {
      await handleStartPlaywright();
    }
    // @ts-ignore
    await window.hermesAPI.navigateBrowser(target);
  };

  if (!isOpen) return null;

  return (
    <div className="agent-preview-panel">
      <div className="agent-preview-header">
        <div className="agent-preview-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          Agent Browser Preview
        </div>
        <button className="agent-preview-close" onClick={onClose} title="Close Preview">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="agent-preview-toolbar" style={{ display: 'flex', padding: '6px 12px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', gap: '8px' }}>
        <form onSubmit={handleNavigate} style={{ display: 'flex', flex: 1, gap: '6px' }}>
          <input 
            type="text" 
            className="input" 
            style={{ flex: 1, padding: '4px 8px', fontSize: '12px' }} 
            placeholder="Agent Target URL..." 
            value={inputUrl} 
            onChange={(e) => setInputUrl(e.target.value)} 
          />
          <button type="submit" className="btn btn-primary btn-sm" style={{ padding: '4px 12px', fontSize: '12px' }}>
            Go
          </button>
        </form>
      </div>

      <div className="agent-preview-content">
        {!isActive || !url ? (
          <div className="agent-preview-placeholder">
            <div className="agent-preview-spinner"></div>
            <p>Waiting for agent browser activity...</p>
            <span className="agent-preview-hint">Playwright session inactive</span>
            {!isActive && (
              <button className="btn btn-secondary btn-sm" onClick={handleStartPlaywright} style={{ marginTop: '10px' }}>
                Start Background Browser
              </button>
            )}
          </div>
        ) : (
          <webview 
            src={url} 
            style={{ width: '100%', height: '100%' }}
            // @ts-ignore
            allowpopups="true"
          />
        )}
      </div>
    </div>
  );
};

export default AgentPreviewPanel;
