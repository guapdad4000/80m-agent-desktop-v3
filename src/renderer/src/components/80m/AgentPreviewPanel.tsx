/* eslint-disable react/no-unknown-property */
import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Globe2,
  Play,
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

type PreviewMode = "files" | "browser";

function normalizeBrowserTarget(value: string): string {
  const target = value.trim();
  if (!target) return "";
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return target;
  }
  return `https://${target}`;
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

  const activeProjectName = useMemo(() => {
    if (!activeProject) return "";
    return activeProject.split("/").filter(Boolean).pop() || activeProject;
  }, [activeProject]);

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
      setMode("files");
      setLastChange(change);
      setSelectedPath(change.path);
    });

    return () => {
      cancelled = true;
      cleanupChange();
      setWatching(false);
      void window.hermesAPI.unwatchWorkspace();
    };
  }, [activeProject, isOpen]);

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
  };

  const handleNavigate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!inputUrl) return;
    const target = normalizeBrowserTarget(inputUrl);
    if (!isBrowserActive) {
      await handleStartPlaywright();
    }
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

  return (
    <div className="agent-preview-panel">
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
            className={`agent-preview-tab ${mode === "browser" ? "active" : ""}`}
            onClick={() => setMode("browser")}
            title="Browser"
            type="button"
          >
            <Globe2 size={14} />
            <span>Browser</span>
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

      {mode === "browser" ? (
        <>
          <div className="agent-preview-toolbar">
            <form onSubmit={handleNavigate} className="agent-preview-url-form">
              <input
                type="text"
                className="input agent-preview-url-input"
                placeholder="Agent target URL"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm agent-preview-go-btn"
                title="Go"
              >
                Go
              </button>
            </form>
          </div>

          <div className="agent-preview-content">
            {!isBrowserActive || !url ? (
              <div className="agent-preview-placeholder">
                <div className="agent-preview-spinner"></div>
                <p>Waiting for browser activity...</p>
                <span className="agent-preview-hint">
                  Playwright session inactive
                </span>
                {!isBrowserActive && (
                  <button
                    className="btn btn-secondary btn-sm agent-preview-start-btn"
                    onClick={handleStartPlaywright}
                    title="Start Browser"
                    type="button"
                  >
                    <Play size={13} />
                    Start
                  </button>
                )}
              </div>
            ) : (
              <webview
                src={url}
                className="agent-preview-webview"
                allowpopups={true}
              />
            )}
          </div>
        </>
      ) : (
        <div className="agent-file-preview">
          <div className="agent-file-preview-header">
            <div className="agent-file-preview-title">
              <span className="agent-file-project">
                {activeProjectName || "No project"}
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
