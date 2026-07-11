import { BrowserWindow, ipcMain, shell } from "electron";
import { is } from "@electron-toolkit/utils";

interface RegisterWindowIpcOptions {
  getMainWindow: () => BrowserWindow | null;
  onOpenedExternal?: (url: string) => void;
}

/** Allowlist: only http, https, and mailto URLs for security. */
export function safeOpenExternal(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      shell.openExternal(url);
      return true;
    }
  } catch {
    // invalid URL - silently ignore
  }
  return false;
}

export function isRendererNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:" || parsed.protocol === "devtools:") {
      return true;
    }
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      return (
        parsed.origin === new URL(process.env["ELECTRON_RENDERER_URL"]).origin
      );
    }
  } catch {
    return false;
  }
  return false;
}

export function registerWindowIpc({
  getMainWindow,
  onOpenedExternal,
}: RegisterWindowIpcOptions): void {
  ipcMain.handle("open-external", (_event, url: string) => {
    if (safeOpenExternal(url)) {
      onOpenedExternal?.(url);
      return true;
    }
    return false;
  });

  ipcMain.handle("window-minimize", () => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle("window-toggle-maximize", () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });

  ipcMain.handle("window-close", () => {
    getMainWindow()?.close();
  });

  ipcMain.handle(
    "window-is-maximized",
    () => getMainWindow()?.isMaximized() ?? false,
  );

  ipcMain.handle("open-browser-window", (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
    } catch {
      return false;
    }

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      title: url,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.loadURL(url);
    win.once("ready-to-show", () => win.show());
    win.focus();
    return true;
  });
}
