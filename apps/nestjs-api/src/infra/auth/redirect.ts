/**
 * Open-redirect protection, ported from Django:
 *   - base_host                 apps/api/plane/authentication/utils/host.py:16-63
 *   - get_allowed_hosts         apps/api/plane/utils/path_validator.py:91-102
 *   - validate_next_path        apps/api/plane/utils/path_validator.py:105-134
 *   - get_safe_redirect_url     apps/api/plane/utils/path_validator.py:137-181
 * SECURITY-SENSITIVE: this gates every post-login/signup redirect. Do not loosen any check
 * below without re-reading the Django source it mirrors.
 *
 * One deliberate deviation from the Django source: `validate_next_path` there extracts just the
 * `path` component of an absolute URL (e.g. "http://evil.com/x" -> "/x") and keeps validating that,
 * rather than rejecting outright. This port rejects outright whenever a scheme or netloc is present
 * at all -- strictly stricter, never weaker, and matches this codebase's test contract.
 */
import { ConfigService } from "../config/config.service";

export type Audience = "app" | "space" | "admin";

const SUSPICIOUS_PATTERNS = [
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "ftp:",
  "%2e%2e",
  "%2f%2f",
  "%5c%5c",
  "<script",
  "<iframe",
  "<object",
  "<embed",
  "<form",
  "onload=",
  "onerror=",
  "onclick=",
];

function containsSuspiciousPatterns(path: string): boolean {
  const lower = path.toLowerCase();
  return SUSPICIOUS_PATTERNS.some((pattern) => lower.includes(pattern));
}

// C0 control chars (0x00-0x1F) + space, stripped from the *start* only -- mirrors Python's
// urlsplit() lstrip(_WHATWG_C0_CONTROL_OR_SPACE), which is what lets "\x00http://evil.com" be
// scheme-sniffed as "http://evil.com" while trailing whitespace is left alone.
function lstripC0ControlOrSpace(s: string): string {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 0x20) i++;
  return s.slice(i);
}

/**
 * Minimal scheme/netloc/path split mirroring the security-relevant parts of Python's
 * urllib.parse.urlsplit: tabs/newlines are removed from anywhere in the string (this is what
 * lets a tab hide inside a scheme, e.g. "jav\tascript:" still sniffs as scheme "javascript"),
 * then leading control/space chars are stripped before scheme/netloc detection.
 */
function whatwgUrlParse(input: string): { scheme: string; netloc: string; path: string } {
  const noTabsOrNewlines = input.replace(/[\t\r\n]/g, "");
  const cleaned = lstripC0ControlOrSpace(noTabsOrNewlines);

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(cleaned);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "";
  const rest = schemeMatch ? schemeMatch[2] : cleaned;

  if (rest.startsWith("//")) {
    const afterSlashes = rest.slice(2);
    const end = afterSlashes.search(/[/?#]/);
    const netloc = end === -1 ? afterSlashes : afterSlashes.slice(0, end);
    const path = end === -1 ? "" : afterSlashes.slice(end).split(/[?#]/)[0];
    return { scheme, netloc, path };
  }

  return { scheme, netloc: "", path: rest.split(/[?#]/)[0] };
}

/** path_validator.py:91-102 */
export function getAllowedHosts(cfg: ConfigService): string[] {
  const allowedHosts: string[] = [];
  const settings = [
    cfg.get<string>("WEB_URL"),
    cfg.get<string>("APP_BASE_URL"),
    cfg.get<string>("ADMIN_BASE_URL"),
    cfg.get<string>("SPACE_BASE_URL"),
  ];
  for (const setting of settings) {
    if (setting) {
      const { netloc } = whatwgUrlParse(setting);
      if (netloc && !allowedHosts.includes(netloc)) allowedHosts.push(netloc);
    }
  }
  return allowedHosts;
}

/** path_validator.py:105-134 */
export function validateNextPath(nextPath: string | undefined): string {
  if (!nextPath || typeof nextPath !== "string") return "";

  // Limit input length to prevent DoS attacks.
  if (nextPath.length > 500) return "";

  // Browsers interpret backslashes as forward slashes -- strip them all (mirrors Django's
  // `.replace("\\", "")`, which removes rather than converts).
  let path = nextPath.split("\\").join("");

  const parsed = whatwgUrlParse(path);
  if (parsed.scheme || parsed.netloc) {
    // Reject outright rather than falling back to the extracted path component (see module
    // deviation note above).
    return "";
  }

  // Must start with a forward slash and not be empty.
  if (!path || !path.startsWith("/")) return "";

  // Prevent path traversal.
  if (path.includes("..")) return "";

  if (containsSuspiciousPatterns(path)) return "";

  return path;
}

// Django's url_has_allowed_host_and_scheme (django.utils.http), invoked from
// get_safe_redirect_url on the fully-assembled URL as a final host/scheme guard.
function urlHasAllowedHostAndScheme(url: string, allowedHosts: string[]): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  const check = (u: string): boolean => {
    if (u.startsWith("///")) return false;
    const { scheme, netloc } = whatwgUrlParse(u);
    if (!netloc && scheme) return false;
    if (u.length > 0 && u.charCodeAt(0) <= 0x1f) return false;
    const effectiveScheme = scheme || (netloc ? "http" : "");
    const validSchemes = ["http", "https"];
    return (!netloc || allowedHosts.includes(netloc)) && (!effectiveScheme || validSchemes.includes(effectiveScheme));
  };

  return check(trimmed) && check(trimmed.replace(/\\/g, "/"));
}

/** path_validator.py:137-181 */
export function getSafeRedirectUrl(
  cfg: ConfigService,
  baseUrl: string,
  nextPath: string,
  params: Record<string, string>,
): string {
  const validatedPath = validateNextPath(nextPath);
  const base = baseUrl.replace(/\/+$/, "");

  const queryParams: Record<string, string> = validatedPath ? { next_path: validatedPath, ...params } : { ...params };

  const hasParams = Object.keys(queryParams).length > 0;
  const url = hasParams ? `${base}/?${new URLSearchParams(queryParams).toString()}` : base;

  if (urlHasAllowedHostAndScheme(url, getAllowedHosts(cfg))) return url;

  // Not allowed: fall back to the base URL, dropping next_path but keeping the other params.
  const hasFallbackParams = Object.keys(params).length > 0;
  return hasFallbackParams ? `${base}?${new URLSearchParams(params).toString()}` : base;
}

function normalizeBasePath(path: string): string {
  let p = path;
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.endsWith("/")) p = p + "/";
  return p;
}

/** host.py:16-63 */
export function baseHost(cfg: ConfigService, audience: Audience): string {
  const baseOrigin = cfg.get<string>("WEB_URL") || cfg.get<string>("APP_BASE_URL") || "";

  if (audience === "admin") {
    const adminBaseUrl = cfg.get<string>("ADMIN_BASE_URL");
    const adminBasePath = normalizeBasePath(cfg.get<string>("ADMIN_BASE_PATH", "/god-mode/"));
    return adminBaseUrl ? adminBaseUrl + adminBasePath : baseOrigin + adminBasePath;
  }

  if (audience === "space") {
    const spaceBaseUrl = cfg.get<string>("SPACE_BASE_URL");
    const spaceBasePath = normalizeBasePath(cfg.get<string>("SPACE_BASE_PATH", "/spaces/"));
    return spaceBaseUrl ? spaceBaseUrl + spaceBasePath : baseOrigin + spaceBasePath;
  }

  // app
  return cfg.get<string>("APP_BASE_URL") || baseOrigin;
}
