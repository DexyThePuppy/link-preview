/** @param {BodyInit} body */
export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      /** @type {any} */ (bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} [extraHeaders]
 * @param {boolean} [pretty]
 */
export function jsonResponse(body, status = 200, extraHeaders = {}, pretty = false) {
  const data = pretty
    ? JSON.stringify(body, null, 2)
    : JSON.stringify(body);
  return new Response(data, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

export function randomId48() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {URLSearchParams} searchParams */
export function screenshotDisabled(searchParams) {
  if (!searchParams.has("screenshot")) return false;
  const v = searchParams.get("screenshot");
  return v === "0" || v === "false" || v === "no";
}

/** @param {URLSearchParams} searchParams */
export function screenshotFullPage(searchParams) {
  const fp = searchParams.get("fullPage");
  if (fp === "0" || fp === "false") return false;
  return true;
}

/** @param {Request} request */
export function requestOrigin(request) {
  return new URL(request.url).origin;
}
