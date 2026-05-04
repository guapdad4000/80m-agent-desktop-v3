import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Download,
  RefreshCw,
  Upload,
  User,
  Wifi,
  WifiOff,
  Info,
  Sparkles,
} from "lucide-react";
import Animated80MLogo from "../Animated80MLogo";

interface Props {
  onBack: () => void;
  profile?: string;
}

type TabId =
  | "connection"
  | "health"
  | "curator"
  | "profiles"
  | "backup"
  | "about";

interface ModelPreset {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
}

type CredentialPool = Record<string, Array<Record<string, unknown>>>;

interface HermesHealth {
  install: {
    installed: boolean;
    configured: boolean;
    hasApiKey: boolean;
    verified: boolean;
  };
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
  env: Record<string, boolean>;
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

const NOUS_MODEL_PRESETS: Record<string, ModelPreset> = {
  minimax: {
    id: "nous-minimax",
    name: "MiniMax · Nous",
    provider: "nous",
    model: "minimax/minimax-m2.7",
    baseUrl: "",
  },
  openai: {
    id: "nous-openai",
    name: "OpenAI · Nous",
    provider: "nous",
    model: "openai/gpt-5.5",
    baseUrl: "",
  },
  xai: {
    id: "nous-xai",
    name: "xAI · Nous",
    provider: "nous",
    model: "x-ai/grok-4.20-beta",
    baseUrl: "",
  },
  qwen: {
    id: "nous-qwen",
    name: "Qwen · Nous",
    provider: "nous",
    model: "qwen/qwen3.5-plus-02-15",
    baseUrl: "",
  },
};

const PROVIDER_CHOICES = [
  "minimax-oauth",
  "minimax",
  "minimax-cn",
  "openai-codex",
  "openai",
  "xai",
  "qwen-oauth",
  "alibaba",
  "nous",
  "openrouter",
  "custom",
];

function hasEnv(env: Record<string, string>, key: string): boolean {
  return Boolean(env[key]?.trim());
}

function hasCredential(pool: CredentialPool, provider: string): boolean {
  return (pool[provider] || []).length > 0;
}

function modelConfigIssue(
  provider: string,
  model: string,
  baseUrl: string,
  env: Record<string, string>,
  pool: CredentialPool,
): string | null {
  if (!model.trim()) return "Choose a model before saving.";
  if (provider === "custom" && !baseUrl.trim()) {
    return "Custom providers need a base URL.";
  }
  if (provider === "minimax" && !hasEnv(env, "MINIMAX_API_KEY")) {
    return "MiniMax API mode needs MINIMAX_API_KEY saved in Hermes.";
  }
  if (provider === "minimax-cn" && !hasEnv(env, "MINIMAX_CN_API_KEY")) {
    return "MiniMax CN mode needs MINIMAX_CN_API_KEY saved in Hermes.";
  }
  if (provider === "minimax-oauth" && !hasCredential(pool, "minimax-oauth")) {
    return "MiniMax OAuth mode needs a saved MiniMax OAuth credential from hermes model.";
  }
  if (provider === "nous" && !hasCredential(pool, "nous")) {
    return "Nous Portal mode needs a saved Nous credential from hermes auth or hermes model.";
  }
  if (provider === "openai-codex" && !hasCredential(pool, "openai-codex")) {
    return "OpenAI Codex mode needs a saved Codex OAuth credential from hermes model.";
  }
  if (provider === "alibaba" && !hasEnv(env, "DASHSCOPE_API_KEY")) {
    return "Qwen DashScope mode needs DASHSCOPE_API_KEY saved in Hermes.";
  }
  return null;
}

function buildActiveModelPresets(
  env: Record<string, string>,
  credentialPool: CredentialPool,
): ModelPreset[] {
  const miniMaxPreset =
    hasEnv(env, "MINIMAX_API_KEY") || hasCredential(credentialPool, "minimax")
      ? {
          id: "minimax-api",
          name: "MiniMax · API Key",
          provider: "minimax",
          model: "MiniMax-M2.7",
          baseUrl: "",
        }
      : hasEnv(env, "MINIMAX_CN_API_KEY") ||
          hasCredential(credentialPool, "minimax-cn")
        ? {
            id: "minimax-cn-api",
            name: "MiniMax · CN Key",
            provider: "minimax-cn",
            model: "MiniMax-M2.7",
            baseUrl: "",
          }
        : hasCredential(credentialPool, "minimax-oauth")
          ? {
              id: "minimax-oauth-auth",
              name: "MiniMax · OAuth",
              provider: "minimax-oauth",
              model: "MiniMax-M2.7",
              baseUrl: "https://api.minimax.io/anthropic",
            }
          : NOUS_MODEL_PRESETS.minimax;

  return [
    miniMaxPreset,
    hasCredential(credentialPool, "openai-codex")
      ? {
          id: "openai-codex-auth",
          name: "OpenAI · Codex",
          provider: "openai-codex",
          model: "gpt-5.4",
          baseUrl: "",
        }
      : hasEnv(env, "OPENAI_API_KEY") || hasCredential(credentialPool, "openai")
        ? {
            id: "openai-api",
            name: "OpenAI · API Key",
            provider: "openai",
            model: "gpt-5.4",
            baseUrl: "",
          }
        : NOUS_MODEL_PRESETS.openai,
    hasEnv(env, "XAI_API_KEY") || hasCredential(credentialPool, "xai")
      ? {
          id: "xai-api",
          name: "xAI · API Key",
          provider: "xai",
          model: "grok-4-1-fast-reasoning",
          baseUrl: "",
        }
      : NOUS_MODEL_PRESETS.xai,
    hasCredential(credentialPool, "qwen-oauth")
      ? {
          id: "qwen-oauth-auth",
          name: "Qwen · Portal",
          provider: "qwen-oauth",
          model: "qwen3-coder-plus",
          baseUrl: "",
        }
      : hasEnv(env, "DASHSCOPE_API_KEY") ||
          hasCredential(credentialPool, "alibaba")
        ? {
            id: "qwen-dashscope",
            name: "Qwen · DashScope",
            provider: "alibaba",
            model: "qwen3.5-plus",
            baseUrl: "",
          }
        : NOUS_MODEL_PRESETS.qwen,
  ];
}

interface Profile {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: number;
}

const Settings80m: React.FC<Props> = ({ onBack, profile }) => {
  const [activeTab, setActiveTab] = useState<TabId>("connection");
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Connection
  const [connMode, setConnMode] = useState<"local" | "remote">("local");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Profiles
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);

