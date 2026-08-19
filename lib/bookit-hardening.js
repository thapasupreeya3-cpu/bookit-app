"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_STATIC_EXTENSIONS = new Set([
  ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp",
  ".avif", ".gif", ".ico", ".webm", ".mp4", ".woff", ".woff2", ".ttf", ".map",
  ".xml", ".txt", ".webmanifest"
]);

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".pdf": "application/pdf"
});

function neutralizeSpreadsheetText(value) {
  let text = String(value ?? "");
  text = text.replace(/^[\u0000-\u0020\u007f\u0085\u00a0]+/u, "");
  if (/^[=+\-@]/u.test(text)) text = "'" + text;
  return text;
}

function safeSpreadsheetCell(value) {
  const text = neutralizeSpreadsheetText(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function safeCsvRow(values) {
  return values.map(safeSpreadsheetCell).join(",");
}


function normalizeIp(value) {
  let ip = String(value || "").trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return net.isIP(ip) ? ip : "unknown";
}

function isLoopback(ip) {
  const value = normalizeIp(ip);
  return value === "127.0.0.1" || value.startsWith("127.");
}

function trustedClientIp(req, options = {}) {
  const socketIp = normalizeIp(req?.socket?.remoteAddress);
  const trustProxy = options.trustProxy ?? /^(1|true|yes|on)$/i.test(process.env.TRUST_PROXY || "");
  if (!trustProxy || !isLoopback(socketIp)) return socketIp;
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const candidate = normalizeIp(forwarded);
  return candidate === "unknown" ? socketIp : candidate;
}

function expectedOrigin(req, configuredAppUrl) {
  if (configuredAppUrl) {
    try { return new URL(configuredAppUrl).origin; } catch { return null; }
  }
  if (process.env.NODE_ENV === "production") return null;
  const host = String(req?.headers?.host || "");
  if (!host) return null;
  return `${req?.socket?.encrypted ? "https" : "http"}://${host}`;
}

function validateBrowserRequest(req, configuredAppUrl, options = {}) {
  const method = String(req?.method || "GET").toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return { ok: true };
  const pathname = (() => {
    try { return new URL(req.url || "/", "http://bookit.invalid").pathname; }
    catch { return "/"; }
  })();
  const exempt = options.exemptPaths || ["/api/stripe/webhook", "/stripe/webhook", "/api/webhooks/stripe"];
  if (exempt.includes(pathname)) return { ok: true, exempt: true };

  const fetchSite = String(req?.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return { ok: false, reason: "cross-site request blocked" };
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return { ok: false, reason: "untrusted fetch metadata" };
  }

  const originHeader = req?.headers?.origin;
  const canonical = expectedOrigin(req, configuredAppUrl);
  if (originHeader) {
    let actual;
    try { actual = new URL(String(originHeader)).origin; }
    catch { return { ok: false, reason: "malformed Origin header" }; }
    if (!canonical || actual !== canonical) return { ok: false, reason: "Origin mismatch" };
  } else if (process.env.NODE_ENV === "production" && req?.headers?.cookie && !fetchSite) {
    // Modern browsers send Origin or Fetch Metadata for state-changing fetch/form requests.
    // Reject ambiguous cookie-authenticated production requests unless explicitly allowed.
    if (!/^(1|true|yes|on)$/i.test(process.env.ALLOW_LEGACY_NO_ORIGIN || "")) {
      return { ok: false, reason: "missing browser request provenance" };
    }
  }
  return { ok: true };
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function detectMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "application/octet-stream";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) return "application/zip";
  return "application/octet-stream";
}

function pngDimensions(buffer) {
  if (detectMime(buffer) !== "image/png" || buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (detectMime(buffer) !== "image/jpeg") return null;
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) { i += 1; continue; }
    const marker = buffer[i + 1];
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    if (i + 4 > buffer.length) break;
    const size = buffer.readUInt16BE(i + 2);
    if (size < 2 || i + 2 + size > buffer.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + size;
  }
  return null;
}

function validateJpegTrailer(buffer) {
  // A small amount of NUL/whitespace padding after EOI is emitted by some
  // scanners and phones. Accept that padding while still refusing appended
  // HTML, ZIP, PDF or arbitrary payload data.
  const searchStart = Math.max(2, buffer.length - 64 * 1024);
  let eoi = -1;
  for (let i = buffer.length - 2; i >= searchStart; i -= 1) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) { eoi = i; break; }
  }
  if (eoi < 0) throw Object.assign(new Error("JPEG is incomplete"), { code: "INVALID_UPLOAD" });
  const trailer = buffer.subarray(eoi + 2);
  if (trailer.length > 4096 || [...trailer].some(byte => ![0x00,0x09,0x0a,0x0d,0x20].includes(byte))) {
    throw Object.assign(new Error("JPEG has unexpected data after the image"), { code: "UNSAFE_UPLOAD" });
  }
}

