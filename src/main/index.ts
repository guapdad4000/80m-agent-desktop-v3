import { app, BrowserWindow } from "electron";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import { buildAppMenu } from "./app-menu";
import { registerAutomationIpc } from "./automation-ipc";
import { registerBrowserIpc } from "./browser-ipc";
import { abortActiveChats, registerChatIpc } from "./chat-ipc";
import { stopAll as stopClaw3d } from "./claw3d";
import {
  ensureCortexClipperInstall,
  registerCortexClipperIpc,
} from "./cortex-clipper-ipc";
import {
  closeDesktopBuddyWindow,
  openDesktopBuddyWindow,
  registerDesktopBuddyIpc,
} from "./desktop-buddy-ipc";
import { stopWorkspaceWatch } from "./desktop-services";
import { stopGateway, stopHealthPolling } from "./hermes";
import { HERMES_HOME } from "./installer";
import { stopBrowserService } from "./playwright";
import { createProfileWatcher } from "./profile-watch";
import { registerProfileDataIpc } from "./profile-data-ipc";
import { registerRuntimeIpc } from "./runtime-ipc";
import { bootstrapMobileAccess } from "./tailscale";
import { setupUpdaterIpc } from "./updater-ipc";
import { registerWorkspaceIpc } from "./workspace-ipc";
import {
  isRendererNavigation,
  registerWindowIpc,
  safeOpenExternal,
} from "./window-ipc";

interface AppNotificationPayload {
  title: string;
  body?: string;
  tone?: "info" | "success" | "warning" | "error";
  createdAt?: number;
}

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
});

let mainWindow: BrowserWindow | null = null;
const profileWatcher = createProfileWatcher(HERMES_HOME, (source) => {
  mainWindow?.webContents.send("profiles-changed", {
    source,
    createdAt: Date.now(),
  });
});
const desktopBuddyInstallMarker = "desktop-buddy-installed-v1.json";

function sendAppNotification(payload: AppNotificationPayload): void {
  mainWindow?.webContents.send("app-notification", {
    ...payload,
    createdAt: payload.createdAt ?? Date.now(),
    tone: payload.tone ?? "info",
  });
}

function emitProfilesChanged(source: string): void {
  profileWatcher.emit(source);
}

function maybeAutoInstallDesktopBuddy(): void {
  const markerPath = join(app.getPath("userData"), desktopBuddyInstallMarker);
  if (existsSync(markerPath)) return;

  setTimeout(() => {
    openDesktopBuddyWindow("80M Agent")
      .then((opened) => {
        if (!opened) return;
        writeFileSync(
          markerPath,
          JSON.stringify(
            {
              installedAt: new Date().toISOString(),
              version: app.getVersion(),
            },
            null,
            2,
          ),
          "utf8",
        );
      })
      .catch((error) => {
        console.error("Failed to auto-install desktop buddy:", error);
      });
  }, 1400);
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
    transparent: false,
    backgroundColor: "#151816",
    hasShadow: true,
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    title: "Foleybot",
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    maybeAutoInstallDesktopBuddy();
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
  const getMainWindow = (): BrowserWindow | null => mainWindow;

  registerRuntimeIpc(getMainWindow);
  registerChatIpc(getMainWindow);
  registerWorkspaceIpc({ getMainWindow, hermesHome: HERMES_HOME });
  registerProfileDataIpc(emitProfilesChanged);
  registerAutomationIpc();
  registerWindowIpc({
    getMainWindow,
    onOpenedExternal: (url) =>
      sendAppNotification({
        title: "Opened outside",
        body: url,
        tone: "info",
      }),
  });
  registerBrowserIpc(getMainWindow);
  registerDesktopBuddyIpc({ getMainWindow });
  registerCortexClipperIpc();
}

function buildMenu(): void {
  buildAppMenu(() => mainWindow, safeOpenExternal);
}

function setupUpdater(): void {
  setupUpdaterIpc(() => mainWindow);
}

app.whenReady().then(() => {
  app.name = "Foleybot";
  electronApp.setAppUserModelId("com.foleybot.desktop");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  buildMenu();
  setupIPC();
  try {
    ensureCortexClipperInstall();
  } catch (error) {
    console.error("Failed to prepare Cortex Clipper:", error);
  }
  bootstrapMobileAccess().catch((error) => {
    console.error("Failed to bootstrap Tailscale mobile access:", error);
  });
  createWindow();
  profileWatcher.start();
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
  abortActiveChats();
  stopWorkspaceWatch();
  profileWatcher.stop();
  closeDesktopBuddyWindow();
  stopGateway();
  stopClaw3d();
  stopBrowserService();
});
