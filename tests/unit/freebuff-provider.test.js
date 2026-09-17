// Smoke test for the ported freebuff provider (ported from VansRouter).
// Run: cd lazyrouter/tests && npx vitest run unit/freebuff-provider.test.js
import { describe, it, expect } from "vitest";

import registry from "../../open-sse/providers/registry/freebuff.js";
import { FreebuffExecutor, __test__ as execTest } from "../../open-sse/executors/freebuff.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

const { injectFreebuffMarker } = execTest;


describe("freebuff provider (ported from VansRouter)", () => {
  it("registry exposes freebuff with the Freebucks free model catalog", () => {
    expect(registry.id).toBe("freebuff");
    expect(registry.category).toBe("free");
    expect(registry.hasOAuth).toBe(true);
    expect(registry.models.length).toBe(12);
    expect(registry.models.map((m) => m.id)).toContain("deepseek/deepseek-v4-flash");
    expect(registry.models.map((m) => m.id)).toContain("z-ai/glm-5.3-flash");
  });

  it("PROVIDERS picks up transport + oauth from registry", () => {
    expect(PROVIDERS.freebuff?.baseUrl).toBe("https://www.codebuff.com/api/v1/chat/completions");
    expect(PROVIDER_OAUTH.freebuff?.baseUrl).toBe("https://freebuff.com");
    expect((PROVIDER_MODELS.fb || PROVIDER_MODELS.freebuff || []).length).toBe(12);
  });

  it("root agent id maps per model (Freebucks CLI 0.0.174 mapping)", () => {
    expect(execTest.rootAgentIdForModel("deepseek/deepseek-v4-flash")).toBe("base3-free-deepseek-flash");
    expect(execTest.rootAgentIdForModel("openai/gpt-5.6-luna")).toBe("base3-free-luna");
    expect(execTest.rootAgentIdForModel("z-ai/glm-5.3-flash")).toBe("base3-free-glm-5-3-flash");
    expect(execTest.rootAgentIdForModel("google/gemini-3.8-flash")).toBe("base3-free-gemini-3-8-flash");
  });

  it("root agent id fails fast for unmapped models (no base2-free fallback)", () => {
    expect(() => execTest.rootAgentIdForModel("unknown/model")).toThrow(/no free-tier agent/);
  });

  it("injectFreebuffMarker prepends canonical opening (idempotent)", () => {
    const body = { messages: [{ role: "system", content: "Be helpful." }, { role: "user", content: "hi" }] };
    const out = injectFreebuffMarker(body);
    expect(out.messages[0].content.startsWith("You are Buffy, the strategic coding assistant.")).toBe(true);
    // Idempotent
    const out2 = injectFreebuffMarker(out);
    expect(out2.messages[0].content.split("You are Buffy").length - 1).toBe(1);
  });

  it("executor transformRequest sets cost_mode free + provider fallbacks off", () => {
    const executor = new FreebuffExecutor();
    const body = { model: "m", messages: [{ role: "user", content: "hi" }], reasoning_effort: "low" };
    const out = executor.transformRequest("z-ai/glm-5.3-flash", body, true, {});
    expect(out.codebuff_metadata.cost_mode).toBe("free");
    expect(out.provider).toEqual({ allow_fallbacks: false });
    expect(out.reasoning_effort).toBeUndefined();
    // body.model is pinned to the normalized route id
    expect(out.model).toBe("z-ai/glm-5.3-flash");
  });
});
