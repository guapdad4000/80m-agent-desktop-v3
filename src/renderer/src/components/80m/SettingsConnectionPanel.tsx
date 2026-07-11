import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import { motion } from "framer-motion";
import { Wifi, WifiOff } from "lucide-react";
import {
  PROVIDER_CHOICES,
  settingsChoiceButtonStyle,
} from "./settingsModelConfig";
import type { ModelPreset } from "./settingsTypes";

interface SettingsConnectionPanelProps {
  connMode: "local" | "remote";
  setConnMode: Dispatch<SetStateAction<"local" | "remote">>;
  remoteUrl: string;
  setRemoteUrl: Dispatch<SetStateAction<string>>;
  apiKey: string;
  setApiKey: Dispatch<SetStateAction<string>>;
  activeModelPresets: ModelPreset[];
  provider: string;
  setProvider: Dispatch<SetStateAction<string>>;
  model: string;
  setModel: Dispatch<SetStateAction<string>>;
  baseUrl: string;
  setBaseUrl: Dispatch<SetStateAction<string>>;
  modelError: string | null;
  setModelError: Dispatch<SetStateAction<string | null>>;
  saved: boolean;
  onQuickModelSelect: (model: ModelPreset) => void;
  onSave: () => void;
}

export function SettingsConnectionPanel({
  connMode,
  setConnMode,
  remoteUrl,
  setRemoteUrl,
  apiKey,
  setApiKey,
  activeModelPresets,
  provider,
  setProvider,
  model,
  setModel,
  baseUrl,
  setBaseUrl,
  modelError,
  setModelError,
  saved,
  onQuickModelSelect,
  onSave,
}: SettingsConnectionPanelProps): React.JSX.Element {
  return (
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
            style={settingsChoiceButtonStyle(connMode === "local")}
          >
            <Wifi size={12} /> Local
          </button>
          <button
            onClick={() => setConnMode("remote")}
            style={settingsChoiceButtonStyle(connMode === "remote")}
          >
            <WifiOff size={12} /> Remote
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
              onClick={() => onQuickModelSelect(m)}
              style={settingsChoiceButtonStyle(
                provider === m.provider && model === m.model,
              )}
            >
              {m.name || m.model}
            </button>
          ))}
        </div>

        <div className="settings-80m-divider" />
        <label className="settings-80m-label" style={{ marginTop: "16px" }}>
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
              style={settingsChoiceButtonStyle(provider === p)}
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
              fontFamily: "monospace",
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

      <button onClick={onSave} className="settings-80m-save-btn">
        {saved ? "SAVED ✓" : "SAVE CONFIG"}
      </button>
    </motion.div>
  );
}