function validatePdf(buffer) {
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1");
  if (!/%%EOF\s*$/m.test(tail)) throw Object.assign(new Error("PDF is incomplete"), { code: "INVALID_UPLOAD" });
  // User-provided PDFs are treated as documents, not executable containers.
  const text = buffer.toString("latin1");
  if (/\/(?:JavaScript|JS|Launch|RichMedia|EmbeddedFile|OpenAction|AA|XFA)\b/i.test(text)) {
    throw Object.assign(new Error("PDF contains active or embedded content"), { code: "UNSAFE_UPLOAD" });
  }
}

function validateUploadedBuffer(buffer, options = {}) {
  const maxBytes = Number(options.maxBytes || process.env.UPLOAD_MAX_BYTES || 12 * 1024 * 1024);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw Object.assign(new Error("Empty upload"), { code: "INVALID_UPLOAD" });
  if (buffer.length > maxBytes) throw Object.assign(new Error("Upload exceeds the size limit"), { code: "UPLOAD_TOO_LARGE" });
  const detectedMime = detectMime(buffer);
  const allowed = options.allowed || ["image/png", "image/jpeg", "image/webp", "application/pdf"];
  if (!allowed.includes(detectedMime)) throw Object.assign(new Error("Unsupported file signature"), { code: "UNSUPPORTED_UPLOAD" });
  const declared = String(options.declaredMime || "").toLowerCase().split(";", 1)[0];
  if (declared && declared !== detectedMime && !(declared === "image/jpg" && detectedMime === "image/jpeg")) {
    throw Object.assign(new Error("Declared file type does not match its contents"), { code: "MIME_MISMATCH" });
  }
  if (detectedMime === "application/pdf") validatePdf(buffer);
  if (detectedMime === "image/jpeg") validateJpegTrailer(buffer);
  const dimensions = detectedMime === "image/png" ? pngDimensions(buffer) : detectedMime === "image/jpeg" ? jpegDimensions(buffer) : null;
  if (detectedMime === "image/jpeg" && !dimensions) {
    throw Object.assign(new Error("JPEG structure could not be read"), { code: "INVALID_UPLOAD" });
  }
  if (dimensions && dimensions.width * dimensions.height > Number(process.env.UPLOAD_MAX_PIXELS || 25_000_000)) {
    throw Object.assign(new Error("Image dimensions are too large"), { code: "IMAGE_TOO_LARGE" });
  }
  return { buffer, detectedMime, dimensions };
}