  // Backup/Import
  const [backingUp, setBackingUp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupResult, setBackupResult] = useState("");
  const [importResult, setImportResult] = useState("");

  // About
  const [hermesVersion, setHermesVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [credentialPool, setCredentialPool] = useState<CredentialPool>({});
  const [health, setHealth] = useState<HermesHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<HermesCapabilities | null>(
    null,
  );
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState("");
  const [curator, setCurator] = useState<CuratorCommandResult | null>(null);
  const [curatorBusy, setCuratorBusy] = useState<string | null>(null);
  const [curatorSkill, setCuratorSkill] = useState("");
  const [curatorOutput, setCuratorOutput] = useState("");

  const activeModelPresets = buildActiveModelPresets(env, credentialPool);

  const refreshHealth = useCallback(async () => {
    if (!window.hermesAPI?.getHermesHealth) return;
    setHealthLoading(true);
    try {
      const next = (await window.hermesAPI.getHermesHealth(
        profile,
      )) as HermesHealth;
      setHealth(next);
    } finally {
      setHealthLoading(false);
    }
  }, [profile]);

  const refreshCapabilities = useCallback(async () => {
    if (!window.hermesAPI?.getHermesCapabilities) return;
    setCapabilitiesLoading(true);
    try {
      const next = (await window.hermesAPI.getHermesCapabilities(
        profile,
      )) as HermesCapabilities;
      setCapabilities(next);
    } finally {
      setCapabilitiesLoading(false);
    }
  }, [profile]);

  const runCuratorAction = useCallback(
    async (action: string, skill?: string) => {
      if (!window.hermesAPI?.runHermesCurator) return;
      setCuratorBusy(action);
      setCuratorOutput("");
      try {
        const result = (await window.hermesAPI.runHermesCurator(
          action,
          skill,
          profile,
        )) as CuratorCommandResult;
        setCurator(result);
        setCuratorOutput(result.output || result.error || "");
      } catch (err) {
        setCuratorOutput(err instanceof Error ? err.message : String(err));
      } finally {
        setCuratorBusy(null);
      }
    },
    [profile],
  );

  const handleSafeUpgrade = async () => {
    if (!window.hermesAPI?.runSafeHermesUpgrade) return;
    setUpgrading(true);
    setUpgradeResult("");
    try {
      const result = await window.hermesAPI.runSafeHermesUpgrade(profile);
      setUpgradeResult(
        result.success
          ? `Upgrade complete. Backup: ${result.backupPath || "created"}`
          : `Upgrade failed: ${result.error || "Unknown error"}`,
      );
      await Promise.all([refreshCapabilities(), refreshHealth()]);
    } catch (err) {
      setUpgradeResult(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  };

  useEffect(() => {
    if (window.hermesAPI) {
      // Load model config
      window.hermesAPI.getModelConfig?.(profile).then(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cfg: any) => {
          if (cfg) {
            setProvider(cfg.provider || "openrouter");
            setModel(cfg.model || "");
            setBaseUrl(cfg.baseUrl || "");
          }
          setLoading(false);
        },
        () => setLoading(false),
      );

      // Load connection config
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.hermesAPI.getConnectionConfig?.().then((conn: any) => {
        if (conn) {
          setConnMode(conn.mode || "local");
          setRemoteUrl(conn.remoteUrl || "");
          setApiKey(conn.apiKey || "");
        }
      });

      window.hermesAPI.getEnv?.(profile).then((values) => {
        setEnv(values || {});
      });

      window.hermesAPI.getCredentialPool?.().then((pool) => {
        setCredentialPool((pool || {}) as CredentialPool);
      });

      void refreshHealth();
      void refreshCapabilities();
      void runCuratorAction("status");

      // Load profiles - use raw response, map to our interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.hermesAPI.listProfiles?.().then((list: any[]) => {
        setProfiles(
          (list || []).map(
            (p: {
              id?: string;
              name: string;
              isActive?: boolean;
              path?: string;
            }) => ({
              id: p.id || p.path || String(Math.random()),
              name: p.name,
              isActive: p.isActive || false,
              createdAt: Date.now(),
            }),
          ),
        );
      });

      // Load versions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.hermesAPI.getHermesVersion?.().then((v: any) => {
        setHermesVersion(v || null);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.hermesAPI.getAppVersion?.().then((v: any) => {
        setAppVersion(v || "");
      });
    } else {
      setLoading(false);
    }
  }, [profile, refreshHealth, refreshCapabilities, runCuratorAction]);

