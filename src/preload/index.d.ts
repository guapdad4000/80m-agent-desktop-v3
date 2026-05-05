import { ElectronAPI } from "@electron-toolkit/preload";

interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
}

interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

interface HermesHealth {
  install: InstallStatus;
  connection: {
    mode: "local" | "remote";
    remoteUrl: string;
    hasRemoteApiKey: boolean;
  };
  gateway: {
    running: boolean;
    apiUrl: string;
    apiOk: boolean;
    apiStatus: number | null;
    apiError: string;
    hasApiServerKey: boolean;
  };
  model: {
    provider: string;
    model: string;
    baseUrl: string;
  };
  env: {
    hasMiniMaxKey: boolean;
    hasMiniMaxCnKey: boolean;
    hasOpenAIKey: boolean;
    hasXaiKey: boolean;
    hasDashScopeKey: boolean;
  };
  credentialProviders: Array<{ provider: string; count: number }>;
}

interface HermesCapabilities {
  version: string | null;
  semver: string | null;
  isAtLeastV12: boolean;
  updateAvailable: boolean;
  api: {
    ok: boolean;
    status: number | null;
    url: string;
    error?: string;
    features: Record<string, boolean>;
    endpoints: Record<string, { method?: string; path?: string }>;
    models: string[];
  };
  toolGateway: {
    present: boolean;
    available: boolean;
    reason: string;
    managedTools: string[];
  };
  supports: {
    chatCompletions: boolean;
    responses: boolean;
    runs: boolean;
    runEvents: boolean;
    runStop: boolean;
    toolProgress: boolean;
    sessionContinuity: boolean;
    curator: boolean;
  };
}

interface CuratorCommandResult {
  success: boolean;
  supported: boolean;
  output: string;
  error?: string;
  pinned: string[];
  report: {
    reportPath: string | null;
    report: string;
    runJsonPath: string | null;
    runJson: unknown | null;
  };
}

interface HermesRunResult {
  success: boolean;
  runId?: string;
  status?: string;
  sessionId?: string;
  output?: string;
  usage?: unknown;
  error?: string;
  raw?: unknown;
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

interface AppNotificationPayload {
  title: string;
  body?: string;
  tone?: "info" | "success" | "warning" | "error";
  createdAt?: number;
}

interface HermesAPI {
  // Installation
  checkInstall: () => Promise<InstallStatus>;
  startInstall: () => Promise<{ success: boolean; error?: string }>;
  onInstallProgress: (
    callback: (progress: InstallProgress) => void,
  ) => () => void;

  // Hermes engine info
  getHermesVersion: () => Promise<string | null>;
  refreshHermesVersion: () => Promise<string | null>;
  runHermesDoctor: () => Promise<string>;
  runHermesUpdate: () => Promise<{ success: boolean; error?: string }>;
  runHermesUpdateCheck: () => Promise<{
    success: boolean;
    updateAvailable: boolean;
    output: string;
    error?: string;
  }>;
  runSafeHermesUpgrade: (profile?: string) => Promise<{
    success: boolean;
    backupPath?: string;
    updateAvailable?: boolean;
    checkOutput?: string;
    error?: string;
  }>;
  getHermesCapabilities: (profile?: string) => Promise<HermesCapabilities>;

  // OpenClaw migration
  checkOpenClaw: () => Promise<{ found: boolean; path: string | null }>;
  runClawMigrate: () => Promise<{ success: boolean; error?: string }>;

  getLocale: () => Promise<"en" | "zh-CN">;
  setLocale: (locale: "en" | "zh-CN") => Promise<"en" | "zh-CN">;

  // Configuration (profile-aware)
  getEnv: (profile?: string) => Promise<Record<string, string>>;
  setEnv: (key: string, value: string, profile?: string) => Promise<boolean>;
  getConfig: (key: string, profile?: string) => Promise<string | null>;
  setConfig: (key: string, value: string, profile?: string) => Promise<boolean>;
  getHermesHome: (profile?: string) => Promise<string>;
  getModelConfig: (
    profile?: string,
  ) => Promise<{ provider: string; model: string; baseUrl: string }>;
  setModelConfig: (
    provider: string,
    model: string,
    baseUrl: string,
    profile?: string,
  ) => Promise<boolean>;

  // Connection mode (local vs remote)
  isRemoteMode: () => Promise<boolean>;
  getConnectionConfig: () => Promise<{
    mode: "local" | "remote";
    remoteUrl: string;
    apiKey: string;
  }>;
  setConnectionConfig: (
    mode: "local" | "remote",
    remoteUrl: string,
    apiKey?: string,
  ) => Promise<boolean>;
  testRemoteConnection: (url: string, apiKey?: string) => Promise<boolean>;
  getHermesHealth: (profile?: string) => Promise<HermesHealth>;

