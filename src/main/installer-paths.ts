import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function resolveHostHome(): string {
  const detected = homedir();
  const envHome = process.env.HOME || detected;

  // Hermes subagents run commands with HOME redirected under
  // ~/.hermes/profiles/<profile>/home. If Foleybot is launched from that
  // environment, Electron would otherwise look for Hermes inside the nested
  // profile home and show first-run setup instead of the user's real history.
  if (/\/\.hermes\/profiles\/[^/]+\/home$/.test(envHome)) {
    const user = process.env.SUDO_USER || process.env.LOGNAME || process.env.USER;
    if (user) {
      const macHome = join("/Users", user);
      if (existsSync(macHome)) return macHome;
    }
  }

  return detected;
}

export const HOST_HOME = resolveHostHome();
export const HERMES_HOME = join(HOST_HOME, ".hermes");
export const HERMES_REPO = join(HERMES_HOME, "hermes-agent");
export const HERMES_VENV = join(HERMES_REPO, "venv");
export const HERMES_PYTHON = join(HERMES_VENV, "bin", "python");
export const HERMES_SCRIPT = join(HERMES_REPO, "hermes");
export const HERMES_ENV_FILE = join(HERMES_HOME, ".env");
export const HERMES_CONFIG_FILE = join(HERMES_HOME, "config.yaml");

export function getEnhancedPath(): string {
  const home = HOST_HOME;
  const extra = [
    join(home, ".local", "bin"),
    join(home, ".cargo", "bin"),
    join(HERMES_VENV, "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
    join(home, ".fnm", "aliases", "default", "bin"),
    ...resolveNvmBin(home),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
  ];
  return [...extra, process.env.PATH || ""].join(":");
}

function resolveNvmBin(home: string): string[] {
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  if (!existsSync(versionsDir)) return [];
  try {
    const aliasFile = join(nvmDir, "alias", "default");
    if (existsSync(aliasFile)) {
      const alias = readFileSync(aliasFile, "utf-8").trim();
      if (alias.startsWith("v")) {
        const bin = join(versionsDir, alias, "bin");
        if (existsSync(bin)) return [bin];
      }
    }
    const versions = (readdirSync(versionsDir) as string[])
      .filter((d: string) => d.startsWith("v"))
      .sort()
      .reverse();
    if (versions.length > 0) {
      return [join(versionsDir, versions[0], "bin")];
    }
  } catch {
    /* non-fatal */
  }
  return [];
}
