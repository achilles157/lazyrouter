/**
 * Utility functions for parsing and normalizing proxy URLs.
 * Handles standard URLs (http://, https://, socks4://, socks5://),
 * as well as host:port:user:pass, user:pass@host:port, and host:port.
 */

export function normalizeSingleProxyUrl(entry) {
  const str = String(entry || "").trim();
  if (!str) return null;

  // If already has protocol (http://, https://, socks4://, socks5://, etc.)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(str)) {
    try {
      const u = new URL(str);
      return u.toString();
    } catch {
      return null;
    }
  }

  // Format: user:pass@host:port
  if (str.includes("@")) {
    try {
      const u = new URL(`http://${str}`);
      return u.toString();
    } catch {
      return null;
    }
  }

  // Format: host:port:username:password
  const parts = str.split(":");
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (host && port && user && pass) {
      try {
        const u = new URL(`http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`);
        return u.toString();
      } catch {
        return null;
      }
    }
  }

  // Format: host:port
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    try {
      const u = new URL(`http://${parts[0]}:${parts[1]}`);
      return u.toString();
    } catch {
      return null;
    }
  }

  return null;
}

export function splitProxyUrls(value) {
  if (!value) return [];
  const rawEntries = String(value)
    .split(/[\r\n;,]+|\s+(?=(?:[a-zA-Z0-9+.-]+:\/\/|[a-zA-Z0-9.-]+:\d+))/i)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const results = [];
  for (const raw of rawEntries) {
    const normalized = normalizeSingleProxyUrl(raw) || raw;
    if (normalized) results.push(normalized);
  }
  return [...new Set(results)];
}
