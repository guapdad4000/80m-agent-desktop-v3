import { execFile } from "child_process";
import {
  HOST_HOME,
  getEnhancedPath,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
} from "./installer";

export function runHermesPythonJson(
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
          HOME: HOST_HOME,
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
