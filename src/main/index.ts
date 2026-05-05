import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  dialog,
  shell,
} from "electron";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "path";
import { homedir, tmpdir } from "os";
import { pathToFileURL, fileURLToPath } from "url";
import { execFile } from "child_process";
import http from "http";
import https from "https";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";
import icon from "../../resources/icon.png?asset";

interface AppNotificationPayload {
  title: string;
  body?: string;
  tone?: "info" | "success" | "warning" | "error";
  createdAt?: number;
}

/** Allowlist: only http, https, and mailto URLs for security. */
function safeOpenExternal(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      shell.openExternal(url);
      return true;
    }
  } catch {
    // invalid URL — silently ignore
  }
  return false;
}

function isRendererNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:" || parsed.protocol === "devtools:") {
      return true;
    }
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      return (
        parsed.origin === new URL(process.env["ELECTRON_RENDERER_URL"]).origin
      );
    }
  } catch {
    return false;
  }
  return false;
}

function sendAppNotification(payload: AppNotificationPayload): void {
  mainWindow?.webContents.send("app-notification", {
    ...payload,
    createdAt: payload.createdAt ?? Date.now(),
    tone: payload.tone ?? "info",
  });
}

function showAgentNotification(
  payload: AppNotificationPayload,
  native = false,
): void {
  sendAppNotification(payload);
  if (!native || !Notification.isSupported()) return;
  new Notification({
    title: payload.title,
    body: payload.body,
  }).show();
}

function checkApiHealth(
  url: string,
  apiKey?: string,
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  return new Promise((resolve) => {
    try {
      const healthUrl = new URL("/health", url);
      const mod = healthUrl.protocol === "https:" ? https : http;
      const req = mod.request(
        healthUrl,
        {
          method: "GET",
          timeout: 2500,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        },
        (res) => {
          res.resume();
          resolve({
            ok: res.statusCode === 200,
            status: res.statusCode || null,
          });
        },
      );
      req.on("error", (error) =>
        resolve({ ok: false, status: null, error: error.message }),
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: null, error: "timeout" });
      });
      req.end();
    } catch (error) {
      resolve({
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : "invalid URL",
      });
    }
  });
}

import {
  startBrowserService,
  stopBrowserService,
  navigateTo,
  getBrowserState,
} from "./playwright";
import {
  checkInstallStatus,
  runInstall,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  checkOpenClawExists,
  runClawMigrate,
  runHermesBackup,
  runHermesImport,
  runHermesDump,
  runHermesUpdateCheck,
  runHermesCurator,
  readCuratorReport,
  listMcpServers,
  discoverMemoryProviders,
  readLogs,
  InstallProgress,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  getEnhancedPath,
} from "./installer";
import * as fs from "fs";
import {
  sendMessage,
  startGateway,
  stopGateway,
  isGatewayRunning,
  isRemoteMode,
  testRemoteConnection,
  stopHealthPolling,
  restartGateway,
  getHermesCapabilities,
  startHermesRun,
  getHermesRun,
  stopHermesRun,
} from "./hermes";
import {
  getClaw3dStatus,
  setupClaw3d,
  startDevServer,
  stopDevServer,
  startAdapter,
  stopAdapter,
  startAll as startClaw3dAll,
  stopAll as stopClaw3d,
  getClaw3dLogs,
  setClaw3dPort,
  getClaw3dPort,
  setClaw3dWsUrl,
  getClaw3dWsUrl,
  Claw3dSetupProgress,
} from "./claw3d";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool,
  getConnectionConfig,
  setConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
} from "./config";
import { listSessions, getSessionMessages, searchSessions } from "./sessions";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "./session-cache";
import {
  listModels,
  listModelCatalog,
  addModel,
  removeModel,
  updateModel,
} from "./models";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "./profiles";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "./memory";
import { readSoul, writeSoul, resetSoul } from "./soul";
import { getToolsets, setToolsetEnabled } from "./tools";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
} from "./skills";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "./cronjobs";
import { getAppLocale, setAppLocale } from "./locale";

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
});

let mainWindow: BrowserWindow | null = null;
const activeChatAborts = new Map<string, () => void>();

interface WorkspaceFileChange {
  root: string;
  path: string;
  name: string;
  relativePath: string;
  event: string;
  size: number;
  modifiedAt: number;
}

interface WorkspaceWatcherState {
  root: string;
  watchers: Map<string, fs.FSWatcher>;
  pending: Map<string, NodeJS.Timeout>;
  closed: boolean;
}

const MAX_WORKSPACE_WATCH_DIRS = 1200;
const WATCH_IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".parcel-cache",
  ".turbo",
  ".vite",
  "android",
  "build",
  "coverage",
  "dist",
  "ios",
  "linux-unpacked",
  "node_modules",
  "out",
  "release",
  "target",
  "vendor",
]);

let workspaceWatcher: WorkspaceWatcherState | null = null;

type DocumentPreviewKind =
  | "text"
  | "markdown"
  | "image"
  | "pdf"
  | "office"
  | "directory"
  | "binary"
  | "missing";

interface DocumentPreview {
  path: string;
  name: string;
  exists: boolean;
  kind: DocumentPreviewKind;
  size: number;
  fileUrl?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
}

interface ObsidianVaultInfo {
  path: string | null;
  name: string;
  exists: boolean;
  noteCount: number;
  totalFiles: number;
}

