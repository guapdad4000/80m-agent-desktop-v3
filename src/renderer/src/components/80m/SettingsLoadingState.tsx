import type React from "react";

interface SettingsLoadingStateProps {
  onBack: () => void;
}

export function SettingsLoadingState({
  onBack,
}: SettingsLoadingStateProps): React.JSX.Element {
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
          fontFamily: "monospace",
          color: "#e8e8e8",
          fontSize: "12px",
        }}
      >
        Loading...
      </div>
    </div>
  );
}
