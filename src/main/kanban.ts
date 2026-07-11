import Database from "better-sqlite3";
import { execFile } from "child_process";
import { app } from "electron";
import { existsSync } from "fs";
import { join, resolve } from "path";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer";
import { listProfiles } from "./profiles";
import { isValidProfileName, normalizeProfileName, stripAnsi } from "./utils";
import {
  STATUS_ORDER,
  type CreateKanbanTaskInput,
  type KanbanAssignee,
  type KanbanBoard,
  type KanbanBoardData,
  type KanbanCommandResult,
  type KanbanDocs,
  type KanbanStatus,
  type KanbanTask,
  type KanbanTaskDetails,
} from "./kanban-types";
export type {
  CreateKanbanTaskInput,
  KanbanAssignee,
  KanbanBoard,
  KanbanBoardData,
  KanbanCommandResult,
  KanbanDocs,
  KanbanStatus,
  KanbanTask,
  KanbanTaskDetails,
} from "./kanban-types";

const DIRECT_STATUSES = new Set<KanbanStatus>(["triage", "todo", "ready"]);
const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function isSpawnableProfile(profile?: string | null): boolean {
  const name = normalizeProfileName(profile);
  if (!isValidProfileName(name)) return false;
  if (name === "default") return true;
  return existsSync(join(HERMES_HOME, "profiles", name));
}

function normalizeAssigneeInput(
  assignee?: string | null,
): { success: true; assignee?: string } | { success: false; error: string } {
  if (!assignee?.trim()) return { success: true };
  const profile = normalizeProfileName(assignee);
  if (!isValidProfileName(profile)) {
    return {
      success: false,
      error:
        "Assignee must be a valid 80M profile id: lowercase letters, numbers, dashes, or underscores.",
    };
  }
  if (!isSpawnableProfile(profile)) {
    return {
      success: false,
      error: `Profile '${profile}' is not available to the Kanban dispatcher.`,
    };
  }
  return { success: true, assignee: profile };
}

function normalizeKanbanAssignees(
  assignees: KanbanAssignee[],
): KanbanAssignee[] {
  const merged = new Map<string, KanbanAssignee>();
  for (const assignee of assignees) {
    const name = normalizeProfileName(assignee.name);
    if (!isValidProfileName(name)) continue;
    const existing = merged.get(name);
    merged.set(name, {
      name,
      on_disk: Boolean(existing?.on_disk || assignee.on_disk),
      spawnable: isSpawnableProfile(name),
      counts: {
        ...(existing?.counts || {}),
        ...(assignee.counts || {}),
      },
    });
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function docsRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "hermes-kanban", "docs");
  }
  return resolve(appRepoRoot(), "docs", "hermes-kanban");
}

function mediumRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "hermes-kanban", "medium");
  }
  return resolve(appRepoRoot(), "docs", "medium");
}

function pluginRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "hermes-kanban", "vendor");
  }
  return resolve(appRepoRoot(), "vendor", "hermes-kanban");
}

function appRepoRoot(): string {
  return resolve(__dirname, "..", "..");
}

export function getKanbanDocs(): KanbanDocs {
  const root = docsRoot();
  return {
    pluginPath: pluginRoot(),
    releaseNotesPath: join(root, "HERMES_AGENT_V0.12.0_RELEASE_NOTES.md"),
    overviewPath: join(root, "kanban.md"),
    tutorialPath: join(root, "kanban-tutorial.md"),
    workerPath: join(root, "devops-kanban-worker.md"),
    orchestratorPath: join(root, "devops-kanban-orchestrator.md"),
    specPath: join(root, "hermes-kanban-v1-spec.pdf"),
    mediumPagePath: join(mediumRoot(), "HERMES_KANBAN_V012_MEDIUM_PAGE.md"),
    officialDocsUrl:
      "https://github.com/guapdad4000/80m-agent-desktop-v3/blob/main/docs/hermes-kanban/kanban.md",
    officialTutorialUrl:
      "https://github.com/guapdad4000/80m-agent-desktop-v3/blob/main/docs/hermes-kanban/kanban-tutorial.md",
    upstreamPluginUrl:
      "https://github.com/guapdad4000/80m-agent-desktop-v3/tree/main/vendor/hermes-kanban",
    upstreamReleaseUrl:
      "https://github.com/guapdad4000/80m-agent-desktop-v3/blob/main/docs/hermes-kanban/HERMES_AGENT_V0.12.0_RELEASE_NOTES.md",
  };
}