function desktopConfigPath(): string {
  return join(HERMES_HOME, "desktop.json");
}

function readDesktopJson(): Record<string, unknown> {
  try {
    const file = desktopConfigPath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function writeDesktopJson(data: Record<string, unknown>): void {
  try {
    if (!fs.existsSync(HERMES_HOME))
      fs.mkdirSync(HERMES_HOME, { recursive: true });
    fs.writeFileSync(
      desktopConfigPath(),
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  } catch {
    // Desktop preferences are best-effort.
  }
}

function normalizeLocalPath(input: string): string {
  let targetPath = String(input || "").trim();
  targetPath = targetPath.replace(/^["'`]+|["'`]+$/g, "");
  if (targetPath.startsWith("file://")) {
    try {
      targetPath = fileURLToPath(targetPath);
    } catch {
      targetPath = decodeURIComponent(targetPath.replace(/^file:\/\//, ""));
    }
  }
  targetPath = targetPath.replace(/^~(?=\/|\\|$)/, homedir());
  return targetPath;
}

function localPathCandidates(input: string): string[] {
  const normalized = normalizeLocalPath(input);
  const withoutLineNumber = normalized.replace(/:\d+(?::\d+)?$/, "");
  const rawCandidates = [normalized, withoutLineNumber];
  const bases = [
    "",
    HERMES_REPO,
    HERMES_HOME,
    join(HERMES_HOME, "cache"),
    homedir(),
  ];
  const candidates: string[] = [];

  for (const raw of rawCandidates) {
    if (!raw) continue;
    if (isAbsolute(raw)) {
      candidates.push(raw);
      continue;
    }
    for (const base of bases) {
      candidates.push(base ? resolve(base, raw) : resolve(raw));
    }
  }

  return [...new Set(candidates)];
}

function resolveExistingLocalPath(input: string): string | null {
  for (const candidate of localPathCandidates(input)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function shouldIgnoreWatchPath(targetPath: string): boolean {
  const parts = targetPath.split(/[\\/]+/);
  return parts.some(
    (part) =>
      WATCH_IGNORED_DIRS.has(part) ||
      part.endsWith(".asar") ||
      part.endsWith(".tmp"),
  );
}

function resolveWorkspaceRoot(input: string): string | null {
  const resolvedPath = resolveExistingLocalPath(input);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return null;
  try {
    const stat = fs.statSync(resolvedPath);
    return stat.isDirectory() ? resolvedPath : dirname(resolvedPath);
  } catch {
    return null;
  }
}

function emitWorkspaceFileChange(
  state: WorkspaceWatcherState,
  targetPath: string,
  event: string,
): void {
  if (state.closed || shouldIgnoreWatchPath(targetPath)) return;
  if (!fs.existsSync(targetPath)) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetPath);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    watchWorkspaceDirectory(state, targetPath);
    return;
  }
  if (!stat.isFile()) return;

  const payload: WorkspaceFileChange = {
    root: state.root,
    path: targetPath,
    name: basename(targetPath),
    relativePath: relative(state.root, targetPath) || basename(targetPath),
    event,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };

  mainWindow?.webContents.send("workspace-file-changed", payload);
}

function scheduleWorkspaceFileChange(
  state: WorkspaceWatcherState,
  targetPath: string,
  event: string,
): void {
  if (state.closed || shouldIgnoreWatchPath(targetPath)) return;
  const existing = state.pending.get(targetPath);
  if (existing) clearTimeout(existing);

  const timeout = setTimeout(() => {
    state.pending.delete(targetPath);
    emitWorkspaceFileChange(state, targetPath, event);
  }, 160);
  state.pending.set(targetPath, timeout);
}

function watchWorkspaceDirectory(
  state: WorkspaceWatcherState,
  dirPath: string,
): void {
  if (
    state.closed ||
    state.watchers.has(dirPath) ||
    state.watchers.size >= MAX_WORKSPACE_WATCH_DIRS ||
    shouldIgnoreWatchPath(dirPath)
  ) {
    return;
  }

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dirPath, { persistent: false }, (event, filename) => {
      if (!filename) return;
      const changedPath = resolve(dirPath, filename.toString());
      scheduleWorkspaceFileChange(state, changedPath, event);
    });
  } catch {
    return;
  }

  watcher.on("error", () => {
    try {
      watcher.close();
    } catch {
      // watcher is already closed
    }
    state.watchers.delete(dirPath);
  });
  state.watchers.set(dirPath, watcher);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    watchWorkspaceDirectory(state, join(dirPath, entry.name));
    if (state.watchers.size >= MAX_WORKSPACE_WATCH_DIRS) break;
  }
}

function startWorkspaceWatch(targetPath: string): boolean {
  stopWorkspaceWatch();
  const root = resolveWorkspaceRoot(targetPath);
  if (!root) return false;

  const state: WorkspaceWatcherState = {
    root,
    watchers: new Map(),
    pending: new Map(),
    closed: false,
  };
  workspaceWatcher = state;
  watchWorkspaceDirectory(state, root);
  return state.watchers.size > 0;
}

function stopWorkspaceWatch(): void {
  if (!workspaceWatcher) return;
  workspaceWatcher.closed = true;
  for (const timeout of workspaceWatcher.pending.values()) {
    clearTimeout(timeout);
  }
  workspaceWatcher.pending.clear();
  for (const watcher of workspaceWatcher.watchers.values()) {
    try {
      watcher.close();
    } catch {
      // best-effort cleanup
    }
  }
  workspaceWatcher.watchers.clear();
  workspaceWatcher = null;
}

function isTextPreviewExtension(extension: string): boolean {
  return [
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".css",
    ".scss",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".sh",
    ".zsh",
    ".bash",
    ".log",
  ].includes(extension);
}

function isEditableDocumentExtension(extension: string): boolean {
  return [
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
  ].includes(extension);
}

function writeDocumentContent(
  targetPath: string,
  content: string,
): { success: boolean; error?: string; path?: string } {
  const resolvedPath = resolveExistingLocalPath(targetPath);
  if (!resolvedPath) {
    return { success: false, error: "File not found." };
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    return { success: false, error: "Cannot edit a directory." };
  }

  const extension = extname(resolvedPath).toLowerCase();
  if (!isEditableDocumentExtension(extension)) {
    return { success: false, error: "This file type is read-only here." };
  }

  if (content.length > 1024 * 1024 * 2) {
    return { success: false, error: "File is too large to save safely." };
  }

  if (extension === ".json") {
    try {
      JSON.parse(content || "null");
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? `Invalid JSON: ${error.message}`
            : "Invalid JSON.",
      };
    }
  }

  try {
    fs.writeFileSync(resolvedPath, content, "utf-8");
    return { success: true, path: resolvedPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Save failed.",
    };
  }
}

function runHermesPythonJson(
  script: string,
  args: string[],
  timeout = 60000,
): Promise<Record<string, unknown>> {
  return new Promise((resolveResult) => {
    execFile(
      HERMES_PYTHON,
      ["-c", script, ...args],
      {
        cwd: HERMES_REPO,
        timeout,
        maxBuffer: 1024 * 1024 * 4,
        env: {
          ...process.env,
          HOME: homedir(),
          HERMES_HOME,
          PATH: getEnhancedPath(),
          PYTHONUNBUFFERED: "1",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          resolveResult({
            success: false,
            error: stderr?.trim() || error.message,
          });
          return;
        }
        try {
          resolveResult(JSON.parse(stdout.trim()));
        } catch {
          resolveResult({
            success: false,
            error: stdout.trim() || "No output",
          });
        }
      },
    );
  });
}

async function extractOfficePreview(filePath: string): Promise<string> {
  const script = String.raw`
import html
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]

def text_from_xml(blob):
    try:
        root = ET.fromstring(blob)
        text = " ".join(t.strip() for t in root.itertext() if t and t.strip())
        return html.unescape(re.sub(r"\s+", " ", text)).strip()
    except Exception:
        return ""

def read_member(zf, name):
    try:
        return zf.read(name)
    except KeyError:
        return b""

items = []
try:
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        lower = path.lower()
        if lower.endswith(".docx"):
            for name in ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]:
                text = text_from_xml(read_member(zf, name))
                if text:
                    items.append(text)
        elif lower.endswith(".pptx"):
            for name in sorted(n for n in names if n.startswith("ppt/slides/slide") and n.endswith(".xml")):
                text = text_from_xml(read_member(zf, name))
                if text:
                    items.append(text)
        elif lower.endswith(".xlsx"):
            shared = []
            shared_xml = read_member(zf, "xl/sharedStrings.xml")
            if shared_xml:
                try:
                    root = ET.fromstring(shared_xml)
                    shared = [" ".join(t.strip() for t in si.itertext() if t and t.strip()) for si in root]
                except Exception:
                    shared = []
            for name in sorted(n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))[:5]:
                xml = read_member(zf, name)
                try:
                    root = ET.fromstring(xml)
                    values = []
                    for cell in root.iter():
                        if cell.tag.endswith("}c") or cell.tag == "c":
                            cell_type = cell.attrib.get("t")
                            value = ""
                            for child in cell:
                                if child.tag.endswith("}v") or child.tag == "v":
                                    value = child.text or ""
                                    break
                            if cell_type == "s" and value.isdigit() and int(value) < len(shared):
                                value = shared[int(value)]
                            if value:
                                values.append(value)
                    if values:
                        items.append(" | ".join(values[:80]))
                except Exception:
                    pass
    print(json.dumps({"success": True, "content": "\n\n".join(items)[:60000]}))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
`;
  const result = await runHermesPythonJson(script, [filePath], 15000);
  if (result.success && typeof result.content === "string")
    return result.content;
  return "";
}

async function getDocumentPreview(
  targetPath: string,
): Promise<DocumentPreview> {
  const resolvedPath = resolveExistingLocalPath(targetPath);
  const fallbackName = basename(normalizeLocalPath(targetPath)) || "document";
  if (!resolvedPath) {
    return {
      path: normalizeLocalPath(targetPath),
      name: fallbackName,
      exists: false,
      kind: "missing",
      size: 0,
      error: "File not found",
    };
  }

  const stat = fs.statSync(resolvedPath);
  const name = basename(resolvedPath);
  if (stat.isDirectory()) {
    return {
      path: resolvedPath,
      name,
      exists: true,
      kind: "directory",
      size: stat.size,
      fileUrl: pathToFileURL(resolvedPath).toString(),
    };
  }

  const extension = extname(resolvedPath).toLowerCase();
  const base = {
    path: resolvedPath,
    name,
    exists: true,
    size: stat.size,
    fileUrl: pathToFileURL(resolvedPath).toString(),
  };

  if (
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(
      extension,
    )
  ) {
    return { ...base, kind: "image" };
  }
  if (extension === ".pdf") return { ...base, kind: "pdf" };

  if ([".docx", ".pptx", ".xlsx"].includes(extension)) {
    const content = await extractOfficePreview(resolvedPath);
    return {
      ...base,
      kind: "office",
      content,
      truncated: content.length >= 60000,
      error: content ? undefined : "No readable document text found",
    };
  }

  if (isTextPreviewExtension(extension) || stat.size <= 512 * 1024) {
    const maxBytes = 120 * 1024;
    const buffer = fs.readFileSync(resolvedPath);
    if (buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0)) {
      return { ...base, kind: "binary" };
    }
    const content = buffer.subarray(0, maxBytes).toString("utf-8");
    return {
      ...base,
      kind:
        extension === ".md" || extension === ".markdown" ? "markdown" : "text",
      content,
      truncated: buffer.length > maxBytes,
    };
  }

  return { ...base, kind: "binary" };
}

function countVaultFiles(root: string): {
  noteCount: number;
  totalFiles: number;
} {
  let noteCount = 0;
  let totalFiles = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".obsidian") continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else {
        totalFiles++;
        if (entry.name.toLowerCase().endsWith(".md")) noteCount++;
      }
      if (totalFiles > 5000) return { noteCount, totalFiles };
    }
  }
  return { noteCount, totalFiles };
}