  // Chat
  sendMessage: (
    message: string,
    profile?: string,
    resumeSessionId?: string,
    history?: Array<{ role: string; content: string }>,
    activeProject?: string | null,
    requestId?: string,
  ) => Promise<{ response: string; sessionId?: string }>;
  abortChat: (requestId?: string) => Promise<void>;
  openLocalPath: (path: string) => Promise<boolean>;
  revealLocalPath: (path: string) => Promise<boolean>;
  readDocumentPreview: (path: string) => Promise<{
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
  }>;
  writeDocumentContent: (
    path: string,
    content: string,
  ) => Promise<{ success: boolean; error?: string; path?: string }>;
  watchWorkspace: (path: string) => Promise<boolean>;
  unwatchWorkspace: () => Promise<boolean>;
  onWorkspaceFileChanged: (
    callback: (change: WorkspaceFileChange) => void,
  ) => () => void;
  onChatChunk: (
    callback: (chunk: string, requestId?: string) => void,
  ) => () => void;
  onChatDone: (
    callback: (sessionId?: string, requestId?: string) => void,
  ) => () => void;
  onChatToolProgress: (
    callback: (tool: string, requestId?: string) => void,
  ) => () => void;
  onChatUsage: (
    callback: (usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cost?: number;
      rateLimitRemaining?: number;
      rateLimitReset?: number;
    }) => void,
  ) => () => void;
  onChatError: (
    callback: (error: string, requestId?: string) => void,
  ) => () => void;

  // Gateway
  startGateway: () => Promise<boolean>;
  stopGateway: () => Promise<boolean>;
  gatewayStatus: () => Promise<boolean>;

  // Platform toggles
  getPlatformEnabled: (profile?: string) => Promise<Record<string, boolean>>;
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;

  // Sessions
  listSessions: (
    limit?: number,
    offset?: number,
  ) => Promise<
    Array<{
      id: string;
      source: string;
      startedAt: number;
      endedAt: number | null;
      messageCount: number;
      model: string;
      title: string | null;
      preview: string;
    }>
  >;
  getSessionMessages: (sessionId: string) => Promise<
    Array<{
      id: number;
      role: "user" | "assistant" | "tool";
      content: string;
      timestamp: number;
      tool_calls?: string;
      tool_name?: string;
    }>
  >;

