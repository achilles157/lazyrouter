import {
  AUTOCLAW_BASE_URL,
  autoclawUserapiHeaders,
} from "../../utils/autoclawSign.js";

/**
 * AutoClaw wallet balance — ported from hirotomasato/autoclawpi (fetchBalance).
 * Endpoint: GET /agent-assetmgr/api/v1/wallet-instances?biz_app_id=autoclaw
 * (the old /api/v2/wallets was the web-client route). Signed userapi headers
 * with lowercase `authorization` carrying the raw access token.
 */
export async function getAutoclawBalance(accessToken, _providerSpecificData = {}, _proxyOptions = null) {
  if (!accessToken) {
    throw new Error("autoclaw: accessToken required for wallet lookup");
  }
  const token = accessToken.replace(/^Bearer\s+/i, "");

  const res = await fetch(`${AUTOCLAW_BASE_URL}/agent-assetmgr/api/v1/wallet-instances?biz_app_id=autoclaw`, {
    method: "GET",
    headers: autoclawUserapiHeaders({ authorization: `Bearer ${token}` }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`autoclaw wallet ${res.status} ${text}`), {
      recoverable: res.status >= 500,
    });
  }

  const json = await res.json();
  const data = json.data || json;
  const balance = Number(data.total_balance ?? 0);

  return {
    provider: "autoclaw",
    plan: "AutoClaw Points",
    quotas: {
      points: {
        used: 0,
        total: balance,
        remaining: balance,
        resetAt: null,
        unlimited: false,
      },
    },
    balance,
    currency: "points",
  };
}
