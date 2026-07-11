#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { _electron as electron } from "playwright";

function defaultPackagedApp() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Applications/Foleybot.app/Contents/MacOS/Foleybot");
  }
  return "/home/falcon/Apps/80m-agent-desktop/80mAgentControl-linux-x64/80m-agent-desktop";
}

const executablePath = process.env.PACKAGED_APP ?? defaultPackagedApp();
const projectPath = process.env.UI_SMOKE_PROJECT ?? process.cwd();
const screenshotPath =
  process.env.UI_SMOKE_SCREENSHOT ??
  path.join(os.tmpdir(), "80m-agent-desktop-ui-smoke.png");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForAppReady(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return (
      text.includes("AGENT CONTROL") &&
      Boolean(document.querySelector("textarea"))
    );
  });
}

async function clickSidebarNav(page, key) {
  const selector = `.sidebar-80m-nav-item--${key}`;
  await page.locator(selector).click({ timeout: 7000 });
  await page.waitForFunction(
    (targetSelector) =>
      document.querySelector(targetSelector)?.classList.contains("active"),
    selector,
  );
}

async function verifyWindowControls(page) {
  const counts = {};
  for (const title of ["Minimize", "Maximize", "Close"]) {
    counts[title] = await page.locator(`button[title="${title}"]`).count();
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    console.log("Window controls: native/macOS titlebar detected; no custom controls to verify");
    return;
  }

  for (const [title, count] of Object.entries(counts)) {
    assert(count === 1, `Expected one ${title} window control, found ${count}`);
  }
}

async function verifyProjectToolbarClose(page) {
  await page.evaluate((activePath) => {
    localStorage.setItem("hermes-active-project", activePath);
  }, projectPath);
  await page.reload();
  await waitForAppReady(page);

  const showProjectButton = page.locator('button[title^="Show workspace"]');
  await showProjectButton.waitFor({ state: "visible", timeout: 7000 });
  await showProjectButton.click({ timeout: 7000 });

  await page.locator(".projects-sidebar").waitFor({ state: "visible" });
  const closeProjectButton = page.locator('button[title^="Close project"]');
  await closeProjectButton.first().waitFor({ state: "visible", timeout: 7000 });
  await closeProjectButton.first().click({ timeout: 7000 });

  await page.waitForFunction(
    () => localStorage.getItem("hermes-active-project") === null,
  );
  const openProjectButtons = await page
    .locator('button[title="Open Project Folder"]')
    .count();
  assert(
    openProjectButtons >= 1,
    "Expected project toolbar to return to open-folder state",
  );
}

async function main() {
  assert(
    existsSync(executablePath),
    `Packaged app executable not found: ${executablePath}`,
  );

  const userDataDir = await mkdtemp(
    path.join(os.tmpdir(), "80m-agent-ui-smoke-"),
  );
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: ["--no-sandbox", `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });

    const page = await app.firstWindow();
    await waitForAppReady(page);
    await verifyWindowControls(page);

    for (const key of [
      "sessions",
      "kanban",
      "skills",
      "tools",
      "soul",
      "gateway",
      "settings",
      "chat",
    ]) {
      await clickSidebarNav(page, key);
    }

    await verifyProjectToolbarClose(page);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log("PASS packaged UI smoke");
    console.log(`App: ${executablePath}`);
    console.log(`Project toolbar: show and close verified`);
    console.log(`Screenshot: ${screenshotPath}`);
  } finally {
    if (app) {
      await app.close().catch(() => undefined);
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

main().catch((error) => {
  console.error("FAIL packaged UI smoke");
  console.error(error);
  process.exitCode = 1;
});