  // Profiles
  listProfiles: () => Promise<
    Array<{
      name: string;
      path: string;
      isDefault: boolean;
      isActive: boolean;
      model: string;
      provider: string;
      hasEnv: boolean;
      hasSoul: boolean;
      skillCount: number;
      gatewayRunning: boolean;
    }>
  >;
  createProfile: (
    name: string,
    clone: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteProfile: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setActiveProfile: (name: string) => Promise<boolean>;

  // Projects Sidebar
  selectProjectDirectory: () => Promise<string | null>;
  readDirectory: (
    dirPath: string,
  ) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
  getObsidianVault: () => Promise<{
    path: string | null;
    name: string;
    exists: boolean;
    noteCount: number;
    totalFiles: number;
  }>;
  setObsidianVault: (path: string) => Promise<{
    path: string | null;
    name: string;
    exists: boolean;
    noteCount: number;
    totalFiles: number;
  }>;

  // Memory
  readMemory: (profile?: string) => Promise<{
    memory: { content: string; exists: boolean; lastModified: number | null };
    user: { content: string; exists: boolean; lastModified: number | null };
    stats: { totalSessions: number; totalMessages: number };
  }>;

  addMemoryEntry: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  updateMemoryEntry: (
    index: number,
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeMemoryEntry: (index: number, profile?: string) => Promise<boolean>;
  writeUserProfile: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Soul
  readSoul: (profile?: string) => Promise<string>;
  writeSoul: (content: string, profile?: string) => Promise<boolean>;
  resetSoul: (profile?: string) => Promise<string>;

  // Tools
  getToolsets: (
    profile?: string,
  ) => Promise<
    Array<{ key: string; label: string; description: string; enabled: boolean }>
  >;
  setToolsetEnabled: (
    key: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;

  // Skills
  listInstalledSkills: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; category: string; description: string; path: string }>
  >;
  listBundledSkills: () => Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
    }>
  >;
  getSkillContent: (skillPath: string) => Promise<string>;
  installSkill: (
    identifier: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  uninstallSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Session cache
  listCachedSessions: (
    limit?: number,
    offset?: number,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
    }>
  >;
  syncSessionCache: () => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
    }>
  >;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;

  // Session search
  searchSessions: (
    query: string,
    limit?: number,
  ) => Promise<
    Array<{
      sessionId: string;
      title: string | null;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      snippet: string;
    }>
  >;

  // Credential Pool
  getCredentialPool: () => Promise<
    Record<string, Array<Record<string, unknown>>>
  >;
  setCredentialPool: (
    provider: string,
    entries: Array<Record<string, unknown>>,
  ) => Promise<boolean>;

  // Models
  listModels: () => Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      createdAt: number;
    }>
  >;
  listModelCatalog: () => Promise<
    Array<{
      provider: string;
      model: string;
      name: string;
      description: string;
      baseUrl: string;
      source: "catalog" | "fallback";
    }>
  >;
  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
  ) => Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    createdAt: number;
  }>;
  removeModel: (id: string) => Promise<boolean>;
  updateModel: (id: string, fields: Record<string, string>) => Promise<boolean>;

  // Claw3D
  claw3dStatus: () => Promise<{
    cloned: boolean;
    installed: boolean;
    devServerRunning: boolean;
    adapterRunning: boolean;
    port: number;
    portInUse: boolean;
    wsUrl: string;
    running: boolean;
    error: string;
  }>;
  claw3dSetup: () => Promise<{ success: boolean; error?: string }>;
  onClaw3dSetupProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ) => () => void;
  claw3dGetPort: () => Promise<number>;
  claw3dSetPort: (port: number) => Promise<boolean>;
  claw3dGetWsUrl: () => Promise<string>;
  claw3dSetWsUrl: (url: string) => Promise<boolean>;
  claw3dStartAll: () => Promise<{ success: boolean; error?: string }>;
  claw3dStopAll: () => Promise<boolean>;
  claw3dGetLogs: () => Promise<string>;
  claw3dStartDev: () => Promise<boolean>;
  claw3dStopDev: () => Promise<boolean>;
  claw3dStartAdapter: () => Promise<boolean>;
  claw3dStopAdapter: () => Promise<boolean>;

  // Updates
  checkForUpdates: () => Promise<string | null>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes: string }) => void,
  ) => () => void;
  onUpdateDownloadProgress: (
    callback: (info: { percent: number }) => void,
  ) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;

  // Menu events
  onMenuNewChat: (callback: () => void) => () => void;
  onMenuSearchSessions: (callback: () => void) => () => void;

  // Cron Jobs
  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ) => Promise<
    Array<{
      id: string;
      name: string;
      schedule: string;
      prompt: string;
      state: "active" | "paused" | "completed";
      enabled: boolean;
      next_run_at: string | null;
      last_run_at: string | null;
      last_status: string | null;
      last_error: string | null;
      repeat: { times: number | null; completed: number } | null;
      deliver: string[];
      skills: string[];
      script: string | null;
      origin: string | null;
      model: string | null;
      provider: string | null;
      session_id: string | null;
      session_title: string | null;
    }>
  >;
  createCronJob: (
    schedule: string,
    prompt?: string,
    name?: string,
    deliver?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  pauseCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  resumeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  triggerCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Shell
  openExternal: (url: string) => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowToggleMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximized: (callback: (isMaximized: boolean) => void) => () => void;
  onAppNotification: (
    callback: (payload: AppNotificationPayload) => void,
  ) => () => void;

  // Backup / Import
  runHermesBackup: (
    profile?: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  runHermesImport: (
    archivePath: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Debug dump
  runHermesDump: () => Promise<string>;
  runHermesCurator: (
    action: string,
    skill?: string,
    profile?: string,
  ) => Promise<CuratorCommandResult>;
  readCuratorReport: (
    profile?: string,
  ) => Promise<CuratorCommandResult["report"]>;
  startHermesRun: (
    input: string,
    profile?: string,
    options?: {
      sessionId?: string;
      instructions?: string;
      previousResponseId?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
    },
  ) => Promise<HermesRunResult>;
  getHermesRun: (runId: string, profile?: string) => Promise<HermesRunResult>;
  stopHermesRun: (runId: string, profile?: string) => Promise<HermesRunResult>;

  // Memory providers
  discoverMemoryProviders: (profile?: string) => Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
      active: boolean;
      envVars: string[];
    }>
  >;

  // MCP servers
  listMcpServers: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; type: string; enabled: boolean; detail: string }>
  >;

  // Log viewer
  readLogs: (
    logFile?: string,
    lines?: number,
  ) => Promise<{ content: string; path: string }>;

  // Playwright browser control
  copyFileToWorkspace: (sourcePath: string) => Promise<string | null>;
  startBrowser: () => Promise<void>;
  stopBrowser: () => Promise<void>;
  navigateBrowser: (url: string) => Promise<void>;
  getBrowserState: () => Promise<{ url: string } | null>;
  onPlaywrightNavigated: (callback: (url: string) => void) => () => void;

  // Voice
  transcribeAudio: (audioData: number[], mimeType?: string) => Promise<string>;
  ttsSpeak: (text: string) => Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    hermesAPI: HermesAPI;
  }
}
