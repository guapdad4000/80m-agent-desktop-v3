import { execFile } from "child_process";
import { existsSync } from "fs";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer-paths";
import { stripAnsi } from "./utils";

export interface HermesCommandResult {
  success: boolean;
  output: string;
  error?: string;
  code?: number | null;
}

export function runHermesCommand(
  args: string[],
  profile?: string,
  timeout = 120000,
): Promise<HermesCommandResult> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return Promise.resolve({
      success: false,
      output: "",
      error: "80M is not installed.",
    });
  }

  const commandArgs =
    profile && profile !== "default"
      ? [HERMES_SCRIPT, "-p", profile, ...args]
      : [HERMES_SCRIPT, ...args];

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      commandArgs,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        const cleanStdout = stripAnsi(stdout || "");
        const cleanStderr = stripAnsi(stderr || "");
        if (error) {
          resolve({
            success: false,
            output: cleanStdout || cleanStderr,
            error: cleanStderr || error.message,
            code:
              typeof (error as NodeJS.ErrnoException & { code?: unknown })
                .code === "number"
                ? ((error as NodeJS.ErrnoException & { code?: number }).code ??
                  null)
                : null,
          });
          return;
        }
        resolve({ success: true, output: cleanStdout });
      },
    );
  });
}
