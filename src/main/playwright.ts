import { chromium, Browser, Page } from "playwright";
import { BrowserWindow } from "electron";

let browser: Browser | null = null;
let page: Page | null = null;

export async function startBrowserService(
  mainWindow: BrowserWindow,
): Promise<void> {
  if (browser) return;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    page.on("framenavigated", (frame) => {
      if (frame === page?.mainFrame() && mainWindow) {
        mainWindow.webContents.send("playwright-navigated", frame.url());
      }
    });

    // Optional: Send screenshot stream or cursor coordinates
    // We'll start with just URL synchronization
  } catch (err) {
    console.error("Failed to start Playwright:", err);
  }
}

export async function stopBrowserService(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

export async function navigateTo(url: string): Promise<void> {
  if (page) {
    await page.goto(url).catch(console.error);
  }
}

export async function getBrowserState(): Promise<{ url: string } | null> {
  if (page) {
    return { url: page.url() };
  }
  return null;
}