function decodeAndValidateUpload(file, options = {}) {
  if (!file || typeof file !== "object") throw Object.assign(new Error("Missing upload"), { code: "INVALID_UPLOAD" });
  let data = String(file.data || file.base64 || "");
  let dataUrlMime = "";
  const match = data.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) { dataUrlMime = match[1]; data = match[2]; }
  data = data.replace(/\s+/g, "");
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) {
    throw Object.assign(new Error("Upload is not valid Base64"), { code: "INVALID_UPLOAD" });
  }
  const maxBytes = Number(options.maxBytes || process.env.UPLOAD_MAX_BYTES || 12 * 1024 * 1024);
  if (data.length > Math.ceil(maxBytes / 3) * 4 + 8) throw Object.assign(new Error("Upload exceeds the size limit"), { code: "UPLOAD_TOO_LARGE" });
  const buffer = Buffer.from(data, "base64");
  return validateUploadedBuffer(buffer, {
    ...options,
    maxBytes,
    declaredMime: options.declaredMime || file.mime || file.type || dataUrlMime
  });
}

function extensionForMime(mime) {
  return ({
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
    "image/gif": ".gif", "application/pdf": ".pdf"
  })[mime] || "";
}

function randomStorageName(mime) {
  return `${crypto.randomUUID()}${extensionForMime(mime)}`;
}

function isProtectedUploadExtension(filePath) {
  return [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(path.extname(String(filePath)).toLowerCase());
}

function declaredMimeFromExtension(filePath) {
  return MIME_TYPES[path.extname(String(filePath)).toLowerCase()]?.split(";", 1)[0] || "";
}

function installFsUploadGuards(fsModule = fs) {
  if (fsModule.__bookitUploadGuardsInstalled) return;
  Object.defineProperty(fsModule, "__bookitUploadGuardsInstalled", { value: true });
  const originalSync = fsModule.writeFileSync.bind(fsModule);
  fsModule.writeFileSync = function guardedWriteFileSync(file, data, options) {
    let nextOptions = options;
    if (Buffer.isBuffer(data) && isProtectedUploadExtension(file)) {
      validateUploadedBuffer(data, { declaredMime: declaredMimeFromExtension(file) });
    }
    if (nextOptions === undefined) nextOptions = { mode: 0o600 };
    else if (typeof nextOptions === "string") nextOptions = { encoding: nextOptions, mode: 0o600 };
    else nextOptions = { ...nextOptions, mode: nextOptions.mode ?? 0o600 };
    if (Buffer.isBuffer(data) && isProtectedUploadExtension(file) && (!nextOptions.flag || String(nextOptions.flag).startsWith("w"))) {
      const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      try { originalSync(temp, data, nextOptions); fsModule.renameSync(temp, file); }
      catch (error) { try { fsModule.unlinkSync(temp); } catch (_) {} throw error; }
      return;
    }
    return originalSync(file, data, nextOptions);
  };
  const original = fsModule.writeFile.bind(fsModule);
  fsModule.writeFile = function guardedWriteFile(file, data, options, callback) {
    let nextOptions = options;
    let cb = callback;
    if (typeof options === "function") { cb = options; nextOptions = undefined; }
    try {
      if (Buffer.isBuffer(data) && isProtectedUploadExtension(file)) {
        validateUploadedBuffer(data, { declaredMime: declaredMimeFromExtension(file) });
      }
    } catch (error) {
      return process.nextTick(() => cb(error));
    }
    if (nextOptions === undefined) nextOptions = { mode: 0o600 };
    else if (typeof nextOptions === "string") nextOptions = { encoding: nextOptions, mode: 0o600 };
    else nextOptions = { ...nextOptions, mode: nextOptions.mode ?? 0o600 };
    if (Buffer.isBuffer(data) && isProtectedUploadExtension(file) && (!nextOptions.flag || String(nextOptions.flag).startsWith("w"))) {
      const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      return original(temp, data, nextOptions, error => {
        if (error) return cb(error);
        fsModule.rename(temp, file, renameError => {
          if (renameError) fsModule.unlink(temp, () => cb(renameError)); else cb(null);
        });
      });
    }
    return original(file, data, nextOptions, cb);
  };
}

function redactEmail(value) {
  const email = String(value || "");
  const at = email.indexOf("@");
  if (at <= 1) return "[redacted email]";
  return `${email[0]}***${email.slice(at)}`;
}

function redactUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/token|code|secret|signature|key|password|reset|verify/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    if (/token|reset|verify/i.test(url.pathname)) url.pathname = url.pathname.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]");
    return url.toString();
  } catch {
    return "[redacted URL]";
  }
}


