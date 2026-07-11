import { ipcRenderer, webUtils } from "electron";
import type { HermesAPI } from "./hermes-api.types";
import type {
  DesktopBuddyCursorPayload,
  CortexClipperInstallInfo,
  DesktopBuddyStatePayload,
  DesktopBuddyTranscriptPayload,
} from "./hermes-api-desktop.types";

export const hermesDesktopApi = {
  // Shell
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke("window-minimize"),
  windowToggleMaximize: (): Promise<boolean> =>
    ipcRenderer.invoke("window-toggle-maximize"),
  windowClose: (): Promise<void> => ipcRenderer.invoke("window-close"),
  windowIsMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke("window-is-maximized"),
  onWindowMaximized: (
    callback: (isMaximized: boolean) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      isMaximized: boolean,
    ): void => callback(isMaximized);
    ipcRenderer.on("window-maximized", handler);
    return () => ipcRenderer.removeListener("window-maximized", handler);
  },
  onAppNotification: (
    callback: (payload: {
      title: string;
      body?: string;
      tone?: "info" | "success" | "warning" | "error";
      createdAt?: number;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        title: string;
        body?: string;
        tone?: "info" | "success" | "warning" | "error";
        createdAt?: number;
      },
    ): void => callback(payload);
    ipcRenderer.on("app-notification", handler);
    return () => ipcRenderer.removeListener("app-notification", handler);
  },
  openDesktopBuddy: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop-buddy-open", profile),
  closeDesktopBuddy: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop-buddy-close"),
  toggleDesktopBuddy: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop-buddy-toggle", profile),
  setDesktopBuddyState: (payload: DesktopBuddyStatePayload): Promise<void> =>
    ipcRenderer.invoke("desktop-buddy-set-state", payload),
  focusDesktopBuddyMain: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop-buddy-focus-main"),
  getDesktopBuddyCursor: (): Promise<DesktopBuddyCursorPayload | null> =>
    ipcRenderer.invoke("desktop-buddy-cursor"),
  sendDesktopBuddyTranscript: (
    payload: DesktopBuddyTranscriptPayload,
  ): Promise<boolean> =>
    ipcRenderer.invoke("desktop-buddy-send-transcript", payload),
  onDesktopBuddyState: (
    callback: (payload: DesktopBuddyStatePayload) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopBuddyStatePayload,
    ): void => callback(payload);
    ipcRenderer.on("desktop-buddy-state", handler);
    return () => ipcRenderer.removeListener("desktop-buddy-state", handler);
  },
  onDesktopBuddyTranscript: (
    callback: (payload: DesktopBuddyTranscriptPayload) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopBuddyTranscriptPayload,
    ): void => callback(payload);
    ipcRenderer.on("desktop-buddy-transcript", handler);
    return () =>
      ipcRenderer.removeListener("desktop-buddy-transcript", handler);
  },
  getCortexClipperInstallInfo: (): Promise<CortexClipperInstallInfo> =>
    ipcRenderer.invoke("cortex-clipper-get-install-info"),
  openCortexClipperFolder: (): Promise<boolean> =>
    ipcRenderer.invoke("cortex-clipper-open-folder"),
  openChromeExtensionsPage: (): Promise<boolean> =>
    ipcRenderer.invoke("cortex-clipper-open-chrome-extensions"),

  // Backup / Import
  runHermesBackup: (
    profile?: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("run-hermes-backup", profile),

  runHermesImport: (
    archivePath: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("run-hermes-import", archivePath, profile),
  selectHermesImportArchive: (): Promise<string | null> =>
    ipcRenderer.invoke("select-hermes-import-archive"),

  // Debug dump
  runHermesDump: (): Promise<string> => ipcRenderer.invoke("run-hermes-dump"),
  runHermesCurator: (
    action: string,
    skill?: string,
    profile?: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke("run-hermes-curator", action, skill, profile),
  readCuratorReport: (profile?: string): Promise<unknown> =>
    ipcRenderer.invoke("read-curator-report", profile),
  startHermesRun: (
    input: string,
    profile?: string,
    options?: {
      sessionId?: string;
      instructions?: string;
      previousResponseId?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
    },
  ): Promise<unknown> =>
    ipcRenderer.invoke("start-hermes-run", input, profile, options),
  getHermesRun: (runId: string, profile?: string): Promise<unknown> =>
    ipcRenderer.invoke("get-hermes-run", runId, profile),
  stopHermesRun: (runId: string, profile?: string): Promise<unknown> =>
    ipcRenderer.invoke("stop-hermes-run", runId, profile),

  // Memory providers
  discoverMemoryProviders: (
    profile?: string,
  ): Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
      active: boolean;
      envVars: string[];
    }>
  > => ipcRenderer.invoke("discover-memory-providers", profile),

  // MCP servers
  listMcpServers: (
    profile?: string,
  ): Promise<
    Array<{ name: string; type: string; enabled: boolean; detail: string }>
  > => ipcRenderer.invoke("list-mcp-servers", profile),

  // Log viewer
  readLogs: (
    logFile?: string,
    lines?: number,
  ): Promise<{ content: string; path: string }> =>
    ipcRenderer.invoke("read-logs", logFile, lines),

  // File Sandbox
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  copyFileToWorkspace: (sourcePath: string): Promise<string | null> =>
    ipcRenderer.invoke("copy-file-to-workspace", sourcePath),

  // Playwright
  startBrowser: (): Promise<void> => ipcRenderer.invoke("start-browser"),
  stopBrowser: (): Promise<void> => ipcRenderer.invoke("stop-browser"),
  navigateBrowser: (url: string): Promise<void> =>
    ipcRenderer.invoke("navigate-browser", url),
  getBrowserState: (): Promise<{ url: string } | null> =>
    ipcRenderer.invoke("get-browser-state"),
  onPlaywrightNavigated: (callback: (url: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string): void =>
      callback(url);
    ipcRenderer.on("playwright-navigated", handler);
    return () => ipcRenderer.removeListener("playwright-navigated", handler);
  },
  openBrowserWindow: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("open-browser-window", url),

  // Voice
  transcribeAudio: (audioData: number[], mimeType?: string): Promise<string> =>
    ipcRenderer.invoke("transcribe-audio", audioData, mimeType),

  ttsSpeak: (text: string): Promise<string> =>
    ipcRenderer.invoke("tts-speak", text),
} as Partial<HermesAPI>;
