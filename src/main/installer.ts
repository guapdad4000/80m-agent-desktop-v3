import { spawn, execSync, execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { BrowserWindow } from "electron";
import { getModelConfig, getConnectionConfig } from "./config";
import { stripAnsi } from "./utils";
import { setupAskpass, type AskpassHandle } from "./askpass";
import {
  HOST_HOME,
  HERMES_ENV_FILE,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer-paths";
import {
  runHermesCommand,
  type HermesCommandResult,
} from "./installer-command";

export {
  HERMES_CONFIG_FILE,
  HERMES_ENV_FILE,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  HERMES_VENV,
  HOST_HOME,
  getEnhancedPath,
} from "./installer-paths";
export type { HermesCommandResult } from "./installer-command";
export {
  discoverMemoryProviders,
  getActiveMemoryProvider,
  listMcpServers,
  readCuratorReport,
  readLogs,
  runHermesBackup,
  runHermesCurator,
  runHermesDump,
  runHermesImport,
  validateHermesImportArchive,
} from "./installer-operations";
export type {
  CuratorCommandResult,
  CuratorReport,
  MemoryProviderInfo,
} from "./installer-operations";

export interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
}

export interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

export function checkInstallStatus(): InstallStatus {
  // Remote mode: skip local checks entirely
  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.remoteUrl) {
    return {
      installed: true,
      configured: true,
      hasApiKey: true,
      verified: true,
    };
  }

  // Fast path: file existence is enough to gate startup. The deep
  // Python check runs lazily through verifyInstall() after the UI is up.
  const installed = existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT);
  const configured = existsSync(HERMES_ENV_FILE);
  let hasApiKey = false;
  const verified = installed;

  // Local/custom providers don't need an API key
  try {
    const mc = getModelConfig();
    const localProviders = ["custom", "lmstudio", "ollama", "vllm", "llamacpp"];
    if (localProviders.includes(mc.provider)) {
      hasApiKey = true;
    }
  } catch {
    /* ignore */
  }

  if (!hasApiKey && configured) {
    try {
      const content = readFileSync(HERMES_ENV_FILE, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        const match = trimmed.match(
          /^(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=(.+)$/,
        );
        if (
          match &&
          match[2].trim() &&
          !['""', "''", ""].includes(match[2].trim())
        ) {
          hasApiKey = true;
          break;
        }
      }
    } catch {
      /* ignore read errors */
    }
  }

  return { installed, configured, hasApiKey, verified };
}

let _verifyCache: { ok: boolean; ts: number } | null = null;
const VERIFY_TTL_MS = 5 * 60 * 1000;

export async function verifyInstall(): Promise<boolean> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) return false;
  if (_verifyCache && Date.now() - _verifyCache.ts < VERIFY_TTL_MS) {
    return _verifyCache.ok;
  }

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "--version"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
        },
        timeout: 15000,
      },
      (error) => {
        const ok = !error;
        _verifyCache = { ok, ts: Date.now() };
        resolve(ok);
      },
    );
  });
}

// Cached version to avoid re-running the Python process
let _cachedVersion: string | null = null;
let _versionFetching = false;

export async function getHermesVersion(): Promise<string | null> {
  if (_cachedVersion !== null) return _cachedVersion;
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) return null;
  if (_versionFetching) {
    // Wait for in-flight fetch
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!_versionFetching) {
          clearInterval(check);
          resolve(_cachedVersion);
        }
      }, 100);
    });
  }
  _versionFetching = true;
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "--version"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
        },
        timeout: 15000,
      },
      (error, stdout) => {
        _versionFetching = false;
        if (error) {
          resolve(null);
        } else {
          _cachedVersion = stdout.toString().trim();
          resolve(_cachedVersion);
        }
      },
    );
  });
}

export function clearVersionCache(): void {
  _cachedVersion = null;
}

export function runHermesUpdateCheck(): Promise<
  HermesCommandResult & { updateAvailable: boolean }
> {
  return runHermesCommand(["update", "--check"], undefined, 60000).then(
    (result) => ({
      ...result,
      updateAvailable: /update available|commits behind|new version/i.test(
        `${result.output}\n${result.error || ""}`,
      ),
    }),
  );
}

export function runHermesDoctor(): string {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return "80M is not installed.";
  }
  try {
    const output = execSync(`"${HERMES_PYTHON}" "${HERMES_SCRIPT}" doctor`, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: HOST_HOME,
        HERMES_HOME,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    return stripAnsi(output.toString());
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() || "";
    return stripAnsi(stderr) || "Doctor check failed.";
  }
}

const OPENCLAW_DIR_NAMES = [".openclaw", ".clawdbot", ".moldbot"];

export function checkOpenClawExists(): { found: boolean; path: string | null } {
  for (const name of OPENCLAW_DIR_NAMES) {
    const dir = join(homedir(), name);
    if (existsSync(dir)) {
      return { found: true, path: dir };
    }
  }
  return { found: false, path: null };
}

