/**
 * Basic SSRF guard for outbound webhook/link delivery: blocks obviously-internal hosts.
 * TODO(phase3): full pinned_fetch parity (DNS resolution + IP pinning against the connect target,
 * mirroring plane/utils/url_security.py) to defeat DNS-rebinding.
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"]);

export function isBlockedUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true; // unparseable → block
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  // Private/link-local IPv4 ranges
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^127\./.test(host)) return true;
  return false;
}
