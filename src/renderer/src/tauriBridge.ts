import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type Callback = (...args: unknown[]) => void;

const localListeners = new Map<string, Set<Callback>>();

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

const emitLocal = (event: string, ...args: unknown[]): void => {
  localListeners.get(event)?.forEach((callback) => callback(...args));
};

const onEvent = <T>(
  event: string,
  callback: (payload: T) => void,
): (() => void) => {
  const localCallback: Callback = (payload) => callback(payload as T);
  const listeners = localListeners.get(event) ?? new Set<Callback>();
  listeners.add(localCallback);
  localListeners.set(event, listeners);

  let tauriUnlisten: UnlistenFn | null = null;
  if (isTauriRuntime()) {
    listen<T>(event, ({ payload }) => callback(payload))
      .then((unlisten) => {
        tauriUnlisten = unlisten;
      })
      .catch(() => undefined);
  }

  return () => {
    listeners.delete(localCallback);
    tauriUnlisten?.();
  };
};

const fallbackNotice = (command: string): string =>
  `Tauri command "${command}" has not been ported yet. Use the Electron build for this feature while the native shell is being migrated.`;

const call = async <T>(
  command: string,
  args: Record<string, unknown> = {},
  fallback: T,
): Promise<T> => {
  if (!isTauriRuntime()) return fallback;

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.warn(`[tauriBridge] ${command} failed`, error);
    return fallback;
  }
};

