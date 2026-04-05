/** @see https://developers.cloudflare.com/workers/runtime-apis/ */
export const UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** Outbound fetch to target sites */
export const FETCH_TIMEOUT_MS = 25_000;

/** KV TTL for screenshot blobs (seconds) */
export const SCREENSHOT_KV_TTL_SEC = 15 * 60;

/** Browser Rendering: retries when puppeteer.launch hits 429 rate limit */
export const SCREENSHOT_LAUNCH_MAX_ATTEMPTS = 3;
export const SCREENSHOT_LAUNCH_RETRY_BASE_MS = 1_500;

export const SCREENSHOT_PATH_SIZED =
  /^\/s\/(full|viewport|vp)\/([a-f0-9]{48})(?:\.(?:png|jpe?g|webp))?\/?$/i;
export const SCREENSHOT_PATH_LEGACY =
  /^\/s\/([a-f0-9]{48})(?:\.(?:png|jpe?g|webp))?\/?$/i;