function runKanbanCommand(
  args: string[],
  options: { board?: string; timeout?: number } = {},
): Promise<KanbanCommandResult<string>> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return Promise.resolve({
      success: false,
      error: "80M is not installed.",
    });
  }

  const cliArgs = [HERMES_SCRIPT, "kanban"];
  if (options.board && options.board !== "default") {
    cliArgs.push("--board", options.board);
  }
  cliArgs.push(...args);

  return new Promise((resolveResult) => {
    execFile(
      HERMES_PYTHON,
      cliArgs,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: options.timeout || 20000,
        maxBuffer: 1024 * 1024 * 2,
      },
      (error, stdout, stderr) => {
        const output = stripAnsi(stdout || stderr || "");
        if (error) {
          resolveResult({
            success: false,
            output,
            error: output.trim() || error.message,
          });
          return;
        }
        resolveResult({ success: true, output });
      },
    );
  });
}

function extractJson<T>(text: string): T {
  const startCandidates = [text.indexOf("{"), text.indexOf("[")].filter(
    (idx) => idx >= 0,
  );
  const start = Math.min(...startCandidates);
  if (!Number.isFinite(start)) throw new Error("No JSON payload found.");

  const source = text.slice(start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let closeIndex = -1;
  const opener = source[0];
  const closer = opener === "{" ? "}" : "]";

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opener) depth += 1;
    if (ch === closer) depth -= 1;
    if (depth === 0) {
      closeIndex = i + 1;
      break;
    }
  }

  if (closeIndex < 0) throw new Error("JSON payload was incomplete.");
  return JSON.parse(source.slice(0, closeIndex)) as T;
}

async function runJson<T>(
  args: string[],
  options: { board?: string; timeout?: number } = {},
): Promise<KanbanCommandResult<T>> {
  const result = await runKanbanCommand(args, options);
  if (!result.success) return result as KanbanCommandResult<T>;
  try {
    return {
      success: true,
      data: extractJson<T>(result.output || ""),
      output: result.output,
    };
  } catch (error) {
    return {
      success: false,
      output: result.output,
      error:
        error instanceof Error ? error.message : "Failed to parse JSON output.",
    };
  }
}

function emptyColumns(): Record<KanbanStatus, KanbanTask[]> {
  return STATUS_ORDER.reduce(
    (acc, status) => ({ ...acc, [status]: [] }),
    {} as Record<KanbanStatus, KanbanTask[]>,
  );
}

function buildColumns(tasks: KanbanTask[]): Record<KanbanStatus, KanbanTask[]> {
  const columns = emptyColumns();
  for (const task of tasks) {
    const status = STATUS_ORDER.includes(task.status) ? task.status : "todo";
    columns[status].push(task);
  }
  return columns;
}

export async function listKanbanBoard(
  options: {
    board?: string;
    tenant?: string;
    includeArchived?: boolean;
  } = {},
): Promise<KanbanCommandResult<KanbanBoardData>> {
  const listArgs = ["list", "--json"];
  if (options.tenant) listArgs.push("--tenant", options.tenant);
  if (options.includeArchived) listArgs.push("--archived");

  const [
    tasksResult,
    boardsResult,
    assigneesResult,
    statsResult,
    profilesResult,
  ] = await Promise.all([
    runJson<KanbanTask[]>(listArgs, { board: options.board }),
    runJson<KanbanBoard[]>(["boards", "list", "--json"], {
      board: options.board,
    }),
    runJson<KanbanAssignee[]>(["assignees", "--json"], {
      board: options.board,
    }),
    runJson<KanbanBoardData["stats"]>(["stats", "--json"], {
      board: options.board,
    }),
    listProfiles().catch(() => []),
  ]);

  if (!tasksResult.success) {
    return {
      success: false,
      error: tasksResult.error,
      output: tasksResult.output,
    };
  }

  const tasks = tasksResult.data || [];
  const profileAssignees: KanbanAssignee[] = profilesResult.map((profile) => ({
    name: profile.name,
    on_disk: true,
    spawnable: true,
    counts: {},
  }));
  return {
    success: true,
    data: {
      tasks,
      columns: buildColumns(tasks),
      boards: boardsResult.data || [],
      assignees: normalizeKanbanAssignees([
        ...(assigneesResult.data || []),
        ...profileAssignees,
      ]),
      stats: statsResult.data || {
        by_status: {},
        by_assignee: {},
        oldest_ready_age_seconds: null,
        now: Math.floor(Date.now() / 1000),
      },
      docs: getKanbanDocs(),
    },
  };
}

export function getKanbanTask(
  taskId: string,
  board?: string,
): Promise<KanbanCommandResult<KanbanTaskDetails>> {
  return runJson<KanbanTaskDetails>(["show", taskId, "--json"], { board });
}

