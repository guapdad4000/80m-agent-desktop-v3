#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const executablePath = `${os.homedir()}/Applications/Foleybot.app/Contents/MacOS/Foleybot`;
const loops = Number(process.env.LOOPS || '5');
const results = [];
for (let i = 0; i < loops; i++) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), `foleybot-smoke-${i}-`));
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      executablePath,
      args: ['--no-sandbox', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    });
    const page = await app.firstWindow({ timeout: 30000 });
    page.on('console', msg => {
      if (['error', 'warning'].includes(msg.type())) errors.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.length > 50, null, { timeout: 30000 });
    const textareaCount = await page.locator('textarea').count();
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    if (textareaCount < 1) throw new Error(`no textarea; body starts: ${bodyText.slice(0, 200)}`);
    results.push({ loop: i + 1, ok: true, textLength: bodyText.length, textareaCount, errors: errors.slice(0, 5) });
  } catch (error) {
    results.push({ loop: i + 1, ok: false, error: error.message, errors: errors.slice(0, 10) });
    console.error(JSON.stringify(results, null, 2));
    process.exitCode = 1;
    break;
  } finally {
    if (app) await app.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.every(r => r.ok)) console.log(`PASS ${results.length}/${loops} installed launch/render checks`);
