/* eslint-disable react/no-unknown-property */
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Globe2,
  Pause,
  Play,
  Terminal,
  X,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  activeProject?: string | null;
  isAgentWorking?: boolean;
}

interface WorkspaceFileChange {
  root: string;
  path: string;
  name: string;
  relativePath: string;
  event: string;
  size: number;
  modifiedAt: number;
}

interface DocumentPreviewData {
  path: string;
  name: string;
  exists: boolean;
  kind:
    | "text"
    | "markdown"
    | "image"
    | "pdf"
    | "office"
    | "directory"
    | "binary"
    | "missing";
  size: number;
  fileUrl?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
}

type PreviewMode = "files" | "browser" | "terminal";

function normalizeBrowserTarget(value: string): string {
  const target = value.trim();
  if (!target) return "";

  if (target.startsWith("http://") || target.startsWith("https://")) {
    return target;
  }

  const shortcut = target.toLowerCase();
  const shortcuts: Record<string, string> = {
    google: "https://www.google.com",
    youtube: "https://www.youtube.com",
    yt: "https://www.youtube.com",
    gmail: "https://mail.google.com",
    chatgpt: "https://chatgpt.com",
    rym: "https://rateyourmusic.com",
    rateyourmusic: "https://rateyourmusic.com",
    "rate your music": "https://rateyourmusic.com",
  };
  if (shortcuts[shortcut]) return shortcuts[shortcut];

  const looksLikeDomain = /^[^\s]+\.[^\s]+$/.test(target);
  if (looksLikeDomain) return `https://${target}`;

  return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== "number") return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFilePreview(
  preview: DocumentPreviewData | null,
  loading: boolean,
): React.JSX.Element {
  if (loading && !preview) {
    return <div className="agent-file-preview-empty">Loading preview...</div>;
  }

  if (!preview) {
    return (
      <div className="agent-file-preview-empty">No file activity yet.</div>
    );
  }

  if (!preview.exists) {
    return (
      <div className="agent-file-preview-empty">
        {preview.error || "File not found."}
      </div>
    );
  }

  if (preview.kind === "image" && preview.fileUrl) {
    return (
      <div className="agent-file-media">
        <img src={preview.fileUrl} alt={preview.name} />
      </div>
    );
  }

  if (preview.kind === "pdf" && preview.fileUrl) {
    return (
      <div className="agent-file-pdf">
        <iframe src={preview.fileUrl} title={preview.name} />
      </div>
    );
  }

  if (
    (preview.kind === "text" ||
      preview.kind === "markdown" ||
      preview.kind === "office") &&
    preview.content
  ) {
    const lines = preview.content.split("\n").slice(0, 220);
    return (
      <pre className="agent-file-code">
        {lines.map((line, index) => (
          <div className="agent-file-line" key={`${preview.path}-${index}`}>
            <span className="agent-file-line-number">{index + 1}</span>
            <code>{line || " "}</code>
          </div>
        ))}
        {preview.truncated && (
          <div className="agent-file-preview-empty">Preview truncated.</div>
        )}
      </pre>
    );
  }

  return (
    <div className="agent-file-preview-empty">
      {preview.kind === "directory"
        ? "Folder selected."
        : preview.error || "Preview unavailable for this file type."}
    </div>
  );
}

