import type React from "react";
import { motion } from "framer-motion";
import { Download, Upload } from "lucide-react";

interface SettingsBackupPanelProps {
  backingUp: boolean;
  importing: boolean;
  backupResult: string;
  importResult: string;
  onBackup: () => void;
  onImport: () => void;
}

export function SettingsBackupPanel({
  backingUp,
  importing,
  backupResult,
  importResult,
  onBackup,
  onImport,
}: SettingsBackupPanelProps): React.JSX.Element {
  return (
    <motion.div
      key="backup"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="settings-80m-section"
    >
      <div className="settings-80m-field">
        <label className="settings-80m-label">80M Backup</label>
        <p
          style={{
            color: "#e8e8e8",
            fontFamily: "monospace",
            fontSize: "11px",
            marginBottom: "12px",
          }}
        >
          Export all 80M data including sessions, memory, skills, and
          configuration.
        </p>
        <button
          onClick={onBackup}
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
            fontFamily: "monospace",
            fontSize: "11px",
            marginBottom: "12px",
          }}
        >
          Restore from a previous 80M backup. This will merge with existing
          data.
        </p>
        <button
          onClick={onImport}
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
  );
}
