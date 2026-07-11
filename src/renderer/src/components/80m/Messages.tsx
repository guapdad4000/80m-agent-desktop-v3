import React, { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Copy,
  ExternalLink,
  PanelRightOpen,
  Wrench,
} from "lucide-react";
import Animated80MLogo from "../Animated80MLogo";
import {
  canPreviewHref,
  dispatchToast,
  extractFileArtifact,
  extractFilePreview,
  extractToolActivity,
  formatBytes,
  normalizeExternalHref,
  parseJsonRecord,
  parseToolCalls,
  stripHermesLineNumbers,
} from "./messageToolUtils";
import type {
  DocumentPreviewData,
  FileArtifactData,
  FilePreviewData,
} from "./messageToolUtils";
import type { DroppedAttachment } from "./chatAreaTypes";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt?: number;
  attachments?: DroppedAttachment[];
  tool_calls?: string;
  tool_name?: string;
}

interface Props {
  messages: Message[];
  isLoading: boolean;
  assistantLabel?: string;
}

function ToolCallsBlock({
  value,
}: {
  value?: string;
}): React.JSX.Element | null {
  const calls = parseToolCalls(value);
  if (calls.length === 0) return null;

  return (
    <div className="assistant-tool-calls">
      <div className="assistant-tool-calls-title">
        <Wrench size={13} />
        <span>Tool calls</span>
      </div>
      {calls.map((call, index) => (
        <details
          className="assistant-tool-call"
          key={call.id || `${call.name}-${index}`}
          open
        >
          <summary>
            <span className="assistant-tool-call-name">{call.name}</span>
            {call.id && (
              <span className="assistant-tool-call-id">{call.id}</span>
            )}
          </summary>
          <pre>
            <code>{call.argumentsText || call.rawText}</code>
          </pre>
        </details>
      ))}
    </div>
  );
}

