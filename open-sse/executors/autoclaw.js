import crypto from "node:crypto";
import { DefaultExecutor } from "./default.js";
import { PROVIDERS } from "../config/providers.js";
import { PROVIDER_MODELS } from "../config/providerModels.js";
import { dbg } from "../utils/debugLog.js";
import { stripAutoclawWafPrefixes } from "../utils/autoclawWaf.js";
import {
  AUTOCLAW_INFERENCE_BASE,
  autoclawInferenceHeaders,
  autoclawRouteId,
  autoclawBodyModel,
} from "../utils/autoclawSign.js";

/**
 * AutoClaw executor — ported from hirotomasato/autoclawpi (app v1.17.9 methods).
 *
 * Differences vs the old (1.10.0 web-client) implementation:
 *   - Inference goes through the desktop proxy path:
 *       {base}/autoclaw-proxy/proxy/autoclaw/v1/chat/completions
 *     (the old path without /v1 is the web client's and no longer reliable).
 *   - Inference headers are unsigned but MUST carry X-Harness-Type: zcode and
 *     X-Version: 1.17.9 (desktop identity), plus X-Request-Model = route id.
 *   - Model strings map to route ids: glm-5.3 → zaicoding_glm-5.3,
 *     glm-5-turbo → zai_glm-5-turbo, deepseek-v4-pro → tdpsk_deepseek-v4-pro-202606.
 *   - Upstream body model is the route id without its family prefix.
 *   - WAF gate: upstream may inject {"message":"forbidden"} blobs into the SSE
 *     stream — stripped in utils/stream.js via stripAutoclawWafPrefixes (also
 *     used here for non-streaming bodies).
 *   - 403 = hard WAF block on this account/IP; let the caller fall back to the
 *     next account (shouldFallback via error status).
 */

export { stripAutoclawWafPrefixes as stripWafPrefixes };

export class AutoclawExecutor extends DefaultExecutor {
  constructor() {
    super("autoclaw", PROVIDERS.autoclaw || { baseUrl: `${AUTOCLAW_INFERENCE_BASE}/v1/chat/completions`, format: "openai", headers: {} });
    this._currentModel = null;
  }

  buildUrl(_model, _stream, _urlIndex = 0, _credentials = null) {
    return `${AUTOCLAW_INFERENCE_BASE}/v1/chat/completions`;
  }

  buildHeaders(credentials, stream) {
    const token = credentials?.accessToken;
    if (!token) {
      throw new Error("autoclaw: missing accessToken");
    }
    return autoclawInferenceHeaders(token, this._routeId, stream);
  }

  transformRequest(model, body, stream, _credentials) {
    // Upstream expects the bare model (route id minus family prefix).
    return { ...body, model: autoclawBodyModel(autoclawRouteId(model)) };
  }

  async execute(args) {
    this._currentModel = args.model;
    this._routeId = autoclawRouteId(args.model);
    try {
      const result = await super.execute(args);
      if (result?.response && !result.response.ok) {
        dbg("AUTOCLAW", `upstream ${result.response.status}`);
      }
      return result;
    } finally {
      this._currentModel = null;
      this._routeId = null;
    }
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    const { refreshAutoclawToken } = await import("../services/tokenRefresh/autoclaw.js");
    return refreshAutoclawToken(credentials, log, proxyOptions, async (newTokens) => {
      const { updateProviderConnection } = await import("../../src/lib/db/index.js");
      await updateProviderConnection(credentials.connectionId, {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
        lastRefreshAt: new Date().toISOString(),
      });
    });
  }

  needsRefresh(credentials) {
    if (!credentials?.expiresAt) return true;
    const expiresAtMs = Date.parse(credentials.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return true;
    return expiresAtMs - Date.now() < 60 * 60 * 1000;
  }
}

export default AutoclawExecutor;
