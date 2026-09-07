// AutoClaw request signing — ported from hirotomasato/autoclawpi (v1.17.9).
// Recon of AutoClaw app 1.17.8+: header X-Auth-Sign is md5(APP_ID & ts & APP_KEY),
// APP_ID 100003. Used for userapi endpoints (login/refresh/profile/tasks).
// Inference proxy requests do NOT carry X-Auth-* — only X-Authorization + app headers.

import crypto from "node:crypto";

const APP_ID = "100003";
const APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";

export const AUTOCLAW_VERSION = "1.17.9";
export const AUTOCLAW_BASE_URL = "https://autoglm-api.autoglm.ai";
// Inference proxy base — chat requests go to <BASE>/autoclaw-proxy/proxy/autoclaw/v1/chat/completions
export const AUTOCLAW_INFERENCE_BASE = `${AUTOCLAW_BASE_URL}/autoclaw-proxy/proxy/autoclaw`;

export function autoclawSign(ts) {
  return crypto.createHash("md5").update(`${APP_ID}&${ts}&${APP_KEY}`).digest("hex");
}

function uuid() {
  return crypto.randomUUID();
}

// Standard userapi headers (signed). `ts` must match the caller's timestamp when
// the body also carries it. Desktop client identity: X-Tm linux, X-Client-Type pc.
export function autoclawUserapiHeaders(extra = {}) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    "content-type": "application/json",
    accept: "*/*",
    "x-product": "autoclaw",
    "x-version": AUTOCLAW_VERSION,
    "x-tm": "linux",
    "x-auth-appid": APP_ID,
    "x-auth-timestamp": String(ts),
    "x-auth-sign": autoclawSign(ts),
    "x-trace-id": uuid(),
    "x-lang": "en",
    "x-client-type": "pc",
    ...extra,
  };
}

// Inference proxy headers (unsigned). Mirrors autoclawpi's InferenceHeader.
export function autoclawInferenceHeaders(accessToken, routeModelId, stream = true) {
  const token = String(accessToken || "").replace(/^Bearer\s+/i, "");
  return {
    "content-type": "application/json",
    accept: stream ? "text/event-stream" : "application/json",
    "x-authorization": `Bearer ${token}`,
    "x-request-id": uuid(),
    "x-request-model": routeModelId || "",
    "x-product": "autoclaw",
    "x-harness-type": "zcode",
    "x-tm": "linux",
    "x-version": AUTOCLAW_VERSION,
    "x-lang": "id",
    "x-trace-id": uuid(),
    "user-agent": `AutoClaw/${AUTOCLAW_VERSION}`,
  };
}

// ── Model ↔ route-id mapping (from autoclawpi client.RouteID / BodyModel) ──

const DEEPSEEK_ROUTE_IDS = {
  "deepseek-v4-pro": "tdpsk_deepseek-v4-pro-202606",
  "deepseek-v4-flash": "tdpsk_deepseek-v4-flash-202605",
};

function isVersionedCodingPlan(model) {
  return model === "glm-5.3" || model === "glm-5.2";
}

// Map a user-facing model name to the AutoClaw route id.
// Models that already contain an underscore are assumed to be route ids.
export function autoclawRouteId(model) {
  const m = String(model || "");
  if (m.includes("_")) return m;
  if (DEEPSEEK_ROUTE_IDS[m]) return DEEPSEEK_ROUTE_IDS[m];
  if (isVersionedCodingPlan(m)) return `zaicoding_${m}`;
  return `zai_${m}`;
}

// Inverse: route id → the model string the upstream body expects
// ("zaicoding_glm-5.3" → "glm-5.3", "tdpsk_deepseek-v4-pro-202606" → "deepseek-v4-pro-202606").
export function autoclawBodyModel(routeId) {
  const idx = String(routeId || "").indexOf("_");
  return idx >= 0 ? routeId.slice(idx + 1) : routeId;
}