const AgentPreviewPanel: React.FC<Props> = ({
  isOpen,
  onClose,
  activeProject,
  isAgentWorking = false,
}) => {
  // Default to files view; browser mode is activated when the agent actually navigates somewhere
  const [mode, setMode] = useState<PreviewMode>("files");
  const [url, setUrl] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState<string>("");
  const [isBrowserActive, setIsBrowserActive] = useState<boolean>(false);
  const [watching, setWatching] = useState(false);
  const [lastChange, setLastChange] = useState<WorkspaceFileChange | null>(
    null,
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<DocumentPreviewData | null>(
    null,
  );
  const [fileLoading, setFileLoading] = useState(false);
  const [fileActionStatus, setFileActionStatus] = useState("");
  const [webviewError, setWebviewError] = useState(false);
  const [autoTrack, setAutoTrack] = useState(true);
  const webviewRef = React.useRef<Electron.WebviewTag | null>(null);

  interface TerminalEntry {
    command: string;
    output: string;
    timestamp: number;
  }
  const [terminalLog, setTerminalLog] = useState<TerminalEntry[]>([]);
  const terminalEndRef = React.useRef<HTMLDivElement | null>(null);

  const activeProjectName = useMemo(() => {
    if (!activeProject) return "";
    return activeProject.split("/").filter(Boolean).pop() || activeProject;
  }, [activeProject]);

  useEffect(() => {
    setWebviewError(false);
  }, [url]);

  useEffect(() => {
    if (!isOpen) return;

    window.hermesAPI.getBrowserState().then((state) => {
      if (state && state.url && state.url !== "about:blank") {
        setUrl(state.url);
        setInputUrl(state.url);
        setIsBrowserActive(true);
      }
    });

    const cleanup = window.hermesAPI.onPlaywrightNavigated((newUrl: string) => {
      if (newUrl !== "about:blank") {
        setUrl(newUrl);
        setInputUrl(newUrl);
        setIsBrowserActive(true);
      }
    });

    return cleanup;
  }, [isOpen]);

  useEffect(() => {
    setLastChange(null);
    setSelectedPath(null);
    setFilePreview(null);
  }, [activeProject]);

  useEffect(() => {
    if (!isOpen || !activeProject) {
      setWatching(false);
      return;
    }

    let cancelled = false;
    window.hermesAPI
      .watchWorkspace(activeProject)
      .then((ok) => {
        if (!cancelled) setWatching(ok);
      })
      .catch(() => {
        if (!cancelled) setWatching(false);
      });

    const cleanupChange = window.hermesAPI.onWorkspaceFileChanged((change) => {
      if (cancelled) return;
      setLastChange(change);
    });

    return () => {
      cancelled = true;
      cleanupChange();
      setWatching(false);
      void window.hermesAPI.unwatchWorkspace();
    };
  }, [activeProject, isOpen]);

  // Auto-track: when agent is working and autoTrack is on, jump to the latest changed file
  useEffect(() => {
    if (!autoTrack || !isAgentWorking || !lastChange) return;
    setMode("files");
    setSelectedPath(lastChange.path);
  }, [lastChange, autoTrack, isAgentWorking]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedPath) {
      setFilePreview(null);
      return;
    }

    setFileLoading(true);
    window.hermesAPI
      .readDocumentPreview(selectedPath)
      .then((result) => {
        if (!cancelled) setFilePreview(result as DocumentPreviewData);
      })
      .catch(() => {
        if (!cancelled) {
          setFilePreview({
            path: selectedPath,
            name: selectedPath.split("/").pop() || selectedPath,
            exists: false,
            kind: "missing",
            size: 0,
            error: "Preview unavailable.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPath, lastChange?.modifiedAt]);

  const handleStartPlaywright = async (): Promise<void> => {
    await window.hermesAPI.startBrowser();
    setIsBrowserActive(true);
    setUrl((current) => current || "about:blank");
  };

  const handleNavigate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!inputUrl) return;
    const target = normalizeBrowserTarget(inputUrl);
    if (!isBrowserActive) {
      await handleStartPlaywright();
    }
    setUrl(target);
    setInputUrl(target);
    await window.hermesAPI.navigateBrowser(target);
  };

  useEffect(() => {
    const handlePreviewUrl = ((event: CustomEvent<{ url: string }>) => {
      const target = normalizeBrowserTarget(event.detail?.url || "");
      if (!target) return;

      setMode("browser");
      setUrl(target);
      setInputUrl(target);
      setIsBrowserActive(true);
      void (async () => {
        await window.hermesAPI.startBrowser();
        await window.hermesAPI.navigateBrowser(target);
      })();
    }) as EventListener;

    window.addEventListener("open-agent-preview-url", handlePreviewUrl);
    return () =>
      window.removeEventListener("open-agent-preview-url", handlePreviewUrl);
  }, []);

  useEffect(() => {
    const handleToolOutput = ((e: CustomEvent<{command: string; output: string; timestamp: number}>) => {
      setTerminalLog((prev) => [...prev.slice(-199), e.detail]);
      // Auto-scroll
      setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      // Auto-switch to terminal tab when agent is working
      if (isAgentWorking) setMode("terminal");
    }) as EventListener;
    window.addEventListener("agent-terminal-output", handleToolOutput);
    return () => window.removeEventListener("agent-terminal-output", handleToolOutput);
  }, [isAgentWorking]);

  const runFileAction = async (action: "open" | "reveal"): Promise<void> => {
    if (!selectedPath) return;
    const ok =
      action === "open"
        ? await window.hermesAPI.openLocalPath(selectedPath)
        : await window.hermesAPI.revealLocalPath(selectedPath);
    setFileActionStatus(ok ? "" : "Not found");
    if (!ok) setTimeout(() => setFileActionStatus(""), 2200);
  };

  if (!isOpen) return null;

  const browserSrc = url || "about:blank";

  return (
    <div
      className={`agent-preview-panel agent-preview-panel--${mode}`}
      data-browser-active={isBrowserActive}
    >
      {mode === "browser" ? (
        <div className="agent-browser-frame">
          <div className="agent-browser-chrome">
            <div className="agent-browser-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="agent-browser-tab-cap" aria-hidden="true" />
            <button
              type="button"
              className="agent-browser-chrome-btn"
              title="Back"
              disabled
            >
              <ArrowLeft size={17} />
            </button>
            <button
              type="button"
              className="agent-browser-chrome-btn"
              title="Forward"
              disabled
            >
              <ArrowRight size={17} />
            </button>
            <form onSubmit={handleNavigate} className="agent-browser-url-form">
              <Globe2 size={14} />
              <input
                type="text"
                className="agent-browser-url-input"
                placeholder="Search Google or type a URL"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
              />
              <button
                type="submit"
                className="agent-browser-chrome-btn"
                title="Go"
              >
                <ExternalLink size={14} />
              </button>
            </form>
            <button
              type="button"
              className="agent-browser-chrome-btn"
              title="Open in Window"
              disabled={!inputUrl.trim()}
              onClick={() => {
                const target = (url && url !== "about:blank") ? url : normalizeBrowserTarget(inputUrl);
                if (target) void window.hermesAPI.openBrowserWindow(target);
              }}
            >
              <ExternalLink size={15} />
            </button>
            <button
              type="button"
              className="agent-browser-chrome-btn"
              onClick={() => setMode("files")}
              title="Files"
            >
              <FileText size={15} />
            </button>
            <button
              className="agent-browser-chrome-btn"
              onClick={onClose}
              title="Close Preview"
              type="button"
            >
              <X size={16} />
            </button>
          </div>

          <div className="agent-preview-content agent-browser-content">
            {browserSrc && browserSrc !== "about:blank" ? (
              webviewError ? (
                <div className="agent-file-preview-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, opacity: 0.7 }}>
                  <Globe2 size={28} />
                  <span style={{ textAlign: "center" }}>This page can&apos;t be embedded.</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      style={{ marginTop: 4, padding: "4px 12px", fontSize: 13, cursor: "pointer" }}
                      onClick={() => {
                        setWebviewError(false);
                        if (webviewRef.current) {
                          (webviewRef.current as Electron.WebviewTag).reload();
                        }
                      }}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      style={{ marginTop: 4, padding: "4px 12px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                      onClick={() => {
                        if (url && url !== "about:blank") {
                          void window.hermesAPI.openBrowserWindow(url);
                        }
                      }}
                    >
                      <ExternalLink size={13} />
                      Open in Window
                    </button>
                  </div>
                </div>
              ) : (
                <webview
                  ref={(el) => {
                    webviewRef.current = el as Electron.WebviewTag | null;
                    if (!el) return;

                    const wv = el as Electron.WebviewTag & {
                      dataset?: DOMStringMap;
                    };
                    if (wv.dataset?.browserFailHandlerAttached === "true") return;
                    if (wv.dataset) wv.dataset.browserFailHandlerAttached = "true";

                    const onFail = (event: Event) => {
                      const detail = event as Event & {
                        errorCode?: number;
                        errorDescription?: string;
                        isMainFrame?: boolean;
                      };

                      // Many real websites fail ad/tracker subframes while the main page loads fine.
                      // Do not replace the browser with an error screen unless the top-level page failed.
                      if (detail.isMainFrame === false) return;
                      if (detail.errorCode === -3) return; // ERR_ABORTED during normal navigation/redirects.
                      setWebviewError(true);
                    };
                    const onReady = () => setWebviewError(false);

                    wv.addEventListener("did-fail-load", onFail);
                    wv.addEventListener("did-finish-load", onReady);
                  }}
                  src={browserSrc}
                  className="agent-preview-webview"
                  allowpopups={true}
                />
              )
            ) : (
              <div className="agent-file-preview-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, opacity: 0.5 }}>
                <Globe2 size={28} />
                <span>No page loaded yet. Type a URL above or ask the agent to open a link.</span>
              </div>
            )}
          </div>
        </div>
      ) : mode === "terminal" ? (
        <div className="agent-file-preview" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div className="agent-preview-header">
            <div className="agent-preview-title">
              <Terminal size={16} />
              Terminal
            </div>
            <div className="agent-preview-tabs" role="tablist">
              <button className="agent-preview-tab" onClick={() => setMode("files")} title="Files" type="button">
                <FileText size={14} /><span>Files</span>
              </button>
              <button className="agent-preview-tab" onClick={() => setMode("browser")} title="Browser" type="button">
                <Globe2 size={14} /><span>Browser</span>
              </button>
              <button className="agent-preview-tab active" onClick={() => setMode("terminal")} title="Terminal" type="button">
                <Terminal size={14} /><span>Terminal</span>
              </button>
            </div>
            <button className="agent-preview-close" onClick={onClose} title="Close Preview" type="button">
              <X size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", background: "#0d0d0d", padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "#e2e8f0" }}>
            {terminalLog.length === 0 ? (
              <div style={{ opacity: 0.4, marginTop: 20, textAlign: "center" }}>No terminal output yet. Ask the agent to run something.</div>
            ) : (
              terminalLog.map((entry, i) => (
                <div key={`${entry.timestamp}-${i}`} style={{ marginBottom: 14 }}>
                  <div style={{ color: "#4ade80", marginBottom: 3 }}>$ {entry.command}</div>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#cbd5e1", opacity: 0.85 }}>{entry.output}</pre>
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>
      ) : (
        <div className="agent-file-preview">
          <div className="agent-preview-header">
            <div className="agent-preview-title">
              <Eye size={16} />
              Live Preview
            </div>
            <div className="agent-preview-tabs" role="tablist">
              <button
                className={`agent-preview-tab ${mode === "files" ? "active" : ""}`}
                onClick={() => setMode("files")}
                title="Files"
                type="button"
              >
                <FileText size={14} />
                <span>Files</span>
              </button>
              <button
                className="agent-preview-tab"
                onClick={() => setMode("browser")}
                title="Browser"
                type="button"
              >
                <Globe2 size={14} />
                <span>Browser</span>
              </button>
              <button
                className="agent-preview-tab"
                onClick={() => setMode("terminal")}
                title="Terminal"
                type="button"
              >
                <Terminal size={14} />
                <span>Terminal</span>
              </button>
            </div>
            <button
              className="agent-preview-close"
              onClick={onClose}
              title="Close Preview"
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <div className="agent-file-preview-header">
            <div className="agent-file-preview-title">
              <span className="agent-file-project" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {activeProjectName || "No project"}
                {isAgentWorking && autoTrack && (
                  <span
                    title="Auto-tracking live file changes"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      color: "#4ade80",
                      background: "rgba(74,222,128,0.12)",
                      border: "1px solid rgba(74,222,128,0.3)",
                      borderRadius: 4,
                      padding: "1px 5px",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#4ade80",
                        display: "inline-block",
                        animation: "livePulse 1.4s ease-in-out infinite",
                      }}
                    />
                    LIVE
                  </span>
                )}
              </span>
              <span className="agent-file-state">
                {watching
                  ? isAgentWorking
                    ? "Watching active run"
                    : "Watching"
                  : activeProject
                    ? "Watcher idle"
                    : "No project selected"}
              </span>
            </div>
            <div className="agent-file-actions">
              {isAgentWorking && (
                <button
                  type="button"
                  onClick={() => setAutoTrack((v) => !v)}
                  title={autoTrack ? "Pause auto-tracking" : "Resume auto-tracking"}
                  style={{ color: autoTrack ? "#4ade80" : undefined }}
                >
                  {autoTrack ? <Pause size={13} /> : <Play size={13} />}
                </button>
              )}
              <button
                type="button"
                onClick={() => void runFileAction("open")}
                disabled={!selectedPath}
                title="Open"
              >
                <ExternalLink size={13} />
              </button>
              <button
                type="button"
                onClick={() => void runFileAction("reveal")}
                disabled={!selectedPath}
                title="Reveal"
              >
                <FolderOpen size={13} />
              </button>
            </div>
          </div>

          {lastChange && (
            <div className="agent-file-meta">
              <span className="agent-file-path">{lastChange.relativePath}</span>
              <span>{formatBytes(lastChange.size)}</span>
              {fileActionStatus && <span>{fileActionStatus}</span>}
            </div>
          )}

          <div className="agent-file-preview-content">
            {!activeProject ? (
              <div className="agent-file-preview-empty">
                Select a project folder.
              </div>
            ) : !watching ? (
              <div className="agent-file-preview-empty">
                Workspace watcher unavailable.
              </div>
            ) : (
              renderFilePreview(filePreview, fileLoading)
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentPreviewPanel;
