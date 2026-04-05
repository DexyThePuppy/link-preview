import {
  SCREENSHOT_LAUNCH_MAX_ATTEMPTS,
  SCREENSHOT_LAUNCH_RETRY_BASE_MS,
  UA,
} from "./constants.js";

/** @param {unknown} err */
function errorMessage(err) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String(/** @type {{ message: unknown }} */ (err).message);
  }
  return String(err);
}

/** @param {unknown} err */
function isBrowserRateLimited(err) {
  return /429|rate limit exceeded/i.test(errorMessage(err));
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import("@cloudflare/puppeteer").PuppeteerWorkers} puppeteer
 * @param {Fetcher} browserBinding
 * @param {string} targetUrl
 * @param {boolean} fullPage
 */
async function screenshotOnce(puppeteer, browserBinding, targetUrl, fullPage) {
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: 120_000,
    });
    const buf = await page.screenshot({
      type: "png",
      fullPage,
      captureBeyondViewport: fullPage,
    });
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  } finally {
    await browser.close();
  }
}

/** @param {Fetcher} browserBinding @param {string} targetUrl @param {boolean} fullPage */
export async function screenshotWithBrowser(browserBinding, targetUrl, fullPage) {
  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  let lastErr;
  for (let attempt = 0; attempt < SCREENSHOT_LAUNCH_MAX_ATTEMPTS; attempt++) {
    try {
      return await screenshotOnce(
        puppeteer,
        browserBinding,
        targetUrl,
        fullPage
      );
    } catch (e) {
      lastErr = e;
      const canRetry =
        attempt < SCREENSHOT_LAUNCH_MAX_ATTEMPTS - 1 && isBrowserRateLimited(e);
      if (canRetry) {
        const wait =
          SCREENSHOT_LAUNCH_RETRY_BASE_MS * Math.pow(2, attempt);
        await delay(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("screenshot failed");
}