function getObsidianVaultInfo(): ObsidianVaultInfo {
  const desktop = readDesktopJson();
  const configured =
    typeof desktop.obsidianVaultPath === "string"
      ? desktop.obsidianVaultPath
      : "";
  const candidates = [
    configured,
    process.env.OBSIDIAN_VAULT_PATH || "",
    join(homedir(), "obsidian-vault"),
    join(homedir(), "Documents", "Obsidian Vault"),
    join(HERMES_HOME, "obsidian-vault"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolvedPath = resolveExistingLocalPath(candidate);
    if (!resolvedPath) continue;
    try {
      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) continue;
      const counts = countVaultFiles(resolvedPath);
      return {
        path: resolvedPath,
        name: basename(resolvedPath),
        exists: true,
        ...counts,
      };
    } catch {
      // Try next candidate.
    }
  }

  return {
    path: null,
    name: "Obsidian Vault",
    exists: false,
    noteCount: 0,
    totalFiles: 0,
  };
}

function writeFloatWav(filePath: string, samples: number[]): void {
  const numSamples = samples.length;
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * 2;
  const fileSize = 36 + dataSize;

  const wavHeader = Buffer.alloc(44);
  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(fileSize, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(dataSize, 40);

  const audioBuf = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    audioBuf.writeInt16LE(Math.round(s * 32767), i * 2);
  }

  fs.writeFileSync(filePath, Buffer.concat([wavHeader, audioBuf]));
}

