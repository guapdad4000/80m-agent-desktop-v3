import { execFileSync } from "child_process";
import { join } from "path";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer";
import { isValidProfileName, normalizeProfileName } from "./utils";

const PROFILES_DIR = join(HERMES_HOME, "profiles");

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

export type ProfileCreateMode = "clone" | "blank" | "clone-all";

export interface ProfileCreateOptions {
  mode?: ProfileCreateMode;
  cloneFrom?: string;
  noAlias?: boolean;
  noSkills?: boolean;
}

export interface ProfileCreateResult {
  success: boolean;
  name?: string;
  profile?: ProfileInfo;
  error?: string;
}

export function normalizeProfileCreateOptions(
  options?: boolean | ProfileCreateOptions,
): Required<Pick<ProfileCreateOptions, "mode">> &
  Omit<ProfileCreateOptions, "mode"> {
  if (typeof options === "boolean") {
    return { mode: options ? "clone" : "blank" };
  }
  return {
    ...options,
    mode: options?.mode || "clone",
  };
}

export function buildCreateProfileArgs(
  name: string,
  options?: boolean | ProfileCreateOptions,
):
  | { success: true; profileName: string; args: string[] }
  | {
      success: false;
      error: string;
    } {
  const profileName = normalizeProfileName(name);
  if (!isValidProfileName(profileName) || profileName === "default") {
    return {
      success: false,
      error:
        "Profile names must use lowercase letters, numbers, dashes, or underscores.",
    };
  }

  const resolved = normalizeProfileCreateOptions(options);
  if (!["clone", "blank", "clone-all"].includes(resolved.mode)) {
    return { success: false, error: "Unsupported profile creation mode." };
  }

  const args = ["profile", "create", profileName];
  if (resolved.mode === "clone") args.push("--clone");
  if (resolved.mode === "clone-all") args.push("--clone-all");

  if (resolved.cloneFrom?.trim()) {
    if (resolved.mode === "blank") {
      return {
        success: false,
        error: "cloneFrom can only be used with clone or clone-all mode.",
      };
    }
    const source = normalizeProfileName(resolved.cloneFrom);
    if (!isValidProfileName(source)) {
      return {
        success: false,
        error:
          "Source profile names must use lowercase letters, numbers, dashes, or underscores.",
      };
    }
    args.push("--clone-from", source);
  }

  if (resolved.noAlias) args.push("--no-alias");
  if (resolved.noSkills) args.push("--no-skills");

  return { success: true, profileName, args };
}

async function readProfileConfig(profilePath: string): Promise<{
  model: string;
  provider: string;
}> {
  const configFile = join(profilePath, "config.yaml");
  try {
    const content = await fs.readFile(configFile, "utf-8");
    const modelMatch = content.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m);
    const providerMatch = content.match(
      /^\s*provider:\s*["']?([^"'\n#]+)["']?/m,
    );
    return {
      model: modelMatch ? modelMatch[1].trim() : "",
      provider: providerMatch ? providerMatch[1].trim() : "auto",
    };
  } catch {
    return { model: "", provider: "" };
  }
}