export const installTauriBridge = (): void => {
  if (!isTauriRuntime() || window.hermesAPI) return;

  window.electron = {
    process: {
      platform: navigator.userAgent.includes("Mac")
        ? "darwin"
        : navigator.platform,
      versions: {},
    },
  } as typeof window.electron;

  window.hermesAPI = {
    checkInstall: () =>
      call(
        "check_install",
        {},
        {
          installed: false,
          configured: false,
          hasApiKey: false,
          verified: false,
        },
      ),
    startInstall: () =>
      call(
        "start_install",
        {},
        {
          success: false,
          error: fallbackNotice("start_install"),
        },
      ),
    onInstallProgress: (callback) => onEvent("install-progress", callback),

    getHermesVersion: () => call("get_hermes_version", {}, null),
    refreshHermesVersion: () => call("get_hermes_version", {}, null),
    runHermesDoctor: () =>
      call("run_hermes_doctor", {}, fallbackNotice("run_hermes_doctor")),
    runHermesUpdate: () =>
      call(
        "run_hermes_update",
        {},
        {
          success: false,
          error: fallbackNotice("run_hermes_update"),
        },
      ),
    runHermesUpdateCheck: () =>
      call(
        "run_hermes_update_check",
        {},
        {
          success: false,
          updateAvailable: false,
          output: "",
          error: fallbackNotice("run_hermes_update_check"),
        },
      ),
    runSafeHermesUpgrade: (profile) =>
      call(
        "run_safe_hermes_upgrade",
        { profile },
        {
          success: false,
          error: fallbackNotice("run_safe_hermes_upgrade"),
        },
      ),
    getHermesCapabilities: (profile) =>
      call(
        "get_hermes_capabilities",
        { profile },
        {
          version: null,
          semver: null,
          isAtLeastV12: false,
          updateAvailable: false,
          api: {
            ok: false,
            status: null,
            url: "http://127.0.0.1:8642",
            error: fallbackNotice("get_hermes_capabilities"),
            features: {},
            endpoints: {},
            models: [],
          },
          toolGateway: {
            present: false,
            available: false,
            reason: fallbackNotice("get_hermes_capabilities"),
            managedTools: [],
          },
          supports: {
            chatCompletions: false,
            responses: false,
            runs: false,
            runEvents: false,
            runStop: false,
            toolProgress: false,
            sessionContinuity: false,
            curator: false,
          },
        },
      ),

    checkOpenClaw: () =>
      call("check_open_claw", {}, { found: false, path: null }),
    runClawMigrate: () =>
      call(
        "run_claw_migrate",
        {},
        {
          success: false,
          error: fallbackNotice("run_claw_migrate"),
        },
      ),

    getLocale: () => call("get_locale", {}, "en"),
    setLocale: (locale) => call("set_locale", { locale }, locale),

    getEnv: (profile) => call("get_env", { profile }, {}),
    setEnv: (key, value, profile) =>
      call("set_env", { key, value, profile }, false),
    getConfig: (key, profile) => call("get_config", { key, profile }, null),
    setConfig: (key, value, profile) =>
      call("set_config", { key, value, profile }, false),
    getHermesHome: (profile) => call("get_hermes_home", { profile }, ""),
    getModelConfig: (profile) =>
      call(
        "get_model_config",
        { profile },
        {
          provider: "openai",
          model: "gpt-4.1-mini",
          baseUrl: "",
        },
      ),
    setModelConfig: (provider, model, baseUrl, profile) =>
      call("set_model_config", { provider, model, baseUrl, profile }, false),

    isRemoteMode: () => call("is_remote_mode", {}, false),
    getConnectionConfig: () =>
      call(
        "get_connection_config",
        {},
        {
          mode: "local",
          remoteUrl: "",
          apiKey: "",
        },
      ),
    setConnectionConfig: (mode, remoteUrl, apiKey) =>
      call("set_connection_config", { mode, remoteUrl, apiKey }, false),
    testRemoteConnection: (url, apiKey) =>
      call("test_remote_connection", { url, apiKey }, false),
    getHermesHealth: (profile) =>
      call(
        "get_hermes_health",
        { profile },
        {
          install: {
            installed: false,
            configured: false,
            hasApiKey: false,
            verified: false,
          },
          connection: {
            mode: "local",
            remoteUrl: "",
            hasRemoteApiKey: false,
          },
          gateway: {
            running: false,
            apiUrl: "http://127.0.0.1:8642",
            apiOk: false,
            apiStatus: null,
            apiError: "Tauri health command not ported yet",
            hasApiServerKey: false,
          },
          model: {
            provider: "openai",
            model: "gpt-4.1-mini",
            baseUrl: "",
          },
          env: {
            hasMiniMaxKey: false,
            hasMiniMaxCnKey: false,
            hasOpenAIKey: false,
            hasXaiKey: false,
            hasDashScopeKey: false,
          },
          credentialProviders: [],
        },
      ),

    sendMessage: async (
      message,
      profile,
      resumeSessionId,
      history,
      activeProject,
      requestId,
    ) => {
      const response = await call<
        string | { response: string; sessionId?: string }
      >(
        "send_message",
        {
          message,
          profile,
          resumeSessionId,
          history,
          activeProject,
          requestId,
        },
        fallbackNotice("send_message"),
      );
      if (response === fallbackNotice("send_message")) {
        emitLocal("chat-error", response, requestId);
      }
      if (typeof response === "object") {
        return response;
      }
      return { response };
    },
    abortChat: (requestId) => call("abort_chat", { requestId }, undefined),
    openLocalPath: (path) => call("open_local_path", { path }, false),
    revealLocalPath: (path) => call("reveal_local_path", { path }, false),
    readDocumentPreview: (path) =>
      call(
        "read_document_preview",
        { path },
        {
          path,
          name: path.split("/").pop() || path,
          exists: false,
          kind: "missing",
          size: 0,
          error: fallbackNotice("read_document_preview"),
        },
      ),
    watchWorkspace: (path) => call("watch_workspace", { path }, false),
    unwatchWorkspace: () => call("unwatch_workspace", {}, false),
    onWorkspaceFileChanged: (callback) =>
      onEvent("workspace-file-changed", callback),
    onChatChunk: (callback) => onEvent("chat-chunk", callback),
    onChatDone: (callback) => onEvent("chat-done", callback),
    onChatToolProgress: (callback) => onEvent("chat-tool-progress", callback),
    onChatUsage: (callback) => onEvent("chat-usage", callback),
    onChatError: (callback) => onEvent("chat-error", callback),

    startGateway: () => call("start_gateway", {}, false),
    stopGateway: () => call("stop_gateway", {}, false),
    gatewayStatus: () => call("gateway_status", {}, false),
    getPlatformEnabled: (profile) =>
      call("get_platform_enabled", { profile }, {}),
    setPlatformEnabled: (platform, enabled, profile) =>
      call("set_platform_enabled", { platform, enabled, profile }, false),

    listSessions: (limit, offset) =>
      call("list_sessions", { limit, offset }, []),
    getSessionMessages: (sessionId) =>
      call("get_session_messages", { sessionId }, []),

    listProfiles: () => call("list_profiles", {}, []),
    createProfile: (name, clone) =>
      call(
        "create_profile",
        { name, clone },
        {
          success: false,
          error: fallbackNotice("create_profile"),
        },
      ),
    deleteProfile: (name) =>
      call(
        "delete_profile",
        { name },
        {
          success: false,
          error: fallbackNotice("delete_profile"),
        },
      ),
    setActiveProfile: (name) => call("set_active_profile", { name }, false),

    selectProjectDirectory: () => call("select_project_directory", {}, null),
    readDirectory: (dirPath) => call("read_directory", { dirPath }, []),
    getObsidianVault: () =>
      call(
        "get_obsidian_vault",
        {},
        {
          path: null,
          name: "Obsidian Vault",
          exists: false,
          noteCount: 0,
          totalFiles: 0,
        },
      ),
    setObsidianVault: (path) =>
      call(
        "set_obsidian_vault",
        { path },
        {
          path: null,
          name: "Obsidian Vault",
          exists: false,
          noteCount: 0,
          totalFiles: 0,
        },
      ),

    readMemory: (profile) =>
      call(
        "read_memory",
        { profile },
        {
          memory: { content: "", exists: false, lastModified: null },
          user: { content: "", exists: false, lastModified: null },
          stats: { totalSessions: 0, totalMessages: 0 },
        },
      ),
    addMemoryEntry: (content, profile) =>
      call(
        "add_memory_entry",
        { content, profile },
        {
          success: false,
          error: fallbackNotice("add_memory_entry"),
        },
      ),
    updateMemoryEntry: (index, content, profile) =>
      call(
        "update_memory_entry",
        { index, content, profile },
        {
          success: false,
          error: fallbackNotice("update_memory_entry"),
        },
      ),
    removeMemoryEntry: (index, profile) =>
      call("remove_memory_entry", { index, profile }, false),
    writeUserProfile: (content, profile) =>
      call(
        "write_user_profile",
        { content, profile },
        {
          success: false,
          error: fallbackNotice("write_user_profile"),
        },
      ),

    readSoul: (profile) => call("read_soul", { profile }, ""),
    writeSoul: (content, profile) =>
      call("write_soul", { content, profile }, false),
    resetSoul: (profile) => call("reset_soul", { profile }, ""),

    getToolsets: (profile) => call("get_toolsets", { profile }, []),
    setToolsetEnabled: (key, enabled, profile) =>
      call("set_toolset_enabled", { key, enabled, profile }, false),
    listInstalledSkills: (profile) =>
      call("list_installed_skills", { profile }, []),
    listBundledSkills: () => call("list_bundled_skills", {}, []),
    getSkillContent: (skillPath) =>
      call("get_skill_content", { skillPath }, ""),
    installSkill: (identifier, profile) =>
      call(
        "install_skill",
        { identifier, profile },
        {
          success: false,
          error: fallbackNotice("install_skill"),
        },
      ),
    uninstallSkill: (name, profile) =>
      call(
        "uninstall_skill",
        { name, profile },
        {
          success: false,
          error: fallbackNotice("uninstall_skill"),
        },
      ),

    listCachedSessions: (limit, offset) =>
      call("list_cached_sessions", { limit, offset }, []),
    syncSessionCache: () => call("sync_session_cache", {}, []),
    updateSessionTitle: (sessionId, title) =>
      call("update_session_title", { sessionId, title }, undefined),
    searchSessions: (query, limit) =>
      call("search_sessions", { query, limit }, []),

    getCredentialPool: () => call("get_credential_pool", {}, {}),
    setCredentialPool: (provider, entries) =>
      call("set_credential_pool", { provider, entries }, false),
    listModels: () => call("list_models", {}, []),
    listModelCatalog: () => call("list_model_catalog", {}, []),
    addModel: (name, provider, model, baseUrl) =>
      call(
        "add_model",
        { name, provider, model, baseUrl },
        {
          id: "",
          name,
          provider,
          model,
          baseUrl,
          createdAt: Date.now(),
        },
      ),
    removeModel: (id) => call("remove_model", { id }, false),
    updateModel: (id, fields) => call("update_model", { id, fields }, false),

    claw3dStatus: () =>
      call(
        "claw3d_status",
        {},
        {
          cloned: false,
          installed: false,
          devServerRunning: false,
          adapterRunning: false,
          port: 5174,
          portInUse: false,
          wsUrl: "",
          running: false,
          error: fallbackNotice("claw3d_status"),
        },
      ),
    claw3dSetup: () =>
      call(
        "claw3d_setup",
        {},
        {
          success: false,
          error: fallbackNotice("claw3d_setup"),
        },
      ),
    onClaw3dSetupProgress: (callback) =>
      onEvent("claw3d-setup-progress", callback),
    claw3dGetPort: () => call("claw3d_get_port", {}, 5174),
    claw3dSetPort: (port) => call("claw3d_set_port", { port }, false),
    claw3dGetWsUrl: () => call("claw3d_get_ws_url", {}, ""),
    claw3dSetWsUrl: (url) => call("claw3d_set_ws_url", { url }, false),
    claw3dStartAll: () =>
      call(
        "claw3d_start_all",
        {},
        {
          success: false,
          error: fallbackNotice("claw3d_start_all"),
        },
      ),
    claw3dStopAll: () => call("claw3d_stop_all", {}, false),
    claw3dGetLogs: () => call("claw3d_get_logs", {}, ""),
    claw3dStartDev: () => call("claw3d_start_dev", {}, false),
    claw3dStopDev: () => call("claw3d_stop_dev", {}, false),
    claw3dStartAdapter: () => call("claw3d_start_adapter", {}, false),
    claw3dStopAdapter: () => call("claw3d_stop_adapter", {}, false),

    checkForUpdates: () => call("check_for_updates", {}, null),
    downloadUpdate: () => call("download_update", {}, false),
    installUpdate: () => call("install_update", {}, undefined),
    getAppVersion: () => call("get_app_version", {}, "0.8.0-tauri"),
    onUpdateAvailable: (callback) => onEvent("update-available", callback),
    onUpdateDownloadProgress: (callback) =>
      onEvent("update-download-progress", callback),
    onUpdateDownloaded: (callback) => onEvent("update-downloaded", callback),
    onMenuNewChat: (callback) => onEvent("menu-new-chat", callback),
    onMenuSearchSessions: (callback) =>
      onEvent("menu-search-sessions", callback),

    listCronJobs: (includeDisabled, profile) =>
      call("list_cron_jobs", { includeDisabled, profile }, []),
    createCronJob: (schedule, prompt, name, deliver, profile) =>
      call(
        "create_cron_job",
        { schedule, prompt, name, deliver, profile },
        {
          success: false,
          error: fallbackNotice("create_cron_job"),
        },
      ),
    removeCronJob: (jobId, profile) =>
      call(
        "remove_cron_job",
        { jobId, profile },
        {
          success: false,
          error: fallbackNotice("remove_cron_job"),
        },
      ),
    pauseCronJob: (jobId, profile) =>
      call(
        "pause_cron_job",
        { jobId, profile },
        {
          success: false,
          error: fallbackNotice("pause_cron_job"),
        },
      ),
    resumeCronJob: (jobId, profile) =>
      call(
        "resume_cron_job",
        { jobId, profile },
        {
          success: false,
          error: fallbackNotice("resume_cron_job"),
        },
      ),
    triggerCronJob: (jobId, profile) =>
      call(
        "trigger_cron_job",
        { jobId, profile },
        {
          success: false,
          error: fallbackNotice("trigger_cron_job"),
        },
      ),

    openExternal: (url) => call("open_external", { url }, undefined),
    runHermesBackup: (profile) =>
      call(
        "run_hermes_backup",
        { profile },
        {
          success: false,
          error: fallbackNotice("run_hermes_backup"),
        },
      ),
    runHermesImport: (archivePath, profile) =>
      call(
        "run_hermes_import",
        { archivePath, profile },
        {
          success: false,
          error: fallbackNotice("run_hermes_import"),
        },
      ),
    runHermesDump: () =>
      call("run_hermes_dump", {}, fallbackNotice("run_hermes_dump")),
    runHermesCurator: (action, skill, profile) =>
      call(
        "run_hermes_curator",
        { action, skill, profile },
        {
          success: false,
          supported: false,
          output: "",
          error: fallbackNotice("run_hermes_curator"),
          pinned: [],
          report: {
            reportPath: null,
            report: "",
            runJsonPath: null,
            runJson: null,
          },
        },
      ),
    readCuratorReport: (profile) =>
      call(
        "read_curator_report",
        { profile },
        {
          reportPath: null,
          report: "",
          runJsonPath: null,
          runJson: null,
        },
      ),
    startHermesRun: (input, profile, options) =>
      call(
        "start_hermes_run",
        { input, profile, options },
        {
          success: false,
          error: fallbackNotice("start_hermes_run"),
        },
      ),
    getHermesRun: (runId, profile) =>
      call(
        "get_hermes_run",
        { runId, profile },
        {
          success: false,
          error: fallbackNotice("get_hermes_run"),
        },
      ),
    stopHermesRun: (runId, profile) =>
      call(
        "stop_hermes_run",
        { runId, profile },
        {
          success: false,
          error: fallbackNotice("stop_hermes_run"),
        },
      ),
    discoverMemoryProviders: (profile) =>
      call("discover_memory_providers", { profile }, []),
    listMcpServers: (profile) => call("list_mcp_servers", { profile }, []),
    readLogs: (logFile, lines) =>
      call("read_logs", { logFile, lines }, { content: "", path: "" }),
    copyFileToWorkspace: (sourcePath) =>
      call("copy_file_to_workspace", { sourcePath }, null),
    startBrowser: () => call("start_browser", {}, undefined),
    stopBrowser: () => call("stop_browser", {}, undefined),
    navigateBrowser: (url) => call("navigate_browser", { url }, undefined),
    getBrowserState: () => call("get_browser_state", {}, null),
    onPlaywrightNavigated: (callback) =>
      onEvent("playwright-navigated", callback),
    transcribeAudio: () => Promise.resolve(""),
    ttsSpeak: () => Promise.resolve(""),
  };
};
