/**
 * Short-lived edge cache for JSON preview responses (optional).
 * @see https://developers.cloudflare.com/workers/runtime-apis/cache/
 */

/** @param {string} ttlVar value from env.PREVIEW_CACHE_TTL */
export function cacheTtlSeconds(ttlVar) {
  if (ttlVar == null || ttlVar === "") return 60;
  const n = Number(ttlVar);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 300);
}

/**
 * @param {Request} request
 * @param {string} target normalized URL
 * @param {boolean} wantFull
 * @param {boolean} noShot
 */
export async function cacheKeyRequest(request, target, wantFull, noShot) {
  const raw = `${target}|full=${wantFull ? "1" : "0"}|shot=${noShot ? "0" : "1"}|v=2`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw)
  );
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const u = new URL(request.url);
  return new Request(`${u.origin}/__preview-cache/${hash}`, {
    method: "GET",
  });
}

/** @param {{ PREVIEW_CACHE_TTL?: string }} env */
export async function cacheGet(env, req) {
  const ttl = cacheTtlSeconds(env.PREVIEW_CACHE_TTL);
  if (ttl <= 0) return null;
  const hit = await caches.default.match(req);
  return hit || null;
}

/**
 * @param {{ PREVIEW_CACHE_TTL?: string }} env
 * @param {Request} keyReq
 * @param {Response} response
 */
export async function cachePut(env, keyReq, response) {
  const ttl = cacheTtlSeconds(env.PREVIEW_CACHE_TTL);
  if (ttl <= 0) return;
  const cloned = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
  cloned.headers.set("cache-control", `public, max-age=${ttl}`);
  await caches.default.put(keyReq, cloned);
}
