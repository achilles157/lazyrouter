// Smoke test for the autoclawpi (v1.17.9) methods ported to lazyrouter.
// Run: cd lazyrouter/tests && npx vitest run unit/autoclaw-v117.test.js
import { describe, it, expect } from "vitest";

import {
  autoclawRouteId,
  autoclawBodyModel,
  autoclawUserapiHeaders,
  autoclawInferenceHeaders,
  autoclawSign,
  AUTOCLAW_INFERENCE_BASE,
} from "../../open-sse/utils/autoclawSign.js";
import { stripAutoclawWafPrefixes } from "../../open-sse/utils/autoclawWaf.js";
import { AutoclawExecutor } from "../../open-sse/executors/autoclaw.js";

describe("autoclaw v1.17.9 methods (ported from autoclawpi)", () => {
  it("signs userapi headers with md5(appid&ts&appkey)", () => {
    const ts = 1700000000;
    const expected = autoclawSign(ts);
    const h = autoclawUserapiHeaders();
    expect(h["x-auth-appid"]).toBe("100003");
    expect(h["x-version"]).toBe("1.17.9");
    expect(h["x-tm"]).toBe("linux");
    expect(h["x-client-type"]).toBe("pc");
    expect(expected).toMatch(/^[0-9a-f]{32}$/);
  });

  it("builds inference headers with zcode harness + route model", () => {
    const h = autoclawInferenceHeaders("tok123", "zai_auto", true);
    expect(h["x-authorization"]).toBe("Bearer tok123");
    expect(h["x-harness-type"]).toBe("zcode");
    expect(h["x-request-model"]).toBe("zai_auto");
    expect(h.accept).toBe("text/event-stream");
    // No X-Auth-* on inference (unsigned path)
    expect(h["x-auth-sign"]).toBeUndefined();
  });

  it("maps model names to route ids and back", () => {
    expect(autoclawRouteId("glm-5.3")).toBe("zaicoding_glm-5.3");
    expect(autoclawRouteId("glm-5.2")).toBe("zaicoding_glm-5.2");
    expect(autoclawRouteId("glm-5-turbo")).toBe("zai_glm-5-turbo");
    expect(autoclawRouteId("auto")).toBe("zai_auto");
    expect(autoclawRouteId("auto-fast")).toBe("zai_auto-fast");
    expect(autoclawRouteId("deepseek-v4-pro")).toBe("tdpsk_deepseek-v4-pro-202606");
    expect(autoclawRouteId("deepseek-v4-flash")).toBe("tdpsk_deepseek-v4-flash-202605");
    // already a route id → passthrough
    expect(autoclawRouteId("zai_custom")).toBe("zai_custom");
    expect(autoclawBodyModel("zaicoding_glm-5.3")).toBe("glm-5.3");
    expect(autoclawBodyModel("tdpsk_deepseek-v4-pro-202606")).toBe("deepseek-v4-pro-202606");
  });

  it("strips WAF forbidden blobs (single, repeated, between-SSE)", () => {
    const waf = `{"message":"forbidden"}`;
    expect(stripAutoclawWafPrefixes(`${waf}data: [DONE]`)).toBe("data: [DONE]");
    expect(stripAutoclawWafPrefixes(`${waf}${waf}data: {"a":1}\n\n`)).toBe(`data: {"a":1}\n\n`);
    expect(stripAutoclawWafPrefixes("data: {\"clean\":1}\n\n")).toBe(`data: {"clean":1}\n\n`);
    expect(stripAutoclawWafPrefixes(waf)).toBe("");
  });

  it("executor targets v1 chat completions and rewrites model", () => {
    const e = new AutoclawExecutor();
    expect(e.buildUrl()).toBe(`${AUTOCLAW_INFERENCE_BASE}/v1/chat/completions`);
    const out = e.transformRequest("glm-5.3", { model: "ignored", messages: [] }, true, {});
    expect(out.model).toBe("glm-5.3"); // zaicoding_ prefix stripped
    const out2 = e.transformRequest("deepseek-v4-pro", { model: "ignored", messages: [] }, true, {});
    expect(out2.model).toBe("deepseek-v4-pro-202606");
  });
});