function redactLogValue(value, depth = 0) {
  if (depth > 3) return "[redacted nested value]";
  if (typeof value === "string") {
    let text = value.replace(/https?:\/\/[^\s"']+/gi, match => redactUrl(match));
    text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, match => redactEmail(match));
    text = text.replace(/((?:token|secret|password|reset|verify|code|signature)\s*[:=]\s*)[A-Za-z0-9._~+\/-]{12,}/gi, "$1[redacted]");
    return text;
  }
  if (Array.isArray(value)) return value.map(item => redactLogValue(item, depth + 1));
  if (value && typeof value === "object" && !(value instanceof Error) && !Buffer.isBuffer(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = /token|secret|password|reset|verify|code|signature|authorization|cookie/i.test(key) ? "[redacted]" : redactLogValue(item, depth + 1);
    }
    return output;
  }
  if (value instanceof Error) {
    const copy = new Error(redactLogValue(value.message, depth + 1));
    copy.name = value.name;
    copy.stack = redactLogValue(value.stack || "", depth + 1);
    return copy;
  }
  return value;
}

function installConsoleRedaction(consoleObject = console) {
  if (consoleObject.__bookitRedactionInstalled) return;
  Object.defineProperty(consoleObject, "__bookitRedactionInstalled", { value: true });
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    if (typeof consoleObject[method] !== "function") continue;
    const original = consoleObject[method].bind(consoleObject);
    consoleObject[method] = (...args) => original(...args.map(value => redactLogValue(value)));
  }
}

function isPathInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateProductionEnvironment(options = {}) {
  const env = options.env || process.env;
  const rootDir = options.rootDir || process.cwd();
  const errors = [];
  const warnings = [];
  if (env.NODE_ENV !== "production") return { ok: true, errors, warnings };
  let appOrigin = null;
  try {
    const appUrl = new URL(env.APP_URL || "");
    appOrigin = appUrl.origin;
    if (appUrl.protocol !== "https:") errors.push("APP_URL must use HTTPS in production");
  } catch { errors.push("APP_URL must be a valid absolute HTTPS URL in production"); }

  const secret = env.SESSION_SECRET || env.BOOKIT_SESSION_SECRET || env.BOOKIT_SECRET || env.SECRET || "";
  const secretFile = env.SECRET_FILE || path.join(rootDir, ".secret");
  if (secret.length < 32 && !fs.existsSync(secretFile)) errors.push("Provide a 32+ character session secret or a persistent SECRET_FILE");
  if (/^(0|false|no|off)$/i.test(env.ADMIN_MFA_REQUIRED || "")) errors.push("ADMIN_MFA_REQUIRED cannot be disabled in production");
  if (/^(1|true|yes|on)$/i.test(env.SEED_DEMO || "")) errors.push("SEED_DEMO must be disabled in production");
  // Match the transports the server actually implements. A variable for an
  // unimplemented provider must never make production startup look mail-ready.
  const mailReady = Boolean(env.RESEND_API_KEY || (env.SMTP_USER && env.SMTP_PASS));
  if (!mailReady && !/^(1|true|yes|on)$/i.test(env.ALLOW_EMAIL_DISABLED || "")) errors.push("Configure a production mail provider or explicitly set ALLOW_EMAIL_DISABLED=1 for a controlled maintenance window");
  const publicDir = path.join(rootDir, "public");
  for (const [name, raw] of [["DB_PATH", env.DB_PATH], ["DOCS_DIR", env.DOCS_DIR], ["PHOTOS_DIR", env.PHOTOS_DIR], ["BACKUP_DIR", env.BACKUP_DIR]]) {
    if (raw && isPathInside(raw, publicDir)) errors.push(`${name} must not be inside public/`);
  }
  const bind = env.BIND_HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(bind) && !/^(1|true|yes|on)$/i.test(env.ALLOW_PUBLIC_NODE_BIND || "")) {
    errors.push("BIND_HOST must be loopback when Caddy is the public reverse proxy");
  }
  if (!/^(1|true|yes|on)$/i.test(env.TRUST_PROXY || "")) warnings.push("TRUST_PROXY is not enabled; forwarded client IPs will not be used");
  return { ok: errors.length === 0, errors, warnings, appOrigin };
}

