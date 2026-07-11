import type React from "react";
import { SETTINGS_TABS, type SettingsTabId } from "./settingsTabs";

interface SettingsFrameProps {
  activeTab: SettingsTabId;
  onBack: () => void;
  onTabChange: (tab: SettingsTabId) => void;
  children: React.ReactNode;
}

export function SettingsFrame({
  activeTab,
  onBack,
  onTabChange,
  children,
}: SettingsFrameProps): React.JSX.Element {
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
            fontFamily: "monospace",
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
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`settings-80m-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-80m-content">{children}</div>
    </div>
  );
}