  const handleSave = async () => {
    if (window.hermesAPI) {
      try {
        const issue = modelConfigIssue(
          provider,
          model,
          baseUrl,
          env,
          credentialPool,
        );
        if (issue) {
          setModelError(issue);
          return;
        }
        setModelError(null);
        await window.hermesAPI.setModelConfig(
          provider,
          model,
          baseUrl,
          profile,
        );
        await window.hermesAPI.setConnectionConfig(connMode, remoteUrl, apiKey);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (_) {}
    }
  };

  const handleQuickModelSelect = async (m: {
    provider: string;
    model: string;
    baseUrl: string;
  }) => {
    setProvider(m.provider);
    setModel(m.model);
    setBaseUrl(m.baseUrl || "");
    if (window.hermesAPI) {
      try {
        const issue = modelConfigIssue(
          m.provider,
          m.model,
          m.baseUrl || "",
          env,
          credentialPool,
        );
        if (issue) {
          setModelError(issue);
          return;
        }
        setModelError(null);
        await window.hermesAPI.setModelConfig(
          m.provider,
          m.model,
          m.baseUrl || "",
          profile,
        );
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (_) {}
    }
  };

  const handleCreateProfile = async () => {
    if (!profileName.trim()) return;
    setCreatingProfile(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await window.hermesAPI.createProfile(
        profileName.trim(),
        false,
      );
      const id = result?.id || result?.profileId || String(Math.random());
      setProfiles((prev) => [
        ...prev,
        {
          id,
          name: profileName.trim(),
          isActive: false,
          createdAt: Date.now(),
        },
      ]);
      setProfileName("");
    } catch (_) {}
    setCreatingProfile(false);
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      await window.hermesAPI.deleteProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch (_) {}
  };

  const handleSetActiveProfile = async (id: string) => {
    try {
      await window.hermesAPI.setActiveProfile(id);
      setProfiles((prev) => prev.map((p) => ({ ...p, isActive: p.id === id })));
    } catch (_) {}
  };

  const handleBackup = async () => {
    setBackingUp(true);
    setBackupResult("");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await window.hermesAPI.runHermesBackup();
      setBackupResult(
        result?.success
          ? `Backup saved: ${result.path || "Success"}`
          : `Error: ${result?.error || "Unknown error"}`,
      );
    } catch {
      setBackupResult("Backup failed");
    }
    setBackingUp(false);
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult("");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await window.hermesAPI.runHermesImport("", "");
      setImportResult(
        result?.success
          ? "Import complete"
          : `Error: ${result?.error || "Unknown error"}`,
      );
    } catch {
      setImportResult("Import failed");
    }
    setImporting(false);
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "connection", label: "Connection", icon: <Wifi size={14} /> },
    { id: "health", label: "Health", icon: <Activity size={14} /> },
    { id: "curator", label: "Curator", icon: <Sparkles size={14} /> },
    { id: "profiles", label: "Profiles", icon: <User size={14} /> },
    { id: "backup", label: "Backup", icon: <Download size={14} /> },
    { id: "about", label: "About", icon: <Info size={14} /> },
  ];

  if (loading) {
    return (
      <div className="main-80m">
        <div className="chat-header-80m">
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              color: "#4ade80",
              cursor: "pointer",
              fontFamily: "'Fira Code', monospace",
              fontSize: "12px",
            }}
          >
            ← Back
          </button>
          <span className="chat-header-80m-title">SETTINGS</span>
          <span />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Fira Code', monospace",
            color: "#e8e8e8",
            fontSize: "12px",
          }}
        >
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="main-80m">
      <div className="chat-header-80m">
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "#4ade80",
            cursor: "pointer",
            fontFamily: "'Fira Code', monospace",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          ← Back
        </button>
        <span className="chat-header-80m-title">SETTINGS</span>
        <span />
      </div>

      <div className="settings-80m-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`settings-80m-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-80m-content">
        <AnimatePresence mode="wait">
          {activeTab === "connection" && (
            <motion.div
              key="connection"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="settings-80m-section"
            >
              <div className="settings-80m-field">
                <label className="settings-80m-label">Mode</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => setConnMode("local")}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      border: `1px solid ${connMode === "local" ? "#4ade80" : "rgba(74,222,128,0.15)"}`,
                      background:
                        connMode === "local"
                          ? "rgba(74,222,128,0.1)"
                          : "transparent",
                      color: connMode === "local" ? "#4ade80" : "#e8e8e8",
                      fontFamily: "'Fira Code', monospace",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                  >
                    <Wifi size={12} style={{ marginRight: 4 }} /> Local
                  </button>
                  <button
                    onClick={() => setConnMode("remote")}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      border: `1px solid ${connMode === "remote" ? "#4ade80" : "rgba(74,222,128,0.15)"}`,
                      background:
                        connMode === "remote"
                          ? "rgba(74,222,128,0.1)"
                          : "transparent",
                      color: connMode === "remote" ? "#4ade80" : "#e8e8e8",
                      fontFamily: "'Fira Code', monospace",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                  >
                    <WifiOff size={12} style={{ marginRight: 4 }} /> Remote
                  </button>
                </div>
              </div>

              {connMode === "remote" && (
                <>
                  <div className="settings-80m-field">
                    <label className="settings-80m-label">Remote URL</label>
                    <input
                      type="text"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="https://hermes.example.com"
                      className="settings-80m-input"
                    />
                  </div>
                  <div className="settings-80m-field">
                    <label className="settings-80m-label">API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="settings-80m-input"
                    />
                  </div>
                </>
              )}

              <div className="settings-80m-divider" />

              <div className="settings-80m-field">
                <label className="settings-80m-label">Active Model</label>
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    marginBottom: "16px",
                  }}
                >
                  {activeModelPresets.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleQuickModelSelect(m)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "8px",
                        border: `1px solid ${provider === m.provider && model === m.model ? "#4ade80" : "rgba(74,222,128,0.15)"}`,
                        background:
                          provider === m.provider && model === m.model
                            ? "rgba(74,222,128,0.1)"
                            : "transparent",
                        color:
                          provider === m.provider && model === m.model
                            ? "#4ade80"
                            : "#e8e8e8",
                        fontFamily: "'Fira Code', monospace",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        textTransform: "uppercase",
                      }}
                    >
                      {m.name || m.model}
                    </button>
                  ))}
                </div>

                <div className="settings-80m-divider" />
                <label
                  className="settings-80m-label"
                  style={{ marginTop: "16px" }}
                >
                  Custom Model Override
                </label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {PROVIDER_CHOICES.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setProvider(p);
                        if (p === "minimax-oauth") {
                          setModel("MiniMax-M2.7");
                          setBaseUrl("https://api.minimax.io/anthropic");
                        }
                        setModelError(null);
                      }}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "8px",
                        border: `1px solid ${provider === p ? "#4ade80" : "rgba(74,222,128,0.15)"}`,
                        background:
                          provider === p
                            ? "rgba(74,222,128,0.1)"
                            : "transparent",
                        color: provider === p ? "#4ade80" : "#e8e8e8",
                        fontFamily: "'Fira Code', monospace",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        textTransform: "uppercase",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-80m-field">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. openai/gpt-5.5 or codex"
                  className="settings-80m-input"
                />
                {modelError && (
                  <div
                    style={{
                      color: "#ef4444",
                      fontFamily: "'Fira Code', monospace",
                      fontSize: "11px",
                      marginTop: "8px",
                    }}
                  >
                    {modelError}
                  </div>
                )}
              </div>

              <div className="settings-80m-field">
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="Base URL (Optional)"
                  className="settings-80m-input"
                />
              </div>

              <button onClick={handleSave} className="settings-80m-save-btn">
                {saved ? "SAVED ✓" : "SAVE CONFIG"}
              </button>
            </motion.div>
          )}

          {activeTab === "health" && (
            <motion.div
              key="health"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="settings-80m-section"
            >
              <div className="settings-80m-health-header">
                <label className="settings-80m-label">Hermes Health</label>
                <button
                  type="button"
                  className="settings-80m-profile-btn"
                  onClick={() => {
                    void refreshHealth();
                    void refreshCapabilities();
                  }}
                  disabled={healthLoading || capabilitiesLoading}
                >
                  <RefreshCw size={13} />
                  {healthLoading || capabilitiesLoading
                    ? "Checking"
                    : "Refresh"}
                </button>
              </div>

              {health ? (
                <div className="settings-80m-health-grid">
                  <div className="settings-80m-health-card">
                    <span className="settings-80m-health-title">Install</span>
                    <span
                      className={`settings-80m-health-pill ${health.install.installed && health.install.verified ? "ok" : "bad"}`}
                    >
                      {health.install.installed && health.install.verified
                        ? "Ready"
                        : "Needs attention"}
                    </span>
                    <p>
                      Config: {health.install.configured ? "found" : "missing"}
                    </p>
                    <p>
                      Provider key:{" "}
                      {health.install.hasApiKey ? "found" : "missing"}
                    </p>
                  </div>

                  <div className="settings-80m-health-card">
                    <span className="settings-80m-health-title">Gateway</span>
                    <span
                      className={`settings-80m-health-pill ${health.gateway.running && health.gateway.apiOk ? "ok" : "bad"}`}
                    >
                      {health.gateway.apiOk ? "API online" : "API offline"}
                    </span>
                    <p>{health.gateway.apiUrl}</p>
                    <p>
                      HTTP: {health.gateway.apiStatus || "none"}
                      {health.gateway.apiError
                        ? ` / ${health.gateway.apiError}`
                        : ""}
                    </p>
                    <p>
                      Local API key:{" "}
                      {health.gateway.hasApiServerKey ? "present" : "missing"}
                    </p>
                  </div>

                  <div className="settings-80m-health-card">
                    <span className="settings-80m-health-title">Model</span>
                    <span className="settings-80m-health-pill ok">
                      {health.model.provider || "auto"}
                    </span>
                    <p>{health.model.model || "No model configured"}</p>
                    <p>{health.model.baseUrl || "Default base URL"}</p>
                  </div>

                  <div className="settings-80m-health-card">
                    <span className="settings-80m-health-title">
                      Credentials
                    </span>
                    <span className="settings-80m-health-pill ok">
                      {health.credentialProviders.length} pools
                    </span>
                    <p>
                      Env keys:{" "}
                      {Object.entries(health.env)
                        .filter(([, present]) => present)
                        .map(([key]) => key.replace(/^has/, ""))
                        .join(", ") || "none detected"}
                    </p>
                    <p>
                      Pools:{" "}
                      {health.credentialProviders
                        .map((entry) => `${entry.provider} (${entry.count})`)
                        .join(", ") || "none detected"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="settings-80m-health-empty">
                  Health data is not available yet.
                </p>
              )}

              {capabilities && (
                <>
                  <div className="settings-80m-divider" />
                  <div className="settings-80m-health-grid">
                    <div className="settings-80m-health-card">
                      <span className="settings-80m-health-title">
                        Hermes Version
                      </span>
                      <span
                        className={`settings-80m-health-pill ${
                          capabilities.isAtLeastV12 ? "ok" : "bad"
                        }`}
                      >
                        {capabilities.semver || "unknown"}
                      </span>
                      <p>
                        v0.12 features:{" "}
                        {capabilities.isAtLeastV12
                          ? "enabled"
                          : "upgrade gated"}
                      </p>
                      <p>
                        Update:{" "}
                        {capabilities.updateAvailable
                          ? "available"
                          : "not reported"}
                      </p>
                      <button
                        type="button"
                        className="settings-80m-profile-btn"
                        onClick={() => void handleSafeUpgrade()}
                        disabled={upgrading}
                      >
                        {upgrading ? "Upgrading" : "Backup + Upgrade"}
                      </button>
                      {upgradeResult && (
                        <div
                          className={`settings-80m-result ${
                            upgradeResult.startsWith("Upgrade failed")
                              ? "error"
                              : "success"
                          }`}
                        >
                          {upgradeResult}
                        </div>
                      )}
                    </div>

                    <div className="settings-80m-health-card">
                      <span className="settings-80m-health-title">
                        API Surface
                      </span>
                      <span
                        className={`settings-80m-health-pill ${
                          capabilities.api.ok ? "ok" : "bad"
                        }`}
                      >
                        {capabilities.api.ok ? "online" : "offline"}
                      </span>
                      <p>{capabilities.api.url}</p>
                      <p>
                        Models:{" "}
                        {capabilities.api.models.join(", ") || "none reported"}
                      </p>
                    </div>

                    <div className="settings-80m-health-card">
                      <span className="settings-80m-health-title">
                        Runs Runtime
                      </span>
                      <span
                        className={`settings-80m-health-pill ${
                          capabilities.supports.runs ? "ok" : "bad"
                        }`}
                      >
                        {capabilities.supports.runs ? "ready" : "unavailable"}
                      </span>
                      <p>
                        Responses:{" "}
                        {capabilities.supports.responses ? "yes" : "no"}
                      </p>
                      <p>
                        Events/stop:{" "}
                        {capabilities.supports.runEvents
                          ? "events"
                          : "no events"}
                        {" / "}
                        {capabilities.supports.runStop ? "stop" : "no stop"}
                      </p>
                    </div>

                    <div className="settings-80m-health-card">
                      <span className="settings-80m-health-title">
                        Nous Tool Gateway
                      </span>
                      <span
                        className={`settings-80m-health-pill ${
                          capabilities.toolGateway.available ? "ok" : "bad"
                        }`}
                      >
                        {capabilities.toolGateway.available
                          ? "available"
                          : "gated"}
                      </span>
                      <p>{capabilities.toolGateway.reason}</p>
                      <p>
                        Managed tools:{" "}
                        {capabilities.toolGateway.managedTools.join(", ") ||
                          "none"}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {activeTab === "curator" && (
            <motion.div
              key="curator"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="settings-80m-section"
            >
              <div className="settings-80m-health-header">
                <label className="settings-80m-label">Curator</label>
                <button
                  type="button"
                  className="settings-80m-profile-btn"
                  onClick={() => void runCuratorAction("status")}
                  disabled={Boolean(curatorBusy)}
                >
                  <RefreshCw size={13} />
                  {curatorBusy === "status" ? "Checking" : "Status"}
                </button>
              </div>

              {!capabilities?.supports.curator && (
                <div className="settings-80m-result error">
                  Curator controls require Hermes v0.12+. Run the safe upgrade
                  from Health first.
                </div>
              )}

              <div className="settings-80m-health-grid">
                <div className="settings-80m-health-card">
                  <span className="settings-80m-health-title">State</span>
                  <span
                    className={`settings-80m-health-pill ${
                      curator?.success ? "ok" : "bad"
                    }`}
                  >
                    {curator?.supported === false
                      ? "not supported"
                      : curator?.success
                        ? "ready"
                        : "unknown"}
                  </span>
                  <p>
                    Pinned skills:{" "}
                    {curator?.pinned.length
                      ? curator.pinned.join(", ")
                      : "none"}
                  </p>
                  <p>
                    Report:{" "}
                    {curator?.report.reportPath || "No curator report yet"}
                  </p>
                </div>

                <div className="settings-80m-health-card">
                  <span className="settings-80m-health-title">Actions</span>
                  <div className="settings-80m-action-grid">
                    {[
                      ["dry-run", "Dry Run"],
                      ["run", "Run"],
                      ["pause", "Pause"],
                      ["resume", "Resume"],
                      ["backup", "Backup"],
                      ["rollback", "Rollback"],
                    ].map(([action, label]) => (
                      <button
                        key={action}
                        type="button"
                        className="settings-80m-profile-btn"
                        onClick={() => void runCuratorAction(action)}
                        disabled={Boolean(curatorBusy)}
                      >
                        {curatorBusy === action ? "Working" : label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="settings-80m-field">
                <label className="settings-80m-label">Skill Guard</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="settings-80m-input"
                    style={{ flex: 1 }}
                    value={curatorSkill}
                    onChange={(event) => setCuratorSkill(event.target.value)}
                    placeholder="skill-name"
                  />
                  {["pin", "unpin", "restore"].map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="settings-80m-profile-btn"
                      onClick={() =>
                        void runCuratorAction(action, curatorSkill.trim())
                      }
                      disabled={Boolean(curatorBusy) || !curatorSkill.trim()}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>

              {(curatorOutput || curator?.report.report) && (
                <div className="settings-80m-field">
                  <label className="settings-80m-label">Latest Output</label>
                  <pre className="settings-80m-log-block">
                    {curatorOutput || curator?.report.report}
                  </pre>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "profiles" && (
            <motion.div
              key="profiles"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="settings-80m-section"
            >
              <div className="settings-80m-field">
                <label className="settings-80m-label">Create Profile</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="Profile name"
                    className="settings-80m-input"
                    style={{ flex: 1 }}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleCreateProfile()
                    }
                  />
                  <button
                    onClick={handleCreateProfile}
                    disabled={creatingProfile || !profileName.trim()}
                    className="settings-80m-save-btn"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {creatingProfile ? "CREATING..." : "CREATE"}
                  </button>
                </div>
              </div>

              <div className="settings-80m-divider" />

              <div className="settings-80m-profiles-list">
                {profiles.length === 0 ? (
                  <p
                    style={{
                      color: "#e8e8e8",
                      fontFamily: "'Fira Code', monospace",
                      fontSize: "12px",
                      textAlign: "center",
                      padding: "20px",
                    }}
                  >
                    No profiles yet
                  </p>
                ) : (
                  profiles.map((profile) => (
                    <div key={profile.id} className="settings-80m-profile-card">
                      <div className="settings-80m-profile-info">
                        <span className="settings-80m-profile-name">
                          {profile.name}
                        </span>
                        {profile.isActive && (
                          <span className="settings-80m-profile-badge">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div className="settings-80m-profile-actions">
                        {!profile.isActive && (
                          <button
                            onClick={() => handleSetActiveProfile(profile.id)}
                            className="settings-80m-profile-btn"
                          >
                            Activate
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteProfile(profile.id)}
                          className="settings-80m-profile-btn settings-80m-profile-btn-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "backup" && (
            <motion.div
              key="backup"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="settings-80m-section"
            >
              <div className="settings-80m-field">
                <label className="settings-80m-label">Hermes Backup</label>
                <p
                  style={{
                    color: "#e8e8e8",
                    fontFamily: "'Fira Code', monospace",
                    fontSize: "11px",
                    marginBottom: "12px",
                  }}
                >
                  Export all Hermes data including sessions, memory, skills, and
                  configuration.
                </p>
                <button
                  onClick={handleBackup}
                  disabled={backingUp}
                  className="settings-80m-save-btn"
                >
                  {backingUp ? (
                    "BACKING UP..."
                  ) : (
                    <>
                      <Download size={13} style={{ marginRight: 6 }} />
                      RUN BACKUP
                    </>
                  )}
                </button>
                {backupResult && (
                  <div
                    className={`settings-80m-result ${backupResult.startsWith("Error") ? "error" : "success"}`}
                  >
                    {backupResult}
                  </div>
                )}
              </div>

              <div className="settings-80m-divider" />

              <div className="settings-80m-field">
                <label className="settings-80m-label">Restore / Import</label>
                <p
                  style={{
                    color: "#e8e8e8",
                    fontFamily: "'Fira Code', monospace",
                    fontSize: "11px",
                    marginBottom: "12px",
                  }}
                >
                  Restore from a previous Hermes backup. This will merge with
                  existing data.
                </p>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="settings-80m-save-btn"
                  style={{ background: "#4ade80" }}
                >
                  {importing ? (
                    "IMPORTING..."
                  ) : (
                    <>
                      <Upload size={13} style={{ marginRight: 6 }} />
                      RUN IMPORT
                    </>
                  )}
                </button>
                {importResult && (
                  <div
                    className={`settings-80m-result ${importResult.startsWith("Error") ? "error" : "success"}`}
                  >
                    {importResult}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "about" && (
            <motion.div
              key="about"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="settings-80m-section"
            >
              <div className="settings-80m-about">
                <Animated80MLogo className="animated-80m-logo-about" />
                <p className="settings-80m-about-tagline">Agent Desktop</p>
                <div className="settings-80m-about-versions">
                  <div className="settings-80m-about-version">
                    <span className="settings-80m-label">Desktop App</span>
                    <span className="settings-80m-version-value">
                      v{appVersion || "0.3.0"}
                    </span>
                  </div>
                  <div className="settings-80m-about-version">
                    <span className="settings-80m-label">Hermes Engine</span>
                    <span className="settings-80m-version-value">
                      {hermesVersion || "Unknown"}
                    </span>
                  </div>
                </div>
                <p className="settings-80m-about-desc">
                  Agent Desktop — A brutalist dark UI for the Hermes multi-agent
                  system.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style>{`
        .settings-80m-tabs {
          display: flex;
          gap: 4px;
          padding: 8px 16px;
          border-bottom: 1px solid rgba(74, 222, 128, 0.1);
          background: rgba(15, 15, 15, 0.6);
          flex-shrink: 0;
        }
        .settings-80m-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: #e8e8e8;
          font-family: 'Fira Code', monospace;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .settings-80m-tab:hover {
          color: #9a9a9a;
          background: rgba(255,255,255,0.04);
        }
        .settings-80m-tab.active {
          color: #4ade80;
          background: rgba(74, 222, 128, 0.1);
          border-color: rgba(74, 222, 128, 0.2);
        }
        .settings-80m-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }
        .settings-80m-section {
          max-width: 600px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .settings-80m-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .settings-80m-label {
          font-family: 'Fira Code', monospace;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.15em;
          color: #4ade80;
          text-transform: uppercase;
        }
        .settings-80m-input {
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid rgba(74, 222, 128, 0.15);
          background: #1a1a1a;
          color: #e8e8e8;
          font-family: 'Fira Code', monospace;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s;
        }
        .settings-80m-input:focus {
          border-color: rgba(74, 222, 128, 0.4);
        }
        .settings-80m-divider {
          height: 1px;
          background: rgba(74, 222, 128, 0.08);
          margin: 4px 0;
        }
        .settings-80m-save-btn {
          align-self: flex-start;
          padding: 10px 24px;
          border-radius: 10px;
          border: none;
          background: #4ade80;
          color: #0f0f0f;
          font-family: 'Fira Code', monospace;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.05em;
          display: flex;
          align-items: center;
        }
        .settings-80m-save-btn:hover {
          background: #22c55e;
        }
        .settings-80m-save-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .settings-80m-profiles-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .settings-80m-profile-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-radius: 10px;
          border: 1px solid rgba(74, 222, 128, 0.08);
          background: rgba(74, 222, 128, 0.03);
        }
        .settings-80m-profile-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .settings-80m-profile-name {
          font-family: 'Fira Code', monospace;
          font-size: 13px;
          font-weight: 600;
          color: #e8e8e8;
        }
        .settings-80m-profile-badge {
          font-family: 'Fira Code', monospace;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #0f0f0f;
          background: #4ade80;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .settings-80m-profile-actions {
          display: flex;
          gap: 8px;
        }
        .settings-80m-profile-btn {
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid rgba(74, 222, 128, 0.2);
          background: transparent;
          color: #4ade80;
          font-family: 'Fira Code', monospace;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.15s;
        }
        .settings-80m-profile-btn:hover {
          background: rgba(74, 222, 128, 0.1);
        }
        .settings-80m-profile-btn-danger {
          border-color: rgba(248, 113, 113, 0.2);
          color: #f87171;
        }
        .settings-80m-profile-btn-danger:hover {
          background: rgba(248, 113, 113, 0.1);
        }
        .settings-80m-result {
          margin-top: 12px;
          padding: 10px 14px;
          border-radius: 8px;
          font-family: 'Fira Code', monospace;
          font-size: 11px;
        }
        .settings-80m-result.success {
          background: rgba(74, 222, 128, 0.1);
          color: #4ade80;
          border: 1px solid rgba(74, 222, 128, 0.2);
        }
        .settings-80m-result.error {
          background: rgba(248, 113, 113, 0.1);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.2);
        }
        .settings-80m-action-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .settings-80m-log-block {
          max-height: 260px;
          overflow: auto;
          margin: 0;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid rgba(74, 222, 128, 0.12);
          background: rgba(0, 0, 0, 0.32);
          color: #e8e8e8;
          font-family: 'Fira Code', monospace;
          font-size: 11px;
          line-height: 1.6;
          white-space: pre-wrap;
        }
        .settings-80m-about {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 32px;
          text-align: center;
        }
        .settings-80m-about-tagline {
          font-family: 'Fira Code', monospace;
          font-size: 14px;
          font-weight: 700;
          color: #e8e8e8;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          margin: 0;
        }
        .settings-80m-about-versions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }
        .settings-80m-about-version {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 16px;
          border-radius: 8px;
          background: rgba(74, 222, 128, 0.05);
          border: 1px solid rgba(74, 222, 128, 0.08);
        }
        .settings-80m-version-value {
          font-family: 'Fira Code', monospace;
          font-size: 12px;
          font-weight: 700;
          color: #4ade80;
        }
        .settings-80m-about-desc {
          font-family: 'Fira Code', monospace;
          font-size: 11px;
          color: #e8e8e8;
          margin: 0;
          line-height: 1.8;
        }
      `}</style>
    </div>
  );
};

export default Settings80m;
