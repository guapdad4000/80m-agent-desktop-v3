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

interface FileArtifactData {
  path?: string;
  sourcePath?: string;
  action: "created" | "moved" | "file" | "image" | "pdf";
  bytes?: number;
  output?: string;
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

function prettyJson(value: string): string {
  const parsed = parseJsonRecord(value);
  return parsed ? JSON.stringify(parsed, null, 2) : value;
}

function stringValue(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function firstPathValue(
  ...records: Array<JsonRecord | null>
): string | undefined {
  const keys = [
    "path",
    "file_path",
    "filepath",
    "filename",
    "destPath",
    "dest_path",
    "destination",
    "target",
    "output_path",
  ];
  for (const record of records) {
    if (!record) continue;
    const found = stringValue(record, keys);
    if (found) return found;
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

function extensionFor(filePath?: string): string {
  if (!filePath) return "";
  const match = filePath.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return match?.[1] || "";
}

function isImagePath(filePath?: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(
    extensionFor(filePath),
  );
}

function isPdfPath(filePath?: string): boolean {
  return extensionFor(filePath) === "pdf";
}

function localFileUrl(filePath: string): string {
  return `file://${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

function splitShellArgs(command: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command))) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

function pathFromCommand(command?: string): {
  sourcePath?: string;
  destPath?: string;
} {
  if (!command) return {};
  const args = splitShellArgs(
    command.replace(/^\/bin\/(?:bash|sh)\s+-lc\s+/, ""),
  );
  const mvIndex = args.findIndex((arg) => arg === "mv" || arg.endsWith("/mv"));
  if (mvIndex >= 0 && args.length >= mvIndex + 3) {
    return {
      sourcePath: args[mvIndex + 1],
      destPath: args[mvIndex + 2],
    };
  }
  const redirectMatch = command.match(/>\s*["']?([^"'\s]+)["']?/);
  if (redirectMatch) return { destPath: redirectMatch[1] };
  return {};
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
  const path = firstPathValue(result, calls);

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

function extractFileArtifact(msg: Message): FileArtifactData | null {
  const result = parseJsonRecord(msg.content);
  const calls = parseJsonRecord(msg.tool_calls);
  const command =
    calls && typeof calls.command === "string" ? calls.command : undefined;
  const commandPaths = pathFromCommand(command);
  const path = firstPathValue(result, calls) || commandPaths.destPath;
  const sourcePath = commandPaths.sourcePath;
  const output = result
    ? stringValue(result, ["output", "message"])
    : undefined;
  const bytes = result
    ? numberValue(result, ["bytes_written", "bytes", "file_size", "fileSize"])
    : undefined;

  if (!path && !sourcePath) return null;

  if (path && isImagePath(path)) {
    return { path, sourcePath, action: "image", bytes, output };
  }
  if (path && isPdfPath(path)) {
    return { path, sourcePath, action: "pdf", bytes, output };
  }
  if (result && "bytes_written" in result) {
    return { path, sourcePath, action: "created", bytes, output };
  }
  if (command?.includes("mv ") || /moved/i.test(msg.content)) {
    return { path, sourcePath, action: "moved", bytes, output };
  }
  return { path, sourcePath, action: "file", bytes, output };
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

function FileActions({ path }: { path?: string }): React.JSX.Element | null {
  if (!path) return null;
  return (
    <div className="tool-file-actions">
      <button
        type="button"
        onClick={() => void window.hermesAPI.openLocalPath(path)}
      >
        Open
      </button>
      <button
        type="button"
        onClick={() => void window.hermesAPI.revealLocalPath(path)}
      >
        Reveal
      </button>
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
      {file.path && file.action === "image" && (
        <div className="tool-media-preview">
          <img src={localFileUrl(file.path)} alt={file.path} />
        </div>
      )}
      {file.path && file.action === "pdf" && (
        <div className="tool-pdf-preview">
          <iframe src={localFileUrl(file.path)} title={file.path} />
        </div>
      )}
    </div>
  );
}

function ToolMessage({ msg }: { msg: Message }): React.JSX.Element {
  const filePreview = extractFilePreview(msg);
  const fileArtifact = filePreview ? null : extractFileArtifact(msg);
  const toolCalls = parseJsonRecord(msg.tool_calls);
  const title =
    msg.tool_name === "terminal"
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

  if (msg.tool_name === "terminal") {
    return (
      <details className="tool-activity-card" open>
        <summary>{title}</summary>
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
      </details>
    );
  }

  return (
    <details className="tool-activity-card" open>
      <summary>{title}</summary>
      <div className="generic-tool-visualizer">
        <div className="tool-header">Tool: {msg.tool_name || "result"}</div>
        {filePreview ? (
          <ToolFilePreview file={filePreview} />
        ) : fileArtifact ? (
          <ToolFileArtifact file={fileArtifact} />
        ) : (
          <pre>
            <code>{prettyJson(msg.content)}</code>
          </pre>
        )}
      </div>
    </details>
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
