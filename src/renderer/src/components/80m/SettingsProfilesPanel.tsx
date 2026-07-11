import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import { motion } from "framer-motion";
import type { RendererProfileInfo } from "../../hooks/useProfiles";

interface SettingsProfilesPanelProps {
  profiles: RendererProfileInfo[];
  profileName: string;
  setProfileName: Dispatch<SetStateAction<string>>;
  profileCreateMode: "clone" | "blank" | "clone-all";
  setProfileCreateMode: Dispatch<
    SetStateAction<"clone" | "blank" | "clone-all">
  >;
  profileCloneFrom: string;
  setProfileCloneFrom: Dispatch<SetStateAction<string>>;
  profileNoAlias: boolean;
  setProfileNoAlias: Dispatch<SetStateAction<boolean>>;
  profileNoSkills: boolean;
  setProfileNoSkills: Dispatch<SetStateAction<boolean>>;
  profileCreateResult: string;
  creatingProfile: boolean;
  onCreateProfile: () => void;
  onDeleteProfile: (name: string) => void;
  onSetActiveProfile: (name: string) => void;
}

export function SettingsProfilesPanel({
  profiles,
  profileName,
  setProfileName,
  profileCreateMode,
  setProfileCreateMode,
  profileCloneFrom,
  setProfileCloneFrom,
  profileNoAlias,
  setProfileNoAlias,
  profileNoSkills,
  setProfileNoSkills,
  profileCreateResult,
  creatingProfile,
  onCreateProfile,
  onDeleteProfile,
  onSetActiveProfile,
}: SettingsProfilesPanelProps): React.JSX.Element {
  return (
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
        <div className="settings-80m-profile-create-grid">
          <input
            type="text"
            value={profileName}
            onChange={(e) =>
              setProfileName(
                e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
              )
            }
            placeholder="Profile name"
            className="settings-80m-input"
            onKeyDown={(e) => e.key === "Enter" && onCreateProfile()}
          />
          <select
            value={profileCreateMode}
            onChange={(e) =>
              setProfileCreateMode(
                e.target.value as "clone" | "blank" | "clone-all",
              )
            }
            className="settings-80m-input"
          >
            <option value="clone">Clone config</option>
            <option value="blank">Blank profile</option>
            <option value="clone-all">Clone everything</option>
          </select>
          <select
            value={profileCloneFrom}
            onChange={(e) => setProfileCloneFrom(e.target.value)}
            className="settings-80m-input"
            disabled={profileCreateMode === "blank"}
          >
            {profiles.map((item) => (
              <option key={item.name} value={item.name}>
                from {item.name}
              </option>
            ))}
          </select>
          <label className="settings-80m-check-row">
            <input
              type="checkbox"
              checked={profileNoAlias}
              onChange={(e) => setProfileNoAlias(e.target.checked)}
            />
            No alias
          </label>
          <label className="settings-80m-check-row">
            <input
              type="checkbox"
              checked={profileNoSkills}
              onChange={(e) => setProfileNoSkills(e.target.checked)}
            />
            No skills
          </label>
          <button
            onClick={onCreateProfile}
            disabled={creatingProfile || !profileName.trim()}
            className="settings-80m-save-btn"
            style={{ whiteSpace: "nowrap" }}
          >
            {creatingProfile ? "CREATING..." : "CREATE"}
          </button>
        </div>
        <p className="settings-80m-hint">
          Clone config copies model, API, and SOUL settings with fresh sessions
          and memory. Profiles isolate Hermes state, not your filesystem
          workspace.
        </p>
        {profileCreateResult && (
          <div
            className={`settings-80m-result ${profileCreateResult.startsWith("Created") ? "success" : "error"}`}
          >
            {profileCreateResult}
          </div>
        )}
      </div>

      <div className="settings-80m-divider" />

      <div className="settings-80m-profiles-list">
        {profiles.length === 0 ? (
          <p
            style={{
              color: "#e8e8e8",
              fontFamily: "monospace",
              fontSize: "12px",
              textAlign: "center",
              padding: "20px",
            }}
          >
            No profiles yet
          </p>
        ) : (
          profiles.map((profileItem) => (
            <div key={profileItem.name} className="settings-80m-profile-card">
              <div className="settings-80m-profile-info">
                <span className="settings-80m-profile-name">
                  {profileItem.name}
                </span>
                {profileItem.isActive && (
                  <span className="settings-80m-profile-badge">ACTIVE</span>
                )}
                <span className="settings-80m-profile-meta">
                  {profileItem.model || "model unknown"} ·{" "}
                  {profileItem.provider || "provider unknown"} ·{" "}
                  {profileItem.gatewayRunning ? "gateway on" : "gateway off"}
                </span>
              </div>
              <div className="settings-80m-profile-actions">
                {!profileItem.isActive && (
                  <button
                    onClick={() => onSetActiveProfile(profileItem.name)}
                    className="settings-80m-profile-btn"
                  >
                    Activate
                  </button>
                )}
                <button
                  onClick={() => onDeleteProfile(profileItem.name)}
                  className="settings-80m-profile-btn settings-80m-profile-btn-danger"
                  disabled={profileItem.isDefault}
                >
                  Delete
                </button>
              </div>
              <div className="settings-80m-profile-path">
                {profileItem.path}
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
