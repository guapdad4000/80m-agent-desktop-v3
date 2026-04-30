import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Upload, User, Wifi, WifiOff, Info } from "lucide-react";

interface Props {
  onBack: () => void;
}

type TabId = "connection" | "profiles" | "backup" | "about";

interface Profile {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: number;
}

const Settings80m: React.FC<Props> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<TabId>("connection");
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saved, setSaved] = useState(false);
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

  useEffect(() => {
    if (window.hermesAPI) {
      // Load model config
      window.hermesAPI.getModelConfig?.().then(
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
  }, []);

  const handleSave = async () => {
    if (window.hermesAPI) {
      try {
        await window.hermesAPI.setModelConfig(provider, model, baseUrl);
        await window.hermesAPI.setConnectionConfig(connMode, remoteUrl, apiKey);
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
    } catch (e) {
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
    } catch (e) {
      setImportResult("Import failed");
    }
    setImporting(false);
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "connection", label: "Connection", icon: <Wifi size={14} /> },
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
            color: "#555",
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
                      color: connMode === "local" ? "#4ade80" : "#666",
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
                      color: connMode === "remote" ? "#4ade80" : "#666",
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
                <label className="settings-80m-label">Provider</label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {["openrouter", "openai", "anthropic", "custom"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setProvider(p)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "8px",
                        border: `1px solid ${provider === p ? "#4ade80" : "rgba(74,222,128,0.15)"}`,
                        background:
                          provider === p
                            ? "rgba(74,222,128,0.1)"
                            : "transparent",
                        color: provider === p ? "#4ade80" : "#666",
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
                <label className="settings-80m-label">Model Name</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. anthropic/claude-3-5-sonnet"
                  className="settings-80m-input"
                />
              </div>

              <div className="settings-80m-field">
                <label className="settings-80m-label">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  className="settings-80m-input"
                />
              </div>

              <button onClick={handleSave} className="settings-80m-save-btn">
                {saved ? "SAVED ✓" : "SAVE CONFIG"}
              </button>
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
                      color: "#555",
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
                    color: "#666",
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
                    color: "#666",
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
                  style={{ background: "#3b82f6" }}
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
                <div className="settings-80m-about-logo">
                  80<span>M</span>
                </div>
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
                  80m Agent Desktop — A brutalist dark UI for the Hermes
                  multi-agent system.
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
          color: #555;
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
        .settings-80m-about {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 32px;
          text-align: center;
        }
        .settings-80m-about-logo {
          font-family: 'Fira Code', monospace;
          font-size: 48px;
          font-weight: 900;
          color: #e8e8e8;
          letter-spacing: -2px;
        }
        .settings-80m-about-logo span {
          color: #4ade80;
        }
        .settings-80m-about-tagline {
          font-family: 'Fira Code', monospace;
          font-size: 14px;
          font-weight: 700;
          color: #555;
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
          color: #555;
          margin: 0;
          line-height: 1.8;
        }
      `}</style>
    </div>
  );
};

export default Settings80m;
