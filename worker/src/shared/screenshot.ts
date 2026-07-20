import { chromium } from "playwright";

export async function takeScreenshot(
  url: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil: "networkidle" });
    return await page.screenshot();
  } finally {
    await browser.close();
  }
}