function assertProductionEnvironment(options = {}) {
  const result = validateProductionEnvironment(options);
  if (!result.ok) {
    const error = new Error(`Unsafe production configuration:\n- ${result.errors.join("\n- ")}`);
    error.code = "UNSAFE_PRODUCTION_CONFIGURATION";
    throw error;
  }
  return result;
}

function isBlockedStaticPath(urlValue) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(String(urlValue || "/"), "http://bookit.invalid").pathname); }
  catch { return true; }
  if (pathname.includes("\0") || pathname.split("/").some(part => part === "..")) return true;
  const base = path.posix.basename(pathname).toLowerCase();
  if (base.startsWith(".")) return true;
  if (/\.(?:bak|backup|old|orig|tmp|temp|swp|swo|sqlite|sqlite3|db|env|pem|key|crt|log|map)$/i.test(base)) return true;
  if (/^(?:package(?:-lock)?\.json|server\.js|start-here\.txt)$/i.test(base)) return true;
  return false;
}

function mimeType(filePath) {
  return MIME_TYPES[path.extname(String(filePath)).toLowerCase()] || "application/octet-stream";
}

function cacheControl(filePath) {
  const base = path.basename(String(filePath));
  const ext = path.extname(base).toLowerCase();
  if (ext === ".html") return "no-cache, no-store, must-revalidate";
  if (/\.[a-f0-9]{8,}\./i.test(base)) return "public, max-age=31536000, immutable";
  if ([".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".woff2", ".webm", ".mp4"].includes(ext)) {
    return "public, max-age=3600, stale-while-revalidate=86400";
  }
  return "no-cache";
}

function securityHeaders(req) {
  const production = process.env.NODE_ENV === "production";
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Frame-Options": "DENY"
  };
  if (production) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

class ExpiringMap extends Map {
  constructor(ttlMs = 15 * 60 * 1000) {
    super(); this.ttlMs = ttlMs; this.touched = new Map();
    this.timer = setInterval(() => this.prune(), Math.min(ttlMs, 60_000));
    this.timer.unref?.();
  }
  set(key, value) { this.touched.set(key, Date.now()); return super.set(key, value); }
  get(key) { const value = super.get(key); if (value !== undefined) this.touched.set(key, Date.now()); return value; }
  delete(key) { this.touched.delete(key); return super.delete(key); }
  clear() { this.touched.clear(); return super.clear(); }
  prune(now = Date.now()) { for (const [key, at] of this.touched) if (now - at > this.ttlMs) this.delete(key); }
}

function createExpiringMap(ttlMs) { return new ExpiringMap(ttlMs); }

module.exports = {
  SAFE_STATIC_EXTENSIONS,
  MIME_TYPES,
  neutralizeSpreadsheetText,
  safeSpreadsheetCell,
  safeCsvRow,
  trustedClientIp,
  validateBrowserRequest,
  timingSafeEqualText,
  detectMime,
  validateUploadedBuffer,
  decodeAndValidateUpload,
  extensionForMime,
  randomStorageName,
  installFsUploadGuards,
  redactEmail,
  redactUrl,
  redactLogValue,
  installConsoleRedaction,
  validateProductionEnvironment,
  assertProductionEnvironment,
  isBlockedStaticPath,
  mimeType,
  cacheControl,
  securityHeaders,
  createExpiringMap
};
