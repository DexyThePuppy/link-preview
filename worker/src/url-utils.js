/** @param {string} pathname */
export function targetFromPathname(pathname) {
  const raw = pathname.replace(/^\/+/, "");
  if (!raw) return null;
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    path = raw;
  }
  if (/^https?:\/\//i.test(path)) return path;
  return `https://${path}`;
}

/** @param {string} urlString */
export function assertPublicUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (u.username || u.password) {
    throw new Error("URL must not include credentials");
  }
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  ) {
    throw new Error("Host not allowed");
  }
  const p = /^(\d{1,3})\.(\d{1,3})\./.exec(h);
  if (p) {
    const a = Number(p[1]);
    const b = Number(p[2]);
    if (a === 10) throw new Error("Host not allowed");
    if (a === 127) throw new Error("Host not allowed");
    if (a === 192 && b === 168) throw new Error("Host not allowed");
    if (a === 172 && b >= 16 && b <= 31) throw new Error("Host not allowed");
    if (a === 169 && b === 254) throw new Error("Host not allowed");
    if (a === 100 && b >= 64 && b <= 127) throw new Error("Host not allowed");
  }
  return u.href;
}

export function absolutizeUrl(baseHref, value) {
  if (!value || typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v, baseHref).href;
  } catch {
    return null;
  }
}
