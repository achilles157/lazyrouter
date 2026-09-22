// Provider hasil port iterasi 4: ZCode (apikey + oauth, format Claude) dan
// Qwen Code (oauth device-code). Ditambah helper retry yang ikut dibawa.
// Run: cd lazyrouter/tests && npx vitest run unit/zcode-qwen-providers.test.js
import { describe, it, expect } from "vitest";

import registry from "../../open-sse/providers/registry/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { ZcodeExecutor } from "../../open-sse/executors/zcode.js";
import { QwenExecutor } from "../../open-sse/executors/qwen.js";
import { capRetryAttemptsByAccountCount } from "../../open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS, OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";

const byId = new Map(registry.map((provider) => [provider.id, provider]));

describe("registry ZCode", () => {
  it("terdaftar sebagai apikey + oauth dengan transport format Claude", () => {
    const zcode = byId.get("zcode");
    expect(zcode).toBeTruthy();
    expect(zcode.category).toBe("apikey");
    expect(zcode.hasOAuth).toBe(true);
    expect(zcode.alias).toBe("zc");
    expect(zcode.hidden).toBeUndefined();
    expect(zcode.transport.format).toBe("claude");
    expect(zcode.transport.baseUrl).toBe("https://api.z.ai/api/anthropic/v1/messages");
    expect(zcode.transport.auth).toMatchObject({ combined: true, header: "x-api-key", scheme: "raw" });
  });

  it("membawa 4 model GLM dan konfigurasi oauth", () => {
    const zcode = byId.get("zcode");
    const ids = zcode.models.map((m) => m.id);
    expect(ids).toEqual(["GLM-5.2", "GLM-5.2-Max", "GLM-5-Turbo", "GLM-5-Turbo-Max"]);
    expect(zcode.oauth?.clientId).toBeTruthy();
    expect(zcode.oauth?.tokenUrl).toBe("https://zcode.z.ai/api/v1/oauth/token");
    expect(AI_PROVIDERS.zcode).toBeTruthy();
    expect(APIKEY_PROVIDERS.zcode).toBeTruthy();
  });

  it("memakai executor khusus, bukan default", () => {
    expect(getExecutor("zcode")).toBeInstanceOf(ZcodeExecutor);
  });
});

describe("registry Qwen Code", () => {
  it("terdaftar sebagai provider oauth", () => {
    const qwen = byId.get("qwen");
    expect(qwen).toBeTruthy();
    expect(qwen.category).toBe("oauth");
    expect(qwen.alias).toBe("qw");
    expect(qwen.oauth?.clientId).toBeTruthy();
    expect(qwen.oauth?.deviceCodeUrl).toContain("oauth2/device");
    expect(OAUTH_PROVIDERS.qwen).toBeTruthy();
    expect(AI_PROVIDERS.qwen).toBeTruthy();
  });

  it("menyediakan model Qwen Code dan executor khusus", () => {
    const qwen = byId.get("qwen");
    expect(qwen.models.map((m) => m.id)).toContain("qwen3-coder-plus");
    expect(getExecutor("qwen")).toBeInstanceOf(QwenExecutor);
  });
});

describe("capRetryAttemptsByAccountCount", () => {
  const config = { 429: { attempts: 5, delayMs: 100 }, 503: 4 };

  it("membiarkan konfigurasi apa adanya saat akun sedikit", () => {
    expect(capRetryAttemptsByAccountCount(config, 1)).toEqual(config);
    expect(capRetryAttemptsByAccountCount(config, 2)).toEqual(config);
    expect(capRetryAttemptsByAccountCount(config, 0)).toEqual(config);
  });

  it("membatasi 2 percobaan saat akun >= 3", () => {
    const capped = capRetryAttemptsByAccountCount(config, 3);
    expect(capped["429"].attempts).toBe(2);
    expect(capped["503"]).toBe(2);
  });

  it("membatasi 1 percobaan saat akun >= 5", () => {
    const capped = capRetryAttemptsByAccountCount(config, 6);
    expect(capped["429"].attempts).toBe(1);
    expect(capped["503"]).toBe(1);
  });
});
