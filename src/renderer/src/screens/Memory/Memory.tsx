import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Refresh } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import {
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  ExternalLink,
  FileCode2,
  FileJson,
  FileText,
  FolderOpen,
  Save,
  X,
} from "lucide-react";
import AgentMarkdown from "../../components/AgentMarkdown";

interface MemoryEntry {
  index: number;
  content: string;
}

interface MemoryData {
  memory: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    entries: MemoryEntry[];
    charCount: number;
    charLimit: number;
  };
  user: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    charCount: number;
    charLimit: number;
  };
  stats: { totalSessions: number; totalMessages: number };
}

interface FileNode {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface ObsidianVaultInfo {
  path: string | null;
  name: string;
  exists: boolean;
  noteCount: number;
  totalFiles: number;
}

interface DocumentPreviewData {
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
}

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function CapacityBar({
  used,
  limit,
  label,
}: {
  used: number;
  limit: number;
  label: string;
}): React.JSX.Element {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color =
    pct > 90 ? "var(--error)" : pct > 70 ? "var(--warning)" : "var(--success)";
  return (
    <div className="memory-capacity">
      <div className="memory-capacity-header">
        <span className="memory-capacity-label">{label}</span>
        <span className="memory-capacity-value">
          {used.toLocaleString()} / {limit.toLocaleString()} chars ({pct}%)
        </span>
      </div>
      <div className="memory-capacity-track">
        <div
          className="memory-capacity-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

interface MemoryProviderInfo {
  name: string;
  description: string;
  installed: boolean;
  active: boolean;
  envVars: string[];
}

const PROVIDER_URLS: Record<string, string> = {
  honcho: "https://app.honcho.dev",
  hindsight: "https://ui.hindsight.vectorize.io",
  mem0: "https://app.mem0.ai",
  retaindb: "https://retaindb.com",
  supermemory: "https://supermemory.ai",
  byterover: "https://app.byterover.dev",
};

function documentExtension(note: DocumentPreviewData | null): string {
  if (!note) return "";
  const match = (note.path || note.name).toLowerCase().match(/\.([^.]+)$/);
  return match ? `.${match[1]}` : "";
}

function displayFileName(name: string): string {
  const cleaned = name
    .replace(
      /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\s)+/gu,
      "",
    )
    .trim();
  return cleaned || name;
}

function displayLocalPath(value: string): string {
  return value
    .split(/([/\\])/)
    .map((part) =>
      part === "/" || part === "\\" ? part : displayFileName(part),
    )
    .join("");
}

function isMarkdownDocument(note: DocumentPreviewData | null): boolean {
  const extension = documentExtension(note);
  return note?.kind === "markdown" || [".md", ".markdown"].includes(extension);
}

function isJsonDocument(note: DocumentPreviewData | null): boolean {
  return [".json", ".jsonl"].includes(documentExtension(note));
}

function isEditableDocument(note: DocumentPreviewData | null): boolean {
  if (!note || note.content === undefined || note.truncated) return false;
  return [
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
  ].includes(documentExtension(note));
}

function readableJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function readableContent(note: DocumentPreviewData): string {
  const content = note.content || "";
  return isJsonDocument(note) ? readableJson(content) : content;
}

function documentKindLabel(note: DocumentPreviewData): string {
  if (isMarkdownDocument(note)) return "Markdown";
  if (isJsonDocument(note)) return "JSON";
  if (note.kind === "office") return "Office";
  return note.kind.charAt(0).toUpperCase() + note.kind.slice(1);
}

function DocumentKindIcon({
  note,
}: {
  note: DocumentPreviewData;
}): React.JSX.Element {
  if (isMarkdownDocument(note)) return <BookOpen size={17} />;
  if (isJsonDocument(note)) return <FileJson size={17} />;
  if ([".yaml", ".yml"].includes(documentExtension(note))) {
    return <Braces size={17} />;
  }
  if (note.kind === "text") return <FileCode2 size={17} />;
  return <FileText size={17} />;
}

function VaultTreeNode({
  node,
  level,
  onFileClick,
}: {
  node: FileNode;
  level: number;
  onFileClick: (path: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  async function toggle(): Promise<void> {
    if (!node.isDirectory) {
      onFileClick(node.path);
      return;
    }
    if (!expanded) {
      setLoading(true);
      try {
        const entries = await window.hermesAPI.readDirectory(node.path);
        setChildren(entries);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((value) => !value);
  }

  return (
    <div className="memory-vault-node">
      <button
        type="button"
        className="memory-vault-tree-item"
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        onClick={() => void toggle()}
        title={node.path}
      >
        {node.isDirectory ? (
          <>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <FolderOpen size={13} />
          </>
        ) : (
          <>
            <span className="memory-vault-tree-spacer" />
            <FileText size={13} />
          </>
        )}
        <span className="memory-vault-tree-name">
          {displayFileName(node.name)}
        </span>
        {loading && <span className="memory-vault-tree-loading">...</span>}
      </button>
      {expanded && node.isDirectory && (
        <div>
          {children.map((child) => (
            <VaultTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Memory({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"vault" | "entries" | "profile" | "providers">(
    "vault",
  );
  const [error, setError] = useState("");
  const [memoryProvider, setMemoryProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([]);
  const [providerEnv, setProviderEnv] = useState<Record<string, string>>({});
  const [providerSavedKey, setProviderSavedKey] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [vault, setVault] = useState<ObsidianVaultInfo | null>(null);
  const [vaultRoot, setVaultRoot] = useState<FileNode[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [selectedNote, setSelectedNote] = useState<DocumentPreviewData | null>(
    null,
  );
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteEditContent, setNoteEditContent] = useState("");
  const [noteOriginalContent, setNoteOriginalContent] = useState("");
  const [noteSaveStatus, setNoteSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [noteError, setNoteError] = useState("");

  // Entry management
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // User profile editing
  const [userContent, setUserContent] = useState("");
  const [userEditing, setUserEditing] = useState(false);
  const [userSaved, setUserSaved] = useState(false);

  const loadVaultRoot = useCallback(async (vaultPath: string | null) => {
    if (!vaultPath) {
      setVaultRoot([]);
      return;
    }
    setVaultLoading(true);
    try {
      const entries = await window.hermesAPI.readDirectory(vaultPath);
      setVaultRoot(entries);
    } finally {
      setVaultLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    const [d, provider, provs, env, vaultInfo] = await Promise.all([
      window.hermesAPI.readMemory(profile),
      window.hermesAPI.getConfig("memory.provider", profile),
      window.hermesAPI.discoverMemoryProviders(profile),
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getObsidianVault(),
    ]);
    setData(d as MemoryData);
    setUserContent(d.user.content);
    setMemoryProvider(provider);
    setProviders(provs);
    setProviderEnv(env);
    setVault(vaultInfo);
    await loadVaultRoot(vaultInfo.path);
    setLoading(false);
  }, [loadVaultRoot, profile]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  async function handleAddEntry(): Promise<void> {
    if (!newEntry.trim()) return;
    setError("");
    const result = await window.hermesAPI.addMemoryEntry(
      newEntry.trim(),
      profile,
    );
    if (result.success) {
      setNewEntry("");
      setShowAdd(false);
      await loadData();
    } else {
      setError(result.error || t("memory.addFailed"));
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (editingIndex === null) return;
    setError("");
    const result = await window.hermesAPI.updateMemoryEntry(
      editingIndex,
      editContent.trim(),
      profile,
    );
    if (result.success) {
      setEditingIndex(null);
      setEditContent("");
      await loadData();
    } else {
      setError(result.error || t("memory.updateFailed"));
    }
  }

  async function handleDeleteEntry(index: number): Promise<void> {
    await window.hermesAPI.removeMemoryEntry(index, profile);
    setConfirmDelete(null);
    await loadData();
  }

  async function handleSaveUserProfile(): Promise<void> {
    setError("");
    const result = await window.hermesAPI.writeUserProfile(
      userContent,
      profile,
    );
    if (result.success) {
      setUserEditing(false);
      setUserSaved(true);
      setTimeout(() => setUserSaved(false), 2000);
      await loadData();
    } else {
      setError(result.error || t("memory.saveFailed"));
    }
  }

  async function handleChooseVault(): Promise<void> {
    const selected = await window.hermesAPI.selectProjectDirectory();
    if (!selected) return;
    const info = await window.hermesAPI.setObsidianVault(selected);
    setVault(info);
    setSelectedNote(null);
    await loadVaultRoot(info.path);
  }

  async function handleVaultFileClick(path: string): Promise<void> {
    const preview = await window.hermesAPI.readDocumentPreview(path);
    setSelectedNote(preview);
    setNoteEditMode(false);
    setNoteEditContent(preview.content || "");
    setNoteOriginalContent(preview.content || "");
    setNoteSaveStatus("idle");
    setNoteError("");
  }

  async function handleSaveVaultNote(): Promise<void> {
    if (!selectedNote || !isEditableDocument(selectedNote)) return;
    setNoteSaveStatus("saving");
    setNoteError("");
    const result = await window.hermesAPI.writeDocumentContent(
      selectedNote.path,
      noteEditContent,
    );
    if (!result.success) {
      setNoteSaveStatus("error");
      setNoteError(result.error || "Save failed.");
      return;
    }

    const preview = await window.hermesAPI.readDocumentPreview(
      result.path || selectedNote.path,
    );
    setSelectedNote(preview);
    setNoteEditContent(preview.content || noteEditContent);
    setNoteOriginalContent(preview.content || noteEditContent);
    setNoteEditMode(false);
    setNoteSaveStatus("saved");
    setTimeout(() => setNoteSaveStatus("idle"), 1800);
  }

  async function handleRevealVault(): Promise<void> {
    if (vault?.path) await window.hermesAPI.revealLocalPath(vault.path);
  }

  if (loading || !data) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("memory.title")}</h1>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  const selectedNoteEditable = isEditableDocument(selectedNote);
  const selectedNoteDirty =
    selectedNoteEditable && noteEditContent !== noteOriginalContent;

  return (
    <div className="main-80m">
      <div className="screen-header-80m">
        <span className="screen-header-80m-title">SECOND BRAIN</span>
      </div>
      <div className="screen-content-80m">
        <div className="memory-header">
          <div>
            <h1 className="settings-header" style={{ marginBottom: 4 }}>
              Second Brain
            </h1>
            <p className="memory-subtitle">
              Obsidian vault, agent memory, and long-term profile context.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>
            <Refresh size={13} />
          </button>
        </div>

        {/* Stats */}
        <div className="memory-stats">
          <div className="memory-stat">
            <span className="memory-stat-value">
              {data.stats.totalSessions}
            </span>
            <span className="memory-stat-label">{t("memory.sessions")}</span>
          </div>
          <div className="memory-stat">
            <span className="memory-stat-value">
              {data.stats.totalMessages}
            </span>
            <span className="memory-stat-label">{t("memory.messages")}</span>
          </div>
          <div className="memory-stat">
            <span className="memory-stat-value">
              {data.memory.entries.length}
            </span>
            <span className="memory-stat-label">{t("memory.memories")}</span>
          </div>
          <div className="memory-stat">
            <span className="memory-stat-value">{vault?.noteCount ?? 0}</span>
            <span className="memory-stat-label">Vault Notes</span>
          </div>
        </div>

        {/* Capacity */}
        <div className="memory-capacities">
          <CapacityBar
            used={data.memory.charCount}
            limit={data.memory.charLimit}
            label={t("memory.agentMemory")}
          />
          <CapacityBar
            used={data.user.charCount}
            limit={data.user.charLimit}
            label={t("memory.userProfile")}
          />
        </div>

        {/* Tabs */}
        <div className="memory-tabs">
          <button
            className={`memory-tab ${tab === "vault" ? "active" : ""}`}
            onClick={() => setTab("vault")}
          >
            Obsidian Vault
            {vault?.exists && (
              <span className="memory-tab-time">{vault.name}</span>
            )}
          </button>
          <button
            className={`memory-tab ${tab === "entries" ? "active" : ""}`}
            onClick={() => setTab("entries")}
          >
            {t("memory.agentMemory")}
            {data.memory.lastModified && (
              <span className="memory-tab-time">
                {timeAgo(data.memory.lastModified)}
              </span>
            )}
          </button>
          <button
            className={`memory-tab ${tab === "profile" ? "active" : ""}`}
            onClick={() => setTab("profile")}
          >
            {t("memory.userProfile")}
            {data.user.lastModified && (
              <span className="memory-tab-time">
                {timeAgo(data.user.lastModified)}
              </span>
            )}
          </button>
          <button
            className={`memory-tab ${tab === "providers" ? "active" : ""}`}
            onClick={() => setTab("providers")}
          >
            {t("memory.providersTitle")}
            {memoryProvider && (
              <span className="memory-tab-time">{memoryProvider}</span>
            )}
          </button>
        </div>

        {error && <div className="memory-error">{error}</div>}

        {tab === "vault" && (
          <div className="memory-vault">
            <div className="memory-vault-toolbar">
              <div>
                <div className="memory-vault-kicker">Personal Archive</div>
                <div className="memory-vault-title">
                  {vault?.exists ? vault.name : "No vault selected"}
                </div>
                <div className="memory-vault-path">
                  {vault?.path ||
                    "Choose your Obsidian vault to browse notes here."}
                </div>
              </div>
              <div className="memory-vault-actions">
                {vault?.path && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleRevealVault()}
                  >
                    Reveal
                  </button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleChooseVault()}
                >
                  {vault?.exists ? "Change Vault" : "Choose Vault"}
                </button>
              </div>
            </div>

            {!vault?.exists ? (
              <div className="memory-empty">
                <p>Obsidian vault not found.</p>
                <p className="memory-empty-hint">
                  The desktop app will remember the folder you choose.
                </p>
              </div>
            ) : (
              <div className="memory-vault-browser">
                <div className="memory-vault-tree">
                  <div className="memory-vault-index-header">
                    <span>Vault Index</span>
                    <span>
                      {vault.noteCount.toLocaleString()} notes /{" "}
                      {vault.totalFiles.toLocaleString()} files
                    </span>
                  </div>
                  {vaultLoading ? (
                    <div className="memory-vault-loading">Loading vault...</div>
                  ) : (
                    vaultRoot.map((node) => (
                      <VaultTreeNode
                        key={node.path}
                        node={node}
                        level={0}
                        onFileClick={(path) => void handleVaultFileClick(path)}
                      />
                    ))
                  )}
                </div>
                <div className="memory-vault-preview">
                  {selectedNote ? (
                    <article className="memory-vault-article">
                      <header className="memory-vault-preview-header">
                        <div className="memory-vault-preview-heading">
                          <div className="memory-vault-document-icon">
                            <DocumentKindIcon note={selectedNote} />
                          </div>
                          <div>
                            <div className="memory-vault-kicker">
                              {documentKindLabel(selectedNote)} /{" "}
                              {selectedNote.size.toLocaleString()} bytes
                            </div>
                            <div className="memory-vault-preview-title">
                              {displayFileName(selectedNote.name)}
                            </div>
                            <div className="memory-vault-preview-path">
                              {displayLocalPath(selectedNote.path)}
                            </div>
                          </div>
                        </div>
                        <div className="memory-vault-actions">
                          {selectedNoteEditable && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setNoteEditMode((value) => !value);
                                setNoteError("");
                              }}
                            >
                              {noteEditMode ? (
                                <>
                                  <Eye size={13} />
                                  Preview
                                </>
                              ) : (
                                <>
                                  <Edit3 size={13} />
                                  Edit
                                </>
                              )}
                            </button>
                          )}
                          {noteEditMode && selectedNoteEditable && (
                            <>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  setNoteEditContent(noteOriginalContent);
                                  setNoteEditMode(false);
                                  setNoteError("");
                                }}
                                disabled={!selectedNoteDirty}
                              >
                                <X size={13} />
                                Reset
                              </button>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => void handleSaveVaultNote()}
                                disabled={
                                  !selectedNoteDirty ||
                                  noteSaveStatus === "saving"
                                }
                              >
                                <Save size={13} />
                                {noteSaveStatus === "saving"
                                  ? "Saving"
                                  : "Save"}
                              </button>
                            </>
                          )}
                          {!noteEditMode && (
                            <>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() =>
                                  void window.hermesAPI.openLocalPath(
                                    selectedNote.path,
                                  )
                                }
                              >
                                Open
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() =>
                                  void window.hermesAPI.revealLocalPath(
                                    selectedNote.path,
                                  )
                                }
                              >
                                Reveal
                              </button>
                            </>
                          )}
                        </div>
                      </header>
                      {noteSaveStatus === "saved" && (
                        <div className="memory-vault-save-status">
                          <Check size={13} /> Saved
                        </div>
                      )}
                      {noteError && (
                        <div className="memory-error">{noteError}</div>
                      )}
                      {noteEditMode && selectedNoteEditable ? (
                        <textarea
                          className="memory-vault-editor"
                          value={noteEditContent}
                          onChange={(event) => {
                            setNoteEditContent(event.target.value);
                            setNoteSaveStatus("idle");
                            setNoteError("");
                          }}
                          spellCheck={isMarkdownDocument(selectedNote)}
                        />
                      ) : selectedNote.content ? (
                        <div className="memory-vault-readable">
                          {isMarkdownDocument(selectedNote) ? (
                            <div className="memory-vault-markdown">
                              <AgentMarkdown>
                                {readableContent(selectedNote)}
                              </AgentMarkdown>
                            </div>
                          ) : isJsonDocument(selectedNote) ? (
                            <pre className="memory-vault-json">
                              {readableContent(selectedNote)}
                            </pre>
                          ) : (
                            <pre className="memory-vault-note">
                              {readableContent(selectedNote)}
                            </pre>
                          )}
                        </div>
                      ) : selectedNote.kind === "image" &&
                        selectedNote.fileUrl ? (
                        <img
                          className="memory-vault-image"
                          src={selectedNote.fileUrl}
                          alt={selectedNote.name}
                        />
                      ) : selectedNote.kind === "pdf" &&
                        selectedNote.fileUrl ? (
                        <iframe
                          className="memory-vault-pdf"
                          src={selectedNote.fileUrl}
                          title={selectedNote.name}
                        />
                      ) : (
                        <div className="memory-empty">
                          <p>{selectedNote.error || "Preview unavailable."}</p>
                        </div>
                      )}
                      {selectedNote.truncated && (
                        <div className="memory-vault-footnote">
                          Preview truncated at the desktop safety limit.
                        </div>
                      )}
                    </article>
                  ) : (
                    <div className="memory-empty memory-vault-front-page">
                      <BookOpen size={34} />
                      <p>Second Brain Index</p>
                      <p className="memory-empty-hint">
                        Pick a file from the vault index to read it like a wiki
                        page.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Agent Memory Entries */}
        {tab === "entries" && (
          <div className="memory-entries">
            <div className="memory-entries-header">
              <span className="memory-entries-count">
                {t("memory.entries", { count: data.memory.entries.length })}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowAdd(!showAdd)}
              >
                <Plus size={13} />
                {t("memory.addMemory")}
              </button>
            </div>

            {showAdd && (
              <div className="memory-entry-form">
                <textarea
                  className="memory-entry-textarea"
                  value={newEntry}
                  onChange={(e) => setNewEntry(e.target.value)}
                  placeholder={t("memory.entriesPlaceholder")}
                  rows={3}
                  autoFocus
                />
                <div className="memory-entry-form-actions">
                  <span className="memory-entry-chars">
                    {newEntry.length} chars
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setShowAdd(false);
                      setNewEntry("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleAddEntry}
                    disabled={!newEntry.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {data.memory.entries.length === 0 ? (
              <div className="memory-empty">
                <p>{t("memory.noMemoriesYet")}</p>
                <p className="memory-empty-hint">
                  {t("memory.addManuallyHint")}
                </p>
              </div>
            ) : (
              data.memory.entries.map((entry) => (
                <div key={entry.index} className="memory-entry-card">
                  {editingIndex === entry.index ? (
                    <div className="memory-entry-form">
                      <textarea
                        className="memory-entry-textarea"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                      <div className="memory-entry-form-actions">
                        <span className="memory-entry-chars">
                          {t("memory.chars", { count: editContent.length })}
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditingIndex(null)}
                        >
                          {t("memory.cancel")}
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleSaveEdit}
                        >
                          {t("memory.save")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="memory-entry-content">
                        {entry.content}
                      </div>
                      <div className="memory-entry-actions">
                        <button
                          className="btn-ghost memory-entry-btn"
                          onClick={() => {
                            setEditingIndex(entry.index);
                            setEditContent(entry.content);
                          }}
                        >
                          {t("memory.edit")}
                        </button>
                        {confirmDelete === entry.index ? (
                          <span className="memory-entry-confirm">
                            {t("memory.deleteConfirm")}
                            <button
                              className="btn-ghost"
                              style={{ color: "var(--error)" }}
                              onClick={() => handleDeleteEntry(entry.index)}
                            >
                              {t("memory.yes")}
                            </button>
                            <button
                              className="btn-ghost"
                              onClick={() => setConfirmDelete(null)}
                            >
                              {t("memory.no")}
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn-ghost memory-entry-btn"
                            onClick={() => setConfirmDelete(entry.index)}
                          >
                            <Trash size={13} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* User Profile */}
        {tab === "profile" && (
          <div className="memory-profile">
            <div className="memory-profile-header">
              <span className="memory-profile-hint">
                {t("memory.userProfileHint")}
              </span>
              {userSaved && (
                <span
                  style={{
                    color: "var(--success)",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {t("common.saved")}
                </span>
              )}
            </div>
            <textarea
              className="memory-profile-textarea"
              value={userContent}
              onChange={(e) => {
                setUserContent(e.target.value);
                setUserEditing(true);
              }}
              placeholder={t("memory.userProfilePlaceholder")}
              rows={8}
            />
            <div className="memory-profile-footer">
              <span className="memory-entry-chars">
                {t("memory.chars", { count: userContent.length })} /{" "}
                {data.user.charLimit}{" "}
                {t("memory.chars", { count: 1 }).split(" ")[1]}
              </span>
              {userEditing && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveUserProfile}
                >
                  {t("memory.saveProfile")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Memory Providers */}
        {tab === "providers" && (
          <div className="memory-providers">
            <div className="memory-providers-hint">
              {t("memory.providersHint")}
              {memoryProvider ? (
                <span>
                  {" "}
                  {t("memory.active")}: <strong>{memoryProvider}</strong>
                </span>
              ) : (
                <span> {t("memory.providersHintInactive")}</span>
              )}
            </div>

            {providers.length === 0 ? (
              <div className="memory-empty">
                <p>{t("memory.noProvidersFound")}</p>
              </div>
            ) : (
              <div className="memory-providers-grid">
                {providers.map((p) => (
                  <div
                    key={p.name}
                    className={`memory-provider-card ${p.active ? "memory-provider-active" : ""}`}
                  >
                    <div className="memory-provider-header">
                      <div className="memory-provider-name">
                        {p.name}
                        {p.active && (
                          <span className="memory-provider-badge">
                            <Check size={10} /> {t("memory.active")}
                          </span>
                        )}
                      </div>
                      {PROVIDER_URLS[p.name] && (
                        <button
                          className="btn-ghost"
                          style={{ padding: 2, opacity: 0.6 }}
                          onClick={() =>
                            window.hermesAPI.openExternal(PROVIDER_URLS[p.name])
                          }
                          title={t("memory.openProviderWebsite")}
                        >
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                    <div className="memory-provider-desc">
                      {t(p.description)}
                    </div>

                    {/* Env var config fields */}
                    {p.envVars.length > 0 && (
                      <div className="memory-provider-fields">
                        {p.envVars.map((envKey) => (
                          <div key={envKey} className="memory-provider-field">
                            <label className="memory-provider-field-label">
                              {envKey}
                              {providerSavedKey === envKey && (
                                <span
                                  style={{
                                    color: "var(--success)",
                                    fontSize: 10,
                                    marginLeft: 6,
                                  }}
                                >
                                  {t("common.saved")}
                                </span>
                              )}
                            </label>
                            <input
                              className="input"
                              type="password"
                              value={providerEnv[envKey] || ""}
                              onChange={(e) =>
                                setProviderEnv((prev) => ({
                                  ...prev,
                                  [envKey]: e.target.value,
                                }))
                              }
                              onBlur={async () => {
                                await window.hermesAPI.setEnv(
                                  envKey,
                                  providerEnv[envKey] || "",
                                  profile,
                                );
                                setProviderSavedKey(envKey);
                                setTimeout(
                                  () => setProviderSavedKey(null),
                                  2000,
                                );
                              }}
                              placeholder={t("memory.enterEnvKey", {
                                key: envKey,
                              })}
                              style={{ fontSize: 12 }}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="memory-provider-actions">
                      {p.active ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={async () => {
                            setActivating(p.name);
                            await window.hermesAPI.setConfig(
                              "memory.provider",
                              "",
                              profile,
                            );
                            setMemoryProvider(null);
                            setProviders((prev) =>
                              prev.map((pr) => ({ ...pr, active: false })),
                            );
                            setActivating(null);
                          }}
                          disabled={activating !== null}
                        >
                          {t("memory.deactivate")}
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={async () => {
                            setActivating(p.name);
                            await window.hermesAPI.setConfig(
                              "memory.provider",
                              p.name,
                              profile,
                            );
                            setMemoryProvider(p.name);
                            setProviders((prev) =>
                              prev.map((pr) => ({
                                ...pr,
                                active: pr.name === p.name,
                              })),
                            );
                            setActivating(null);
                          }}
                          disabled={activating !== null}
                        >
                          {activating === p.name
                            ? t("memory.activating")
                            : t("memory.activate")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Memory;
