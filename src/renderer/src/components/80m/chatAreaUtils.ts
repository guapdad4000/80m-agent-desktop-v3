import type { Message } from "./Messages";
import type {
  ActiveRequest,
  ChatBusyCommand,
  ChatToolProgressPayload,
  DroppedAttachment,
  NormalizedToolProgress,
} from "./chatAreaTypes";

export function localFileUrl(filePath: string): string {
  return `file://${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types || []).includes("Files");
}

export function fileUriToPath(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return "";
    return decodeURIComponent(parsed.pathname);
  } catch {
    return "";
  }
}

export function pathBasename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

export function buildAttachmentDraft(attachments: DroppedAttachment[]): string {
  const label = attachments.length === 1 ? "Attached file" : "Attached files";
  const files = attachments
    .map((attachment) => `- ${attachment.name}: ${attachment.path}`)
    .join("\n");
  return `[${label}]\n${files}\n\nUse the file paths above when you need to inspect the dropped content.`;
}

export function plainSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*#_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function messageSignature(msg: Message): string {
  return [
    msg.role,
    msg.content,
    msg.tool_name || "",
    msg.tool_calls || "",
  ].join("\u001f");
}

function messageSortValue(msg: Message, fallbackIndex: number): number {
  return Number.isFinite(msg.createdAt) ? Number(msg.createdAt) : fallbackIndex;
}

function chronologicalMessages(messages: Message[]): Message[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const byCreatedAt =
        messageSortValue(a.message, a.index) -
        messageSortValue(b.message, b.index);
      return byCreatedAt || a.index - b.index;
    })
    .map(({ message }) => message);
}

export function mergeMessages(base: Message[], overlay: Message[]): Message[] {
  const seen = new Set(base.map(messageSignature));
  const merged = [...base];
  for (const msg of overlay) {
    const byId = merged.findIndex((item) => item.id === msg.id);
    if (byId >= 0) {
      merged[byId] = { ...merged[byId], ...msg };
      seen.add(messageSignature(merged[byId]));
      continue;
    }
    const signature = messageSignature(msg);
    if (seen.has(signature)) continue;
    seen.add(signature);
    merged.push(msg);
  }
  return chronologicalMessages(merged);
}

export function upsertMessage(messages: Message[], msg: Message): Message[] {
  const index = messages.findIndex((item) => item.id === msg.id);
  if (index < 0) return [...messages, msg];
  return [
    ...messages.slice(0, index),
    { ...messages[index], ...msg },
    ...messages.slice(index + 1),
  ];
}

export function normalizeToolProgress(
  payload: ChatToolProgressPayload,
): NormalizedToolProgress {
  if (typeof payload === "string") {
    const label = payload.trim() || "Tool activity";
    const completed = /\bcomplete(?:d)?\b/i.test(label);
    const tool = label.replace(/\s+complete(?:d)?$/i, "").trim() || label;
    return {
      idPart: `${tool}-${completed ? "completed" : "running"}`,
      tool,
      label,
      status: completed ? "completed" : "running",
    };
  }

  const tool = (payload.tool || payload.name || "").trim();
  const label = (
    payload.label ||
    payload.preview ||
    tool ||
    "Tool activity"
  ).trim();
  const rawStatus = (payload.status || "").toLowerCase();
  const status =
    payload.error || rawStatus === "error"
      ? "error"
      : rawStatus === "completed" || rawStatus === "complete"
        ? "completed"
        : rawStatus === "reasoning"
          ? "reasoning"
          : "running";

  return {
    idPart: payload.toolCallId || `${tool || label}-${status}`,
    tool: tool || label,
    label,
    status,
    preview: payload.preview,
    duration: payload.duration,
    error: payload.error,
  };
}

export function makeAssistantMessage(req: ActiveRequest): Message | null {
  if (!req.response) return null;
  return {
    id: `assistant-${req.id}`,
    role: "assistant",
    content: req.response,
    createdAt: req.createdAt + 1,
  };
}

export function requestDisplaySession(req: ActiveRequest): string | null {
  return req.displaySessionId ?? req.sessionId;
}

export function parseBusyCommand(text: string): ChatBusyCommand {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/(queue|q|steer|background|bg|btw)\b\s*/i);
  if (!match) return { command: null, payload: trimmed };
  const raw = match[1].toLowerCase();
  const command =
    raw === "q"
      ? "queue"
      : raw === "bg" || raw === "btw"
        ? "background"
        : (raw as "queue" | "steer" | "background");
  return { command, payload: trimmed.slice(match[0].length).trim() };
}

export function buildSteerTurnPrompt(text: string): string {
  return [
    "[Steering note sent while the previous run was active]",
    text,
    "",
    "Use this to adjust the work in the current conversation and continue from the latest state.",
  ].join("\n");
}

export function makeToolProgressMessage(
  req: ActiveRequest,
  payload: ChatToolProgressPayload,
): Message {
  const progress = normalizeToolProgress(payload);
  const content = {
    status: progress.status,
    tool: progress.tool,
    label: progress.label,
    preview: progress.preview,
    duration: progress.duration,
    error: progress.error,
  };

  return {
    id: `tool-progress-${req.id}-${progress.idPart}`,
    role: "tool",
    content: JSON.stringify(content),
    createdAt: Date.now(),
    tool_name: progress.tool,
    tool_calls: JSON.stringify({
      status: progress.status,
      preview: progress.label,
      duration: progress.duration,
      error: progress.error,
    }),
  };
}
