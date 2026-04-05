/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Worker bindings — see wrangler.toml
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/
 */
export interface Env {
  /** Browser Rendering binding (@cloudflare/puppeteer) */
  BROWSER: Fetcher;
  /** Optional KV for screenshot bytes + /s/... routes */
  SCREENSHOTS?: KVNamespace;
  /** Edge cache TTL for JSON previews (seconds). "0" disables. */
  PREVIEW_CACHE_TTL?: string;
  /** If "1", pretty-print JSON (larger responses). */
  PRETTY_JSON?: string;
}
