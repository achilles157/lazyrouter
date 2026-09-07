import {
  AUTOCLAW_BASE_URL,
  autoclawUserapiHeaders,
} from "../../utils/autoclawSign.js";

/**
 * AutoClaw token refresh — ported from hirotomasato/autoclawpi.
 * Endpoint: POST /userapi/v1/agent-refresh (the old /userapi/v1/refresh is the
 * deprecated web-client route). Signed userapi headers, desktop identity
 * (X-Tm linux / X-Client-Type pc / X-Version 1.17.9).
 */
export async function refreshAutoclawToken(credentials, _log, _proxyOptions, onRotated) {
  if (!credentials?.refreshToken) {
    throw new Error("autoclaw refresh: missing refreshToken");
  }
  const deviceId = credentials.providerSpecificData?.deviceId;
  if (!deviceId) {
    throw new Error("autoclaw refresh: missing deviceId in providerSpecificData");
  }

  const refreshToken = credentials.refreshToken.replace(/^Bearer\s+/i, "");

  const res = await fetch(`${AUTOCLAW_BASE_URL}/userapi/v1/agent-refresh`, {
    method: "POST",
    headers: autoclawUserapiHeaders(),
    body: JSON.stringify({
      source_id: "autoclaw",
      device_id: deviceId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`autoclaw refresh failed: ${res.status} ${text}`), {
      recoverable: res.status >= 500,
    });
  }

  const json = await res.json();
  if (json.code !== 0 && json.code !== undefined) {
    throw new Error(`autoclaw refresh: code ${json.code} ${json.message || ""}`);
  }
  const data = json.data || json;
  const accessToken = data.access_token || data.accessToken;
  const newRefreshToken = data.refresh_token || data.refreshToken;

  if (!accessToken || !newRefreshToken) {
    throw new Error("autoclaw refresh: missing tokens in response");
  }

  const newTokens = {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  if (typeof onRotated === "function") {
    await onRotated(newTokens);
  }
  return newTokens;
}