export async function createKanbanTask(
  input: CreateKanbanTaskInput,
): Promise<KanbanCommandResult<KanbanTask>> {
  const title = input.title?.trim();
  if (!title) return { success: false, error: "Task title is required." };
  const assignee = normalizeAssigneeInput(input.assignee);
  if (!assignee.success) return assignee;

  const args = ["create", title, "--json"];
  if (input.body?.trim()) args.push("--body", input.body.trim());
  if (assignee.assignee) args.push("--assignee", assignee.assignee);
  if (input.tenant?.trim()) args.push("--tenant", input.tenant.trim());
  if (input.priority != null) args.push("--priority", String(input.priority));
  if (input.workspace?.trim()) args.push("--workspace", input.workspace.trim());
  if (input.maxRuntime?.trim())
    args.push("--max-runtime", input.maxRuntime.trim());
  if (input.triage) args.push("--triage");
  for (const parent of input.parents || []) {
    if (parent.trim()) args.push("--parent", parent.trim());
  }
  for (const skill of input.skills || []) {
    if (skill.trim()) args.push("--skill", skill.trim());
  }

  return runJson<KanbanTask>(args, { board: input.board, timeout: 30000 });
}

export async function assignKanbanTask(
  taskId: string,
  assignee: string | null,
  board?: string,
): Promise<KanbanCommandResult> {
  const normalized = normalizeAssigneeInput(assignee);
  if (!normalized.success) return normalized;
  const profile = normalized.assignee || "none";
  return runKanbanCommand(["assign", taskId, profile], { board });
}

export async function commentKanbanTask(
  taskId: string,
  body: string,
  board?: string,
): Promise<KanbanCommandResult> {
  if (!body.trim()) return { success: false, error: "Comment is required." };
  return runKanbanCommand(
    ["comment", "--author", "80m-desktop", taskId, body.trim()],
    { board },
  );
}

function dbPathForBoard(board?: string): string {
  if (!board || board === "default") return join(HERMES_HOME, "kanban.db");
  const slug = board.toLowerCase();
  if (!BOARD_SLUG_RE.test(slug)) {
    throw new Error("Invalid board slug.");
  }
  return join(HERMES_HOME, "kanban", "boards", slug, "kanban.db");
}

function setStatusDirect(
  taskId: string,
  status: KanbanStatus,
  board?: string,
): KanbanCommandResult {
  if (!DIRECT_STATUSES.has(status)) {
    return { success: false, error: `Cannot direct-set status ${status}.` };
  }

  const dbPath = dbPathForBoard(board);
  if (!existsSync(dbPath)) {
    return { success: false, error: "Kanban database does not exist yet." };
  }

  const db = new Database(dbPath);
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = db
      .prepare("SELECT status, current_run_id FROM tasks WHERE id = ?")
      .get(taskId) as
      | { status: string; current_run_id: number | null }
      | undefined;
    if (!row) return { success: false, error: "Task not found." };

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE tasks
         SET status = ?,
             claim_lock = NULL,
             claim_expires = NULL,
             worker_pid = NULL
         WHERE id = ?`,
      ).run(status, taskId);

      if (row.status === "running" && row.current_run_id) {
        db.prepare(
          `UPDATE task_runs
           SET status = 'reclaimed',
               outcome = 'reclaimed',
               summary = ?,
               ended_at = ?
           WHERE id = ?`,
        ).run(
          `status changed to ${status} (80m desktop)`,
          now,
          row.current_run_id,
        );
      }

      db.prepare(
        `INSERT INTO task_events (task_id, run_id, kind, payload, created_at)
         VALUES (?, ?, 'status', ?, ?)`,
      ).run(
        taskId,
        row.status === "running" ? row.current_run_id : null,
        JSON.stringify({ status }),
        now,
      );
    });
    tx();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update task.",
    };
  } finally {
    db.close();
  }
}

export async function updateKanbanTaskStatus(
  taskId: string,
  status: KanbanStatus,
  options: {
    board?: string;
    reason?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<KanbanCommandResult> {
  if (status === "done") {
    const args = ["complete", taskId];
    if (options.summary?.trim()) args.push("--summary", options.summary.trim());
    if (options.metadata)
      args.push("--metadata", JSON.stringify(options.metadata));
    return runKanbanCommand(args, { board: options.board, timeout: 30000 });
  }
  if (status === "blocked") {
    return runKanbanCommand(
      ["block", taskId, options.reason?.trim() || "Blocked from 80m desktop"],
      { board: options.board },
    );
  }
  if (status === "archived") {
    return runKanbanCommand(["archive", taskId], { board: options.board });
  }
  if (status === "ready") {
    const current = await getKanbanTask(taskId, options.board);
    if (current.success && current.data?.task.status === "blocked") {
      return runKanbanCommand(["unblock", taskId], { board: options.board });
    }
  }
  if (status === "running") {
    return {
      success: false,
      error: "Running tasks must be claimed by the 80M dispatcher.",
    };
  }
  return setStatusDirect(taskId, status, options.board);
}

export function nudgeKanbanDispatcher(
  board?: string,
): Promise<KanbanCommandResult<unknown>> {
  return runJson(["dispatch", "--json"], { board, timeout: 45000 });
}