async function countSkills(profilePath: string): Promise<number> {
  const skillsDir = join(profilePath, "skills");
  try {
    const dirs = await fs.readdir(skillsDir);
    let count = 0;
    for (const d of dirs) {
      const sub = join(skillsDir, d);
      const stat = await fs.stat(sub);
      if (stat.isDirectory()) {
        const inner = await fs.readdir(sub);
        for (const f of inner) {
          try {
            await fs.access(join(sub, f, "SKILL.md"));
            count++;
          } catch {
            // not a skill
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function isGatewayRunning(profilePath: string): Promise<boolean> {
  const pidFile = join(profilePath, "gateway.pid");
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getActiveProfileName(): Promise<string> {
  const activeFile = join(HERMES_HOME, "active_profile");
  try {
    const name = await fs.readFile(activeFile, "utf-8");
    return normalizeProfileName(name);
  } catch {
    return "default";
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const activeName = await getActiveProfileName();
  const profiles: ProfileInfo[] = [];

  // Default profile is HERMES_HOME itself
  const [
    defaultConfig,
    defaultHasEnv,
    defaultHasSoul,
    defaultSkills,
    defaultGw,
  ] = await Promise.all([
    readProfileConfig(HERMES_HOME),
    fileExists(join(HERMES_HOME, ".env")),
    fileExists(join(HERMES_HOME, "SOUL.md")),
    countSkills(HERMES_HOME),
    isGatewayRunning(HERMES_HOME),
  ]);

  profiles.push({
    name: "default",
    path: HERMES_HOME,
    isDefault: true,
    isActive: activeName === "default",
    model: defaultConfig.model,
    provider: defaultConfig.provider,
    hasEnv: defaultHasEnv,
    hasSoul: defaultHasSoul,
    skillCount: defaultSkills,
    gatewayRunning: defaultGw,
  });

  // Named profiles under ~/.hermes/profiles/
  if (existsSync(PROFILES_DIR)) {
    try {
      const dirs = await fs.readdir(PROFILES_DIR);
      const profilePromises = dirs.map(async (name) => {
        const profileName = normalizeProfileName(name);
        if (name !== profileName || !isValidProfileName(profileName)) {
          return null;
        }
        const profilePath = join(PROFILES_DIR, name);
        const stat = await fs.stat(profilePath);
        if (!stat.isDirectory()) return null;

        const hasConfig = await fileExists(join(profilePath, "config.yaml"));
        const hasEnvFile = await fileExists(join(profilePath, ".env"));
        if (!hasConfig && !hasEnvFile) return null;

        const [config, hasSoul, skillCount, gwRunning] = await Promise.all([
          readProfileConfig(profilePath),
          fileExists(join(profilePath, "SOUL.md")),
          countSkills(profilePath),
          isGatewayRunning(profilePath),
        ]);

        return {
          name: profileName,
          path: profilePath,
          isDefault: false,
          isActive: activeName === profileName,
          model: config.model,
          provider: config.provider,
          hasEnv: hasEnvFile,
          hasSoul: hasSoul,
          skillCount,
          gatewayRunning: gwRunning,
        } as ProfileInfo;
      });

      const resolved = await Promise.all(profilePromises);
      for (const p of resolved) {
        if (p) profiles.push(p);
      }
    } catch {
      // ignore
    }
  }

  return profiles;
}

export async function createProfile(
  name: string,
  options?: boolean | ProfileCreateOptions,
): Promise<ProfileCreateResult> {
  try {
    const planned = buildCreateProfileArgs(name, options);
    if (!planned.success) return planned;
    execFileSync(HERMES_PYTHON, [HERMES_SCRIPT, ...planned.args], {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: HOST_HOME,
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 120000,
    });
    const profile = (await listProfiles()).find(
      (item) => item.name === planned.profileName,
    );
    if (!profile) {
      return {
        success: false,
        name: planned.profileName,
        error: `Hermes reported success, but profile '${planned.profileName}' was not found on disk.`,
      };
    }
    return { success: true, name: planned.profileName, profile };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { success: false, error: msg.trim() };
  }
}

export function deleteProfile(name: string): {
  success: boolean;
  error?: string;
} {
  const profileName = normalizeProfileName(name);
  if (profileName === "default")
    return { success: false, error: "Cannot delete the default profile" };
  if (!isValidProfileName(profileName)) {
    return {
      success: false,
      error:
        "Profile names must use lowercase letters, numbers, dashes, or underscores.",
    };
  }
  try {
    execFileSync(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "profile", "delete", profileName, "--yes"],
      {
        cwd: join(HERMES_HOME, "hermes-agent"),
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
        },
        stdio: "pipe",
        timeout: 15000,
      },
    );
    return { success: true };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { success: false, error: msg.trim() };
  }
}

export function setActiveProfile(name: string): void {
  try {
    const profileName = normalizeProfileName(name);
    if (!isValidProfileName(profileName)) return;
    execFileSync(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "profile", "use", profileName],
      {
        cwd: join(HERMES_HOME, "hermes-agent"),
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
        },
        stdio: "pipe",
        timeout: 10000,
      },
    );
  } catch {
    // ignore
  }
}
