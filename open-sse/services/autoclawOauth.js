// AutoClaw OAuth (overseasv1) — ported from hirotomasato/autoclawpi client.go.
// Flow: captcha-config → oauth-url (with ali_captcha_verify_param when captcha
// is enabled) → user opens the returned URL → oauth-login exchanges code+state
// for access/refresh tokens.
// LazyRouter note: the dashboard currently imports tokens manually or via the
// browser automation; these functions expose the API-level steps so a future
// automation can drive the same flow the official desktop app uses.

import {
  AUTOCLAW_BASE_URL,
  autoclawUserapiHeaders,
} from "../utils/autoclawSign.js";

const NAVIGATE_URI_DEFAULT = "http://localhost:19723/auth/callback-google";

/**
 * GET captcha config: POST /userapi/overseasv1/oauth-captcha-config
 * Returns { enabled, region, prefix, scene_id, captcha_supplier } or null data.
 */
export async function getAutoclawCaptchaConfig() {
  const res = await fetch(`${AUTOCLAW_BASE_URL}/userapi/overseasv1/oauth-captcha-config`, {
    method: "POST",
    headers: autoclawUserapiHeaders(),
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => "");
  let json = {};
  try { json = JSON.parse(text); } catch {
    throw new Error(`autoclaw captcha-config: non-JSON HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (json.code !== 0 && json.code !== undefined) {
    throw new Error(`autoclaw captcha-config: code ${json.code} ${json.msg || ""}`);
  }
  return json.data || null;
}

/**
 * Request the vendor OAuth URL. vendor: "google" | "github" (per autoclawpi).
 * `captchaParam` is the ali_captcha_verify_param from a solved AliCloud captcha
 * (required when captcha-config.enabled is true).
 * Returns { oauthUrl, state }.
 */
export async function requestAutoclawOAuthUrl({
  vendor = "google",
  navigateUri = NAVIGATE_URI_DEFAULT,
  captchaParam = null,
} = {}) {
  const body = {
    source_id: "autoclaw",
    navigate_uri: navigateUri,
    device_id: globalThis.__autoclawDeviceId || crypto.randomUUID(),
  };
  if (captchaParam) body.ali_captcha_verify_param = captchaParam;
  if (vendor === "google") body.client_type = "pc";

  const res = await fetch(`${AUTOCLAW_BASE_URL}/userapi/overseasv1/${vendor}-oauth-url`, {
    method: "POST",
    headers: autoclawUserapiHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => "");
  let json = {};
  try { json = JSON.parse(text); } catch {
    throw new Error(`autoclaw oauth-url: non-JSON HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (json.code !== 0 || !json.data) {
    throw new Error(`autoclaw oauth-url: code ${json.code} ${json.msg || ""} ${text.slice(0, 200)}`);
  }
  const oauthUrl = json.data.oauth_url;
  if (!oauthUrl) throw new Error("autoclaw oauth-url: empty oauth_url");
  return { oauthUrl, state: json.data.state || "" };
}

/**
 * Exchange the OAuth code for tokens. Returns { accessToken, refreshToken, userId, userName }.
 */
export async function autoclawOAuthLogin({
  vendor = "google",
  code,
  state,
  navigateUri = NAVIGATE_URI_DEFAULT,
} = {}) {
  if (!code) throw new Error("autoclaw oauth-login: code required");
  const res = await fetch(`${AUTOCLAW_BASE_URL}/userapi/overseasv1/${vendor}-oauth-login`, {
    method: "POST",
    headers: autoclawUserapiHeaders(),
    body: JSON.stringify({
      code,
      state,
      navigate_uri: navigateUri,
      device_id: globalThis.__autoclawDeviceId || crypto.randomUUID(),
      source_id: "autoclaw",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => "");
  let json = {};
  try { json = JSON.parse(text); } catch {
    throw new Error(`autoclaw oauth-login: non-JSON HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = json.data;
  if (!data?.access_token) {
    throw new Error(`autoclaw oauth-login: code ${json.code} ${json.msg || ""} ${text.slice(0, 200)}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    userId: data.user_id ?? null,
    userName: data.user_name || null,
  };
}