function audioExtensionFromMime(mimeType: string): string {
  if (/ogg/i.test(mimeType)) return ".ogg";
  if (/wav/i.test(mimeType)) return ".wav";
  if (/mpeg|mp3/i.test(mimeType)) return ".mp3";
  if (/mp4|m4a/i.test(mimeType)) return ".m4a";
  return ".webm";
}

async function transcribeAudioFile(filePath: string): Promise<string> {
  const script = String.raw`
import json
import sys
from tools.transcription_tools import transcribe_audio

result = transcribe_audio(sys.argv[1])
print(json.dumps(result, ensure_ascii=False))
`;
  const result = await runHermesPythonJson(script, [filePath], 180000);
  if (result.success && typeof result.transcript === "string") {
    return result.transcript.trim();
  }
  return "";
}

async function synthesizeSpeech(text: string): Promise<string> {
  const outputPath = join(
    tmpdir(),
    "80m-voice",
    `tts_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`,
  );
  fs.mkdirSync(dirname(outputPath), { recursive: true });

  const script = String.raw`
import asyncio
import json
import sys

text = sys.argv[1]
output_path = sys.argv[2]

try:
    from tools.tts_tool import text_to_speech_tool
    result = json.loads(text_to_speech_tool(text, output_path))
    if result.get("success") and result.get("file_path"):
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0)
except Exception as exc:
    last_error = str(exc)
else:
    last_error = "Hermes TTS returned no audio"

try:
    import edge_tts
    async def main():
        communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
        await communicate.save(output_path)
    asyncio.run(main())
    print(json.dumps({"success": True, "file_path": output_path, "provider": "edge-fallback"}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"success": False, "error": f"{last_error}; edge fallback failed: {exc}"}, ensure_ascii=False))
`;
  const result = await runHermesPythonJson(script, [text, outputPath], 90000);
  if (result.success && typeof result.file_path === "string") {
    return result.file_path;
  }
  return "";
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    title: "80m Agent Desktop",
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show();
  });

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window-maximized", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window-maximized", false);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[CRASH] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
  });

  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(`[RENDERER ERROR] ${message} (${sourceId}:${line})`);
      }
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[LOAD FAIL]", errorCode, errorDescription);
    },
  );

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (safeOpenExternal(details.url)) {
      sendAppNotification({
        title: "Opened outside",
        body: details.url,
        tone: "info",
      });
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isRendererNavigation(url)) return;
    event.preventDefault();
    if (safeOpenExternal(url)) {
      sendAppNotification({
        title: "Opened outside",
        body: url,
        tone: "info",
      });
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function setupIPC(): void {
  // Installation
  ipcMain.handle("check-install", () => {
    return checkInstallStatus();
  });

  ipcMain.handle("start-install", async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Hermes engine info
  ipcMain.handle("get-hermes-version", async () => getHermesVersion());
  ipcMain.handle("refresh-hermes-version", async () => {
    clearVersionCache();
    return getHermesVersion();
  });
  ipcMain.handle("run-hermes-doctor", () => runHermesDoctor());
  ipcMain.handle("run-hermes-update", async (event) => {
    try {
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
  ipcMain.handle("run-hermes-update-check", () => runHermesUpdateCheck());
  ipcMain.handle("run-safe-hermes-upgrade", async (event, profile?: string) => {
    let log = "";
    const emit = (title: string, detail: string): void => {
      log += `${title}: ${detail}\n`;
      event.sender.send("install-progress", {
        step: 1,
        totalSteps: 3,
        title,
        detail,
        log,
      } satisfies InstallProgress);
    };

    try {
      emit("Backing up Hermes", "Creating a pre-upgrade snapshot.");
      const backup = await runHermesBackup(profile);
      if (!backup.success) {
        return {
          success: false,
          error: backup.error || "Backup failed.",
          backup,
        };
      }

      emit("Checking for update", "Running hermes update --check.");
      const check = await runHermesUpdateCheck();

      emit("Updating Hermes", "Running hermes update.");
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send("install-progress", {
          ...progress,
          step: 3,
          totalSteps: 3,
          log: `${log}${progress.log}`,
        });
      });
      clearVersionCache();

      return {
        success: true,
        backupPath: backup.path,
        updateAvailable: check.updateAvailable,
        checkOutput: check.output,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
  ipcMain.handle("get-hermes-capabilities", (_event, profile?: string) =>
    getHermesCapabilities(profile),
  );

  // OpenClaw migration
  ipcMain.handle("check-openclaw", () => checkOpenClawExists());
  ipcMain.handle("run-claw-migrate", async (event) => {
    try {
      await runClawMigrate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Configuration (profile-aware)
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: "en" | "zh-CN") =>
    setAppLocale(locale),
  );

  ipcMain.handle("get-env", (_event, profile?: string) => readEnv(profile));

  ipcMain.handle(
    "set-env",
    (_event, key: string, value: string, profile?: string) => {
      setEnvValue(key, value, profile);
      // Restart gateway so it picks up the new API key
      if (
        (isGatewayRunning() && key.endsWith("_API_KEY")) ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN"
      ) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle("get-config", (_event, key: string, profile?: string) =>
    getConfigValue(key, profile),
  );

  ipcMain.handle(
    "set-config",
    (_event, key: string, value: string, profile?: string) => {
      setConfigValue(key, value, profile);
      return true;
    },
  );

  ipcMain.handle("get-hermes-home", (_event, profile?: string) =>
    getHermesHome(profile),
  );

  ipcMain.handle("get-model-config", (_event, profile?: string) =>
    getModelConfig(profile),
  );

  ipcMain.handle(
    "set-model-config",
    (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);

      // Restart gateway when provider, model, or endpoint changes so it picks up new config
      if (
        isGatewayRunning() &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        restartGateway(profile);
      }

      return true;
    },
  );

  // Connection mode (local vs remote)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("get-connection-config", () => getConnectionConfig());

  ipcMain.handle(
    "set-connection-config",
    (_event, mode: "local" | "remote", remoteUrl: string, apiKey?: string) => {
      setConnectionConfig({ mode, remoteUrl, apiKey: apiKey || "" });
      return true;
    },
  );

  ipcMain.handle(
    "test-remote-connection",
    (_event, url: string, apiKey?: string) => testRemoteConnection(url, apiKey),
  );

  ipcMain.handle("get-hermes-health", async (_event, profile?: string) => {
    const install = checkInstallStatus();
    const connection = getConnectionConfig();
    const model = getModelConfig(profile);
    const env = readEnv(profile);
    const credentials = getCredentialPool();
    const credentialProviders = Object.entries(credentials)
      .filter(([, entries]) => entries.length > 0)
      .map(([provider, entries]) => ({ provider, count: entries.length }));
    const apiUrl =
      connection.mode === "remote" && connection.remoteUrl
        ? connection.remoteUrl
        : "http://127.0.0.1:8642";
    const apiKey =
      connection.mode === "remote" ? connection.apiKey : env.API_SERVER_KEY;
    const api = await checkApiHealth(apiUrl, apiKey);

    return {
      install,
      connection: {
        mode: connection.mode,
        remoteUrl: connection.remoteUrl,
        hasRemoteApiKey: Boolean(connection.apiKey),
      },
      gateway: {
        running: isGatewayRunning(),
        apiUrl,
        apiOk: api.ok,
        apiStatus: api.status,
        apiError: api.error || "",
        hasApiServerKey: Boolean(env.API_SERVER_KEY),
      },
      model,
      env: {
        hasMiniMaxKey: Boolean(env.MINIMAX_API_KEY),
        hasMiniMaxCnKey: Boolean(env.MINIMAX_CN_API_KEY),
        hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
        hasXaiKey: Boolean(env.XAI_API_KEY),
        hasDashScopeKey: Boolean(env.DASHSCOPE_API_KEY),
      },
      credentialProviders,
    };
  });

  // Chat — lazy-start gateway on first message
  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
      activeProject?: string | null,
      requestId?: string,
    ) => {
      if (!isRemoteMode() && !isGatewayRunning()) {
        startGateway(profile);
      }

      const runId =
        requestId ||
        `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let fullResponse = "";
      const chatStartTime = Date.now();
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            event.sender.send("chat-chunk", chunk, runId);
          },
          onDone: (sessionId) => {
            activeChatAborts.delete(runId);
            event.sender.send("chat-done", sessionId || "", runId);
            resolveChat({ response: fullResponse, sessionId });
            // Desktop notification when window is not focused and response took >10s
            if (
              mainWindow &&
              !mainWindow.isFocused() &&
              Date.now() - chatStartTime > 10000
            ) {
              const preview = fullResponse
                .replace(/[#*_`~\n]+/g, " ")
                .trim()
                .slice(0, 80);
              showAgentNotification(
                {
                  title: "80m Agent",
                  body: preview || "Response ready",
                  tone: "success",
                },
                true,
              );
            }
          },
          onError: (error) => {
            activeChatAborts.delete(runId);
            event.sender.send("chat-error", error, runId);
            rejectChat(new Error(error));
            // Notify on error too if window not focused
            if (mainWindow && !mainWindow.isFocused()) {
              showAgentNotification(
                {
                  title: "80m Agent — Error",
                  body: error.slice(0, 100),
                  tone: "error",
                },
                true,
              );
            }
          },
          onToolProgress: (tool) => {
            event.sender.send("chat-tool-progress", tool, runId);
          },
          onUsage: (usage) => {
            event.sender.send("chat-usage", usage, runId);
          },
        },
        profile,
        resumeSessionId,
        history,
        activeProject,
      );

      activeChatAborts.set(runId, handle.abort);
      return promise;
    },
  );

  ipcMain.handle("abort-chat", (_event, requestId?: string) => {
    if (requestId) {
      activeChatAborts.get(requestId)?.();
      activeChatAborts.delete(requestId);
      return;
    }
    for (const abort of activeChatAborts.values()) {
      abort();
    }
    activeChatAborts.clear();
  });

  ipcMain.handle("open-local-path", async (_event, targetPath: string) => {
    const resolvedPath = resolveExistingLocalPath(targetPath);
    if (!resolvedPath) return false;
    const error = await shell.openPath(resolvedPath);
    return !error;
  });

  ipcMain.handle("reveal-local-path", (_event, targetPath: string) => {
    const resolvedPath = resolveExistingLocalPath(targetPath);
    if (!resolvedPath) return false;
    shell.showItemInFolder(resolvedPath);
    return true;
  });

  ipcMain.handle("read-document-preview", (_event, targetPath: string) =>
    getDocumentPreview(targetPath),
  );

  ipcMain.handle(
    "write-document-content",
    (_event, targetPath: string, content: string) =>
      writeDocumentContent(targetPath, content),
  );

  ipcMain.handle("watch-workspace", (_event, targetPath: string) =>
    startWorkspaceWatch(targetPath),
  );

  ipcMain.handle("unwatch-workspace", () => {
    stopWorkspaceWatch();
    return true;
  });

  // File Sandbox
  ipcMain.handle(
    "copy-file-to-workspace",
    async (_event, sourcePath: string) => {
      try {
        const cacheDir = join(HERMES_HOME, "cache");
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        const filename = require("path").basename(sourcePath);
        const destPath = join(cacheDir, filename);
        await fs.promises.copyFile(sourcePath, destPath);
        return destPath;
      } catch (err) {
        console.error("Failed to copy file to workspace:", err);
        return null;
      }
    },
  );

  // Gateway
  ipcMain.handle("start-gateway", () => startGateway());
  ipcMain.handle("stop-gateway", () => {
    stopGateway(true);
    return true;
  });
  ipcMain.handle("gateway-status", () => isGatewayRunning());

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) =>
    getPlatformEnabled(profile),
  );
  ipcMain.handle(
    "set-platform-enabled",
    (_event, platform: string, enabled: boolean, profile?: string) => {
      setPlatformEnabled(platform, enabled, profile);
      // Restart gateway so it picks up the new platform config
      if (isGatewayRunning()) {
        restartGateway(profile);
      }
      return true;
    },
  );

  // Projects Sidebar IPC
  ipcMain.handle("select-project-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "Select Project Directory",
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle("read-directory", (_, dirPath) => {
    try {
      const resolvedPath = resolveExistingLocalPath(dirPath);
      if (!resolvedPath) return [];
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      return entries
        .filter((e) => e.name !== "node_modules" && e.name !== ".git")
        .map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          path: join(resolvedPath, e.name),
        }))
        .sort((a, b) => {
          // Directories first
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return [];
    }
  });

  ipcMain.handle("get-obsidian-vault", () => getObsidianVaultInfo());

  ipcMain.handle("set-obsidian-vault", (_event, vaultPath: string) => {
    const resolvedPath = resolveExistingLocalPath(vaultPath);
    if (!resolvedPath) return getObsidianVaultInfo();
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) return getObsidianVaultInfo();
    const desktop = readDesktopJson();
    desktop.obsidianVaultPath = resolvedPath;
    writeDesktopJson(desktop);
    return getObsidianVaultInfo();
  });

  // Sessions
  ipcMain.handle("list-sessions", (_event, limit?: number, offset?: number) => {
    return listSessions(limit, offset);
  });

  ipcMain.handle("get-session-messages", (_event, sessionId: string) => {
    return getSessionMessages(sessionId);
  });

  // Profiles
  ipcMain.handle("list-profiles", async () => listProfiles());
  ipcMain.handle("create-profile", (_event, name: string, clone: boolean) =>
    createProfile(name, clone),
  );
  ipcMain.handle("delete-profile", (_event, name: string) =>
    deleteProfile(name),
  );
  ipcMain.handle("set-active-profile", (_event, name: string) => {
    setActiveProfile(name);
    return true;
  });

  // Memory
  ipcMain.handle("read-memory", (_event, profile?: string) =>
    readMemory(profile),
  );
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) =>
      addMemoryEntry(content, profile),
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) =>
      updateMemoryEntry(index, content, profile),
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) =>
      removeMemoryEntry(index, profile),
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) =>
      writeUserProfile(content, profile),
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) => readSoul(profile));
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) => {
    return writeSoul(content, profile);
  });
  ipcMain.handle("reset-soul", (_event, profile?: string) =>
    resetSoul(profile),
  );

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) =>
    getToolsets(profile),
  );
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) => {
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // Skills
  ipcMain.handle("list-installed-skills", (_event, profile?: string) =>
    listInstalledSkills(profile),
  );
  ipcMain.handle("list-bundled-skills", () => listBundledSkills());
  ipcMain.handle("get-skill-content", (_event, skillPath: string) =>
    getSkillContent(skillPath),
  );
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, profile?: string) =>
      installSkill(identifier, profile),
  );
  ipcMain.handle("uninstall-skill", (_event, name: string, profile?: string) =>
    uninstallSkill(name, profile),
  );

  // ─── Voice: STT + TTS via Hermes' configured voice stack ────────────────

  ipcMain.handle(
    "transcribe-audio",
    async (
      _event,
      audioData: number[],
      mimeType = "audio/webm",
    ): Promise<string> => {
      const cacheDir = join(tmpdir(), "80m-voice");
      fs.mkdirSync(cacheDir, { recursive: true });
      const extension = audioExtensionFromMime(mimeType);
      const audioPath = join(
        cacheDir,
        `rec_${Date.now()}_${Math.random().toString(16).slice(2)}${extension}`,
      );

      try {
        if (mimeType === "audio/x-raw-float32") {
          writeFloatWav(audioPath.replace(extension, ".wav"), audioData);
          return await transcribeAudioFile(
            audioPath.replace(extension, ".wav"),
          );
        }
        fs.writeFileSync(audioPath, Buffer.from(audioData));
        return await transcribeAudioFile(audioPath);
      } catch (error) {
        console.warn("[VOICE] Transcription failed:", error);
        return "";
      } finally {
        try {
          if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
          const wavPath = audioPath.replace(extension, ".wav");
          if (wavPath !== audioPath && fs.existsSync(wavPath))
            fs.unlinkSync(wavPath);
        } catch {
          // Best-effort temp cleanup.
        }
      }
    },
  );

  ipcMain.handle("tts-speak", async (_event, text: string): Promise<string> => {
    const cleanText = String(text || "").trim();
    if (!cleanText) return "";
    try {
      return await synthesizeSpeech(cleanText);
    } catch (error) {
      console.warn("[VOICE] TTS failed:", error);
      return "";
    }
  });

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number) =>
      listCachedSessions(limit, offset),
  );
  ipcMain.handle("sync-session-cache", () => syncSessionCache());
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string) =>
      updateSessionTitle(sessionId, title),
  );

  // Session search
  ipcMain.handle("search-sessions", (_event, query: string, limit?: number) =>
    searchSessions(query, limit),
  );

  // Credential Pool
  ipcMain.handle("get-credential-pool", () => getCredentialPool());
  ipcMain.handle(
    "set-credential-pool",
    (
      _event,
      provider: string,
      entries: Array<{ key: string; label: string }>,
    ) => {
      setCredentialPool(provider, entries);
      return true;
    },
  );

  // Models
  ipcMain.handle("list-models", () => listModels());
  ipcMain.handle("list-model-catalog", () => listModelCatalog());
  ipcMain.handle(
    "add-model",
    (_event, name: string, provider: string, model: string, baseUrl: string) =>
      addModel(name, provider, model, baseUrl),
  );
  ipcMain.handle("remove-model", (_event, id: string) => removeModel(id));
  ipcMain.handle(
    "update-model",
    (_event, id: string, fields: Record<string, string>) =>
      updateModel(id, fields),
  );

  // Claw3D
  ipcMain.handle("claw3d-status", () => getClaw3dStatus());

  ipcMain.handle("claw3d-setup", async (event) => {
    try {
      await setupClaw3d((progress: Claw3dSetupProgress) => {
        event.sender.send("claw3d-setup-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("claw3d-get-port", () => getClaw3dPort());
  ipcMain.handle("claw3d-set-port", (_event, port: number) => {
    setClaw3dPort(port);
    return true;
  });
  ipcMain.handle("claw3d-get-ws-url", () => getClaw3dWsUrl());
  ipcMain.handle("claw3d-set-ws-url", (_event, url: string) => {
    setClaw3dWsUrl(url);
    return true;
  });

  ipcMain.handle("claw3d-start-all", () => startClaw3dAll());
  ipcMain.handle("claw3d-stop-all", () => {
    stopClaw3d();
    return true;
  });
  ipcMain.handle("claw3d-get-logs", () => getClaw3dLogs());

  ipcMain.handle("claw3d-start-dev", () => startDevServer());
  ipcMain.handle("claw3d-stop-dev", () => {
    stopDevServer();
    return true;
  });
  ipcMain.handle("claw3d-start-adapter", () => startAdapter());
  ipcMain.handle("claw3d-stop-adapter", () => {
    stopAdapter();
    return true;
  });

  // Cron Jobs
  ipcMain.handle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  ipcMain.handle(
    "create-cron-job",
    (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) => createCronJob(schedule, prompt, name, deliver, profile),
  );
  ipcMain.handle("remove-cron-job", (_event, jobId: string, profile?: string) =>
    removeCronJob(jobId, profile),
  );
  ipcMain.handle("pause-cron-job", (_event, jobId: string, profile?: string) =>
    pauseCronJob(jobId, profile),
  );
  ipcMain.handle("resume-cron-job", (_event, jobId: string, profile?: string) =>
    resumeCronJob(jobId, profile),
  );
  ipcMain.handle(
    "trigger-cron-job",
    (_event, jobId: string, profile?: string) => triggerCronJob(jobId, profile),
  );

  // Shell
  ipcMain.handle("open-external", (_event, url: string) => {
    if (safeOpenExternal(url)) {
      sendAppNotification({
        title: "Opened outside",
        body: url,
        tone: "info",
      });
    }
  });
  ipcMain.handle("window-minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window-toggle-maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window-close", () => {
    mainWindow?.close();
  });
  ipcMain.handle(
    "window-is-maximized",
    () => mainWindow?.isMaximized() ?? false,
  );

  // Backup / Import
  ipcMain.handle("run-hermes-backup", (_event, profile?: string) =>
    runHermesBackup(profile),
  );
  ipcMain.handle(
    "run-hermes-import",
    (_event, archivePath: string, profile?: string) =>
      runHermesImport(archivePath, profile),
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => runHermesDump());
  ipcMain.handle(
    "run-hermes-curator",
    (_event, action: string, skill?: string, profile?: string) =>
      runHermesCurator(action, skill, profile),
  );
  ipcMain.handle("read-curator-report", (_event, profile?: string) =>
    readCuratorReport(profile),
  );

  ipcMain.handle(
    "start-hermes-run",
    (
      _event,
      input: string,
      profile?: string,
      options?: {
        sessionId?: string;
        instructions?: string;
        previousResponseId?: string;
        conversationHistory?: Array<{ role: string; content: string }>;
      },
    ) => startHermesRun(input, profile, options),
  );
  ipcMain.handle("get-hermes-run", (_event, runId: string, profile?: string) =>
    getHermesRun(runId, profile),
  );
  ipcMain.handle("stop-hermes-run", (_event, runId: string, profile?: string) =>
    stopHermesRun(runId, profile),
  );

  // MCP servers
  ipcMain.handle("list-mcp-servers", (_event, profile?: string) =>
    listMcpServers(profile),
  );

  // Memory providers
  ipcMain.handle("discover-memory-providers", (_event, profile?: string) =>
    discoverMemoryProviders(profile),
  );

  // Log viewer
  ipcMain.handle("read-logs", (_event, logFile?: string, lines?: number) =>
    readLogs(logFile, lines),
  );

  // Playwright
  ipcMain.handle("start-browser", () => {
    if (mainWindow) {
      return startBrowserService(mainWindow);
    }
    return Promise.resolve();
  });
  ipcMain.handle("stop-browser", () => stopBrowserService());
  ipcMain.handle("navigate-browser", (_event, url: string) => navigateTo(url));
  ipcMain.handle("get-browser-state", () => getBrowserState());
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Chat",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: (): void => {
            mainWindow?.webContents.send("menu-new-chat");
          },
        },
        { type: "separator" },
        {
          label: "Search Sessions",
          accelerator: "CmdOrCtrl+K",
          click: (): void => {
            mainWindow?.webContents.send("menu-search-sessions");
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "80m Agent on GitHub",
          click: (): void => {
            safeOpenExternal(
              "https://github.com/guapdad4000/80m-agent-desktop",
            );
          },
        },
        {
          label: "Report an Issue",
          click: (): void => {
            safeOpenExternal(
              "https://github.com/guapdad4000/80m-agent-desktop/issues",
            );
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupUpdater(): void {
  // IPC handlers must always be registered to avoid invoke errors
  ipcMain.handle("get-app-version", () => app.getVersion());

  if (!app.isPackaged) {
    // Skip auto-update in dev mode
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // Dynamic import to avoid electron-updater issues in dev mode
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    mainWindow?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle("download-update", () => {
    autoUpdater.downloadUpdate();
    return true;
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

app.whenReady().then(() => {
  app.name = "Hermes";
  electronApp.setAppUserModelId("com.nousresearch.hermes");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  buildMenu();
  setupIPC();
  createWindow();
  setupUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopGateway();
    stopClaw3d();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopHealthPolling();
  for (const abort of activeChatAborts.values()) {
    abort();
  }
  activeChatAborts.clear();
  stopWorkspaceWatch();
  stopGateway();
  stopClaw3d();
  stopBrowserService();
});
