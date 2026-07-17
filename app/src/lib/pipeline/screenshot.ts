import { chromium } from "playwright";

export async function takeScreenshot(url: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "networkidle" });
    return await page.screenshot();
  } finally {
    await browser.close();
  }
}
