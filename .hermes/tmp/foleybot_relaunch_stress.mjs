import { _electron as electron } from 'playwright';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const executablePath = join(homedir(), 'Applications/Foleybot.app/Contents/MacOS/Foleybot');
const diagDir = join(homedir(), 'Library/Logs/DiagnosticReports');
const started = Date.now();
const cycles = Number(process.env.CYCLES || 12);
const results = [];

function recentCrashes() {
  let files = [];
  try {
    files = readdirSync(diagDir)
      .filter((name) => /Foleybot Helper \(Renderer\).*\.ips$/.test(name))
      .map((name) => {
        const path = join(diagDir, name);
        const st = statSync(path);
        return { name, mtime: st.mtime.toISOString(), afterStart: st.mtimeMs >= started - 2000 };
      })
      .filter((x) => x.afterStart)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {}
  return files;
}

for (let i = 1; i <= cycles; i++) {
  const launchedAt = Date.now();
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', `--user-data-dir=/tmp/foleybot-relaunch-${Date.now()}-${i}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  const page = await app.firstWindow({ timeout: 20000 });
  const logs = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.stack || err.message}`));
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => undefined);
  await page.waitForSelector('textarea.input-80m-textarea, textarea, [contenteditable="true"]', { timeout: 20000 });
  const state = await page.evaluate(() => ({
    title: document.title,
    bodyLength: document.body?.innerText?.length ?? 0,
    rootChildren: document.querySelector('#root')?.children.length ?? 0,
    hasInput: Boolean(document.querySelector('textarea.input-80m-textarea, textarea, [contenteditable="true"]')),
    sample: (document.body?.innerText || '').slice(0, 120),
  }));
  const ok = state.rootChildren > 0 && state.hasInput && state.bodyLength > 20;
  results.push({ cycle: i, ok, ms: Date.now() - launchedAt, state, logCount: logs.length, lastLogs: logs.slice(-3) });
  await app.close().catch(() => undefined);
  if (!ok) break;
}

const crashes = recentCrashes();
console.log(JSON.stringify({ cycles, passed: results.every((r) => r.ok), results, crashesDuringTest: crashes }, null, 2));
process.exit(results.every((r) => r.ok) && crashes.length === 0 ? 0 : 1);
