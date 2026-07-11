import type { Message } from "./Messages";

export interface ChatAreaProps {
  conversationId?: string;
  currentSession: string | null;
  onNewSession?: () => void;
  onSessionChange?: (sessionId: string | null) => void;
  profile?: string;
  assistantLabel?: string;
  activeProject?: string | null;
  isAudible?: boolean;
  acceptsDesktopBuddyInput?: boolean;
}

export interface ActiveRequest {
  id: string;
  sessionId: string | null;
  displaySessionId: string | null;
  localKey: string;
  response: string;
  createdAt: number;
  kind: "foreground" | "background";
}

export interface QueuedChatTurn {
  id: string;
  text: string;
  mode: "queue" | "steer";
  messageId: string;
  createdAt: number;
}

export interface DroppedAttachment {
  fileUrl?: string;
  kind?:
    | "text"
    | "markdown"
    | "image"
    | "pdf"
    | "office"
    | "directory"
    | "binary"
    | "missing";
  name: string;
  path: string;
  size?: number;
}

export type ChatToolProgressPayload =
  | string
  | {
      tool?: string;
      name?: string;
      label?: string;
      preview?: string;
      status?: string;
      toolCallId?: string;
      duration?: number;
      error?: boolean;
    };

export interface NormalizedToolProgress {
  idPart: string;
  tool: string;
  label: string;
  status: "running" | "completed" | "error" | "reasoning";
  preview?: string;
  duration?: number;
  error?: boolean;
}

export type ChatBusyCommand = {
  command: "queue" | "steer" | "background" | null;
  payload: string;
};

export type ChatMessageList = Message[];