export async function runClawMigrate(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    throw new Error("80M is not installed.");
  }

  const openclaw = checkOpenClawExists();
  if (!openclaw.found) {
    throw new Error("No legacy office installation found.");
  }

  let log = "";
  function emit(text: string): void {
    log += text;
    onProgress({
      step: 1,
      totalSteps: 1,
      title: "Migrating legacy office",
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit(`Migrating from ${openclaw.path}...\n`);

  return new Promise((resolve, reject) => {
    const args = [HERMES_SCRIPT, "claw", "migrate", "--preset", "full"];

    const proc = spawn(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: HOST_HOME,
        HERMES_HOME,
        TERM: "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nMigration complete!\n");
        resolve();
      } else {
        reject(new Error(`Migration failed (exit code ${code}).`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run migration: ${err.message}`));
    });
  });
}

export async function runHermesUpdate(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    throw new Error("80M is not installed. Please install it first.");
  }

  let log = "";
  function emit(text: string): void {
    log += text;
    onProgress({
      step: 1,
      totalSteps: 1,
      title: "Updating 80m Agent",
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit("Running hermes update...\n");

  return new Promise((resolve, reject) => {
    const proc = spawn(HERMES_PYTHON, [HERMES_SCRIPT, "update"], {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: HOST_HOME,
        HERMES_HOME,
        TERM: "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nUpdate complete!\n");
        resolve();
      } else {
        reject(new Error(`Update failed (exit code ${code}).`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run update: ${err.message}`));
    });
  });
}

function getShellProfile(home: string): string | null {
  // Check for the user's shell profile to source their PATH
  const candidates = [
    join(home, ".zshrc"),
    join(home, ".bashrc"),
    join(home, ".bash_profile"),
    join(home, ".profile"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// Parse install.sh output to detect progress stages
const STAGE_MARKERS: { pattern: RegExp; step: number; title: string }[] = [
  {
    pattern: /Checking for (git|uv|python)/i,
    step: 1,
    title: "Checking prerequisites",
  },
  {
    pattern: /Installing uv|uv found/i,
    step: 2,
    title: "Setting up package manager",
  },
  {
    pattern: /Installing Python|Python .* found/i,
    step: 3,
    title: "Setting up Python",
  },
  {
    pattern: /Cloning|cloning|Updating.*repository|Repository/i,
    step: 4,
    title: "Downloading 80m Agent",
  },
  {
    pattern: /Creating virtual|virtual environment|venv/i,
    step: 5,
    title: "Creating Python environment",
  },
  {
    pattern: /pip install|Installing.*packages|dependencies/i,
    step: 6,
    title: "Installing dependencies",
  },
  {
    pattern: /Configuration|config|Setup complete|Installation complete/i,
    step: 7,
    title: "Finishing setup",
  },
];

export async function runInstall(
  onProgress: (progress: InstallProgress) => void,
  parentWindow?: BrowserWindow | null,
): Promise<void> {
  const totalSteps = 7;
  let log = "";
  let currentStep = 1;
  let currentTitle = "Starting installation...";

  function emit(text: string): void {
    log += text;
    // Try to detect which stage we're in from the output
    for (const marker of STAGE_MARKERS) {
      if (marker.pattern.test(text)) {
        if (marker.step >= currentStep) {
          currentStep = marker.step;
          currentTitle = marker.title;
        }
        break;
      }
    }
    onProgress({
      step: currentStep,
      totalSteps,
      title: currentTitle,
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit("Running 80M runtime install script...\n");

  let askpass: AskpassHandle | null = null;
  if (process.platform !== "win32") {
    try {
      askpass = await setupAskpass(parentWindow ?? null);
    } catch (err) {
      emit(
        `\n[askpass] Could not set up GUI password bridge: ${(err as Error).message}\n`,
      );
    }
  }

  try {
    return await new Promise((resolve, reject) => {
      const home = homedir();

      // Source the user's shell profile to get the same PATH as their terminal,
      // then run the official install script. Electron apps launched from Finder
      // don't inherit the terminal environment.
      const shellProfile = getShellProfile(home);
      const installCmd = [
        shellProfile ? `source "${shellProfile}" 2>/dev/null;` : "",
        "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup",
      ].join(" ");

      const basePath = getEnhancedPath();
      const proc = spawn("bash", ["-c", installCmd], {
        cwd: home,
        env: {
          ...process.env,
          PATH: askpass ? `${askpass.pathPrepend}:${basePath}` : basePath,
          HOME: home,
          TERM: "dumb",
          ...(askpass?.env ?? {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (data: Buffer) => {
        emit(stripAnsi(data.toString()));
      });

      proc.stderr?.on("data", (data: Buffer) => {
        emit(stripAnsi(data.toString()));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          emit("\nInstallation complete!\n");
          resolve();
        } else {
          // The install script can exit non-zero due to benign issues
          // (e.g. git stash pop failure on already-clean repo).
          // If the runtime is actually installed and working, treat as success.
          if (existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT)) {
            emit(
              "\nInstall script exited with warnings, but 80M is installed successfully.\n",
            );
            resolve();
          } else {
            reject(
              new Error(
                `Installation failed (exit code ${code}). You can try installing via terminal instead.`,
              ),
            );
          }
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start installer: ${err.message}`));
      });
    });
  } finally {
    askpass?.cleanup();
  }
}
