import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: string;
  tool_name?: string;
}

interface Props {
  messages: Message[];
  isLoading: boolean;
}

type JsonRecord = Record<string, unknown>;

interface FilePreviewData {
  content: string;
  path?: string;
  totalLines?: number;
  fileSize?: number;
  truncated?: boolean;
  isBinary?: boolean;
  isImage?: boolean;
}

function parseJsonRecord(value?: string): JsonRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function stringValue(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function numberValue(record: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function booleanValue(record: JsonRecord, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function extractFilePreview(msg: Message): FilePreviewData | null {
  const result = parseJsonRecord(msg.content);
  if (!result || typeof result.content !== "string") return null;

  const calls = parseJsonRecord(msg.tool_calls);
  const path =
    stringValue(result, ["path", "file_path", "filepath", "destPath"]) ||
    (calls
      ? stringValue(calls, ["path", "file_path", "filepath", "filename"])
      : undefined);

  return {
    content: result.content,
    path,
    totalLines: numberValue(result, ["total_lines", "totalLines"]),
    fileSize: numberValue(result, ["file_size", "fileSize", "bytes"]),
    truncated: booleanValue(result, ["truncated"]),
    isBinary: booleanValue(result, ["is_binary", "isBinary"]),
    isImage: booleanValue(result, ["is_image", "isImage"]),
  };
}

function stripHermesLineNumbers(content: string): string[] {
  return content.split("\n").map((line) => line.replace(/^\s*\d+\|/, ""));
}

function formatBytes(bytes?: number): string | null {
  if (typeof bytes !== "number") return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
        {file.path && (
          <div className="tool-file-actions">
            <button
              type="button"
              onClick={() => void window.hermesAPI.openLocalPath(file.path!)}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => void window.hermesAPI.revealLocalPath(file.path!)}
            >
              Reveal
            </button>
          </div>
        )}
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

function ToolMessage({ msg }: { msg: Message }): React.JSX.Element {
  const filePreview = extractFilePreview(msg);
  const toolCalls = parseJsonRecord(msg.tool_calls);

  if (msg.tool_name === "terminal") {
    return (
      <div className="terminal-visualizer">
        <div className="terminal-header">
          <span className="terminal-dot"></span>
          <span className="terminal-dot"></span>
          <span className="terminal-dot"></span>
          <span className="terminal-title">TERMINAL EXECUTION</span>
        </div>
        {toolCalls && typeof toolCalls.command === "string" && (
          <pre className="terminal-command">
            <code>{toolCalls.command}</code>
          </pre>
        )}
        <pre className="terminal-output">
          <code>{msg.content}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="generic-tool-visualizer">
      <div className="tool-header">Tool: {msg.tool_name || "result"}</div>
      {filePreview ? (
        <ToolFilePreview file={filePreview} />
      ) : (
        <pre>
          <code>{msg.content}</code>
        </pre>
      )}
    </div>
  );
}

const Messages: React.FC<Props> = ({ messages, isLoading }) => {
  const [hoveredMsg, setHoveredMsg] = useState<string | null>(null);

  return (
    <div className="messages-80m">
      {messages.length === 0 && !isLoading && (
        <div className="welcome-empty-80m">
          <h2>80M AGENT CONTROL</h2>
          <p>Send a message to start a session with your agent.</p>
        </div>
      )}
      {messages.map((msg, index) => (
        <div
          key={`${msg.id}-${index}`}
          className={`msg-80m ${msg.role}`}
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
            {msg.role === "assistant" && hoveredMsg === msg.id && (
              <div className="msg-80m-actions">
                <button className="msg-80m-action-btn" title="Copy">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {msg.content +
                  (isLoading && index === messages.length - 1 ? " █" : "")}
              </ReactMarkdown>
            ) : msg.role === "tool" ? (
              <div className="msg-80m-tool-block">
                <ToolMessage msg={msg} />
              </div>
            ) : (
              msg.content
            )}
          </div>
          {msg.role === "assistant" && (
            <div className="msg-80m-assistant-label">prawnius_V4</div>
          )}
        </div>
      ))}
      {/* Thinking state is now handled by the animated ATM mascot in the sidebar */}
    </div>
  );
};

export default Messages;