function AttachmentPreviewList({
  attachments,
  compact = false,
}: {
  attachments?: DroppedAttachment[];
  compact?: boolean;
}): React.JSX.Element | null {
  if (!attachments?.length) return null;

  return (
    <div className={`attachment-preview-list${compact ? " compact" : ""}`}>
      {attachments.map((attachment) => (
        <div className="attachment-preview-item" key={attachment.path}>
          {attachment.kind === "image" && attachment.fileUrl ? (
            <img
              className="attachment-preview-thumb"
              src={attachment.fileUrl}
              alt=""
            />
          ) : (
            <span className="attachment-preview-icon" aria-hidden="true">
              {attachment.kind === "pdf"
                ? "PDF"
                : attachment.kind === "directory"
                  ? "DIR"
                  : "FILE"}
            </span>
          )}
          <span className="attachment-preview-copy">
            <span className="attachment-preview-name">{attachment.name}</span>
            <span className="attachment-preview-path">{attachment.path}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function FileActions({ path }: { path?: string }): React.JSX.Element | null {
  const [status, setStatus] = useState("");
  if (!path) return null;
  const run = async (action: "open" | "reveal"): Promise<void> => {
    const ok =
      action === "open"
        ? await window.hermesAPI.openLocalPath(path)
        : await window.hermesAPI.revealLocalPath(path);
    setStatus(ok ? "" : "Not found");
    if (!ok) setTimeout(() => setStatus(""), 2200);
  };
  return (
    <div className="tool-file-actions">
      <button type="button" onClick={() => void run("open")}>
        Open
      </button>
      <button type="button" onClick={() => void run("reveal")}>
        Reveal
      </button>
      {status && <span className="tool-file-action-status">{status}</span>}
    </div>
  );
}

function DocumentPreview({
  path,
}: {
  path?: string;
}): React.JSX.Element | null {
  const [preview, setPreview] = useState<DocumentPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setPreview(null);
      return;
    }
    setLoading(true);
    window.hermesAPI
      .readDocumentPreview(path)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({
            path,
            name: path.split("/").pop() || path,
            exists: false,
            kind: "missing",
            size: 0,
            error: "Preview unavailable",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  if (loading && !preview) {
    return (
      <div className="tool-document-preview-empty">Loading preview...</div>
    );
  }
  if (!preview) return null;

  if (!preview.exists) {
    return (
      <div className="tool-document-preview-empty">
        {preview.error || "File not found"}
      </div>
    );
  }

  if (preview.kind === "image" && preview.fileUrl) {
    return (
      <div className="tool-media-preview">
        <img src={preview.fileUrl} alt={preview.name} />
      </div>
    );
  }

  if (preview.kind === "pdf" && preview.fileUrl) {
    return (
      <div className="tool-pdf-preview">
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
      <pre className="tool-file-content tool-document-preview-content">
        {lines.map((line, index) => (
          <div className="tool-file-line" key={`${preview.path}-${index}`}>
            <span className="tool-file-line-number">{index + 1}</span>
            <code>{line || " "}</code>
          </div>
        ))}
        {preview.truncated && (
          <div className="tool-document-preview-empty">Preview truncated.</div>
        )}
      </pre>
    );
  }

  return (
    <div className="tool-document-preview-empty">
      {preview.error ||
        (preview.kind === "directory"
          ? "Folder preview is unavailable."
          : "Preview unavailable for this file type.")}
    </div>
  );
}

function ToolFilePreview({
  file,
}: {
  file: FilePreviewData;
}): React.JSX.Element {
  const lines = stripHermesLineNumbers(file.content);
  const displayPath = file.path || "file preview";
  const sizeLabel = formatBytes(file.fileSize);

  return (
    <div className="tool-file-preview">
      <div className="tool-file-header">
        <div className="tool-file-title">
          <span className="tool-file-name">{displayPath}</span>
          <span className="tool-file-meta">
            {file.totalLines !== undefined ? `${file.totalLines} lines` : null}
            {file.totalLines !== undefined && sizeLabel ? " / " : null}
            {sizeLabel}
            {file.truncated ? " / truncated" : null}
          </span>
        </div>
        <FileActions path={file.path} />
      </div>
      {file.isBinary ? (
        <div className="tool-file-empty">
          Binary file preview is unavailable.
        </div>
      ) : (
        <pre className="tool-file-content">
          {lines.map((line, index) => (
            <div className="tool-file-line" key={`${index}-${line}`}>
              <span className="tool-file-line-number">{index + 1}</span>
              <code>{line || " "}</code>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function ToolFileArtifact({
  file,
}: {
  file: FileArtifactData;
}): React.JSX.Element {
  const label =
    file.action === "created"
      ? "Created file"
      : file.action === "moved"
        ? "Moved file"
        : file.action === "image"
          ? "Image preview"
          : file.action === "pdf"
            ? "PDF preview"
            : "File";
  const sizeLabel = formatBytes(file.bytes);

  return (
    <div className="tool-file-preview">
      <div className="tool-file-header">
        <div className="tool-file-title">
          <span className="tool-file-name">{file.path || file.sourcePath}</span>
          <span className="tool-file-meta">
            {label}
            {sizeLabel ? ` / ${sizeLabel}` : null}
            {file.sourcePath && file.path ? ` / from ${file.sourcePath}` : null}
            {file.output ? ` / ${file.output}` : null}
          </span>
        </div>
        <FileActions path={file.path || file.sourcePath} />
      </div>
      <DocumentPreview path={file.path || file.sourcePath} />
    </div>
  );
}

function compactToolText(value: unknown): string {
  if (typeof value === "string") {
    const text = value
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    return text || "No output";
  }
  if (value === null || value === undefined) return "No output";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ToolResultLine({
  detail,
  status = "Result",
  title,
}: {
  detail: string;
  status?: string;
  title: string;
}): React.JSX.Element {
  return (
    <div className="tool-activity-pill tool-result-line" title={title}>
      <span className="tool-activity-pill-icon" aria-hidden="true">
        <Check size={11} />
      </span>
      <span className="tool-activity-pill-status">{status}</span>
      <span className="tool-activity-pill-label">{detail}</span>
    </div>
  );
}

function ToolMessage({ msg }: { msg: Message }): React.JSX.Element {
  const filePreview = extractFilePreview(msg);
  const fileArtifact = filePreview ? null : extractFileArtifact(msg);
  const activity =
    filePreview || fileArtifact ? null : extractToolActivity(msg);
  const toolCalls = parseJsonRecord(msg.tool_calls);
  const activityStatus = activity?.error
    ? "error"
    : activity?.status?.toLowerCase();
  const title = activity
    ? `${activityStatus === "completed" ? "Tool complete" : activityStatus === "error" ? "Tool error" : activityStatus === "reasoning" ? "Reasoning update" : "Tool running"}${activity.tool ? `: ${activity.tool}` : ""}`
    : msg.tool_name === "terminal"
      ? "Ran terminal command"
      : filePreview
        ? "Read file"
        : fileArtifact
          ? fileArtifact.action === "created"
            ? "Created file"
            : fileArtifact.action === "moved"
              ? "Moved file"
              : fileArtifact.action === "image"
                ? "Opened image"
                : fileArtifact.action === "pdf"
                  ? "Opened PDF"
                  : "File result"
          : `Tool result${msg.tool_name ? `: ${msg.tool_name}` : ""}`;

  if (activity) {
    const statusLabel =
      activityStatus === "completed"
        ? "Done"
        : activityStatus === "error"
          ? "Error"
          : activityStatus === "reasoning"
            ? "Thinking"
            : "Running";
    const label = activity.label || activity.preview || activity.tool || title;

    return (
      <div className={`tool-activity-pill ${activityStatus || "running"}`}>
        <span className="tool-activity-pill-icon" aria-hidden="true">
          {activityStatus === "completed" ? (
            <Check size={11} />
          ) : (
            <Wrench size={11} />
          )}
        </span>
        <span className="tool-activity-pill-status">{statusLabel}</span>
        <span className="tool-activity-pill-label">{label}</span>
        {typeof activity.duration === "number" && (
          <span className="tool-activity-pill-meta">
            {activity.duration.toFixed(1)}s
          </span>
        )}
      </div>
    );
  }

  if (!filePreview && !fileArtifact) {
    const command =
      toolCalls && typeof toolCalls.command === "string"
        ? toolCalls.command
        : undefined;
    const detail = compactToolText(command || msg.content);

    if (msg.tool_name === "terminal" && msg.content) {
      window.dispatchEvent(new CustomEvent("agent-terminal-output", {
        detail: { command: command || "", output: msg.content, timestamp: Date.now() }
      }));
    }

    return (
      <ToolResultLine
        detail={detail}
        status={msg.tool_name === "terminal" ? "Terminal" : "Result"}
        title={title}
      />
    );
  }

  return (
    <div className="tool-preview-result">
      {filePreview ? (
        <ToolFilePreview file={filePreview} />
      ) : fileArtifact ? (
        <ToolFileArtifact file={fileArtifact} />
      ) : (
        <ToolResultLine detail="No output" title={title} />
      )}
    </div>
  );
}

function isFlatToolMessage(msg: Message): boolean {
  if (msg.role !== "tool") return false;
  if (extractFilePreview(msg) || extractFileArtifact(msg)) return false;
  return true;
}

const Messages: React.FC<Props> = ({
  messages,
  isLoading,
  assistantLabel = "80M Agent",
}) => {
  const [hoveredMsg, setHoveredMsg] = useState<string | null>(null);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);

  const copyMessage = async (msg: Message): Promise<void> => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsg(msg.id);
      dispatchToast("Copied", "Message copied to clipboard.", "success");
      window.setTimeout(() => setCopiedMsg(null), 1500);
    } catch {
      dispatchToast("Copy failed", "Clipboard permission was denied.", "error");
    }
  };

  const openLink = (
    href?: string,
    mode: "external" | "preview" = "external",
  ) => {
    const target = normalizeExternalHref(href);
    if (!target) {
      dispatchToast(
        "Link not opened",
        "Only web and mail links can leave the app.",
        "warning",
      );
      return;
    }

    if (mode === "preview") {
      if (!canPreviewHref(target)) {
        dispatchToast(
          "Preview unavailable",
          "Only web links can open in preview.",
          "warning",
        );
        return;
      }
      window.dispatchEvent(
        new CustomEvent("open-agent-preview-url", {
          detail: { url: target },
        }),
      );
      dispatchToast("Opening preview", target, "info");
      return;
    }

    void window.hermesAPI.openExternal(target);
  };

  const markdownComponents: Components = {
    a({ href, children, node: _node, ...props }) {
      const target = normalizeExternalHref(href);
      const previewable = canPreviewHref(target);
      return (
        <span className="msg-link-actions">
          <a
            {...props}
            href={target || href}
            title="Open outside"
            onClick={(event) => {
              event.preventDefault();
              openLink(href, event.altKey ? "preview" : "external");
            }}
          >
            {children}
            <ExternalLink size={11} aria-hidden="true" />
          </a>
          {previewable && (
            <button
              type="button"
              className="msg-link-preview-btn"
              title="Open in preview"
              aria-label="Open link in preview"
              onClick={() => openLink(href, "preview")}
            >
              <PanelRightOpen size={12} />
            </button>
          )}
        </span>
      );
    },
  };

  return (
    <div className="messages-80m">
      {messages.length === 0 && !isLoading && (
        <div className="welcome-empty-80m">
          <Animated80MLogo className="animated-80m-logo-welcome" />
          <h2>AGENT CONTROL</h2>
          <p>Send a message to start a session with your agent.</p>
        </div>
      )}
      {messages.map((msg, index) => {
        const flatToolMessage = isFlatToolMessage(msg);
        return (
          <div
            key={msg.id}
            className={`msg-80m ${msg.role}${flatToolMessage ? " tool-flat-message" : ""}`}
            onMouseEnter={() => setHoveredMsg(msg.id)}
            onMouseLeave={() => setHoveredMsg(null)}
          >
            {msg.role === "user" && (
              <div className="msg-80m-label">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                USER_ID:SVR
              </div>
            )}
            <div className="msg-80m-bubble">
              {msg.role !== "tool" && hoveredMsg === msg.id && (
                <div className="msg-80m-actions">
                  <button
                    className="msg-80m-action-btn"
                    title="Copy message"
                    type="button"
                    onClick={() => void copyMessage(msg)}
                  >
                    {copiedMsg === msg.id ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              )}
              {msg.role === "assistant" && (
                <div className="msg-80m-bot-icon">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 8V4H8" />
                    <rect x="4" y="8" width="16" height="12" rx="2" />
                    <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
                  </svg>
                </div>
              )}
              {msg.role === "assistant" ? (
                <div className="msg-80m-assistant-content">
                  <ToolCallsBlock value={msg.tool_calls} />
                  {(msg.content.trim() ||
                    (isLoading && index === messages.length - 1)) && (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {msg.content +
                        (isLoading && index === messages.length - 1
                          ? " █"
                          : "")}
                    </ReactMarkdown>
                  )}
                </div>
              ) : msg.role === "tool" ? (
                <div
                  className={`msg-80m-tool-block${flatToolMessage ? " tool-flat-inline-block" : ""}`}
                >
                  <ToolMessage msg={msg} />
                </div>
              ) : (
                <>
                  <AttachmentPreviewList attachments={msg.attachments} />
                  {msg.content}
                </>
              )}
            </div>
            {msg.role === "assistant" && (
              <div className="msg-80m-assistant-label">{assistantLabel}</div>
            )}
          </div>
        );
      })}
      {/* Thinking state is now handled by the animated ATM mascot in the sidebar */}
    </div>
  );
};

export default Messages;
