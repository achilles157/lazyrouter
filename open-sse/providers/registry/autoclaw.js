export default {
  id: "autoclaw",
  alias: "ac",
  uiAlias: "ac",
  display: {
    name: "AutoClaw",
    icon: "smart_toy",
    color: "#10A37F",
    website: "https://autoclaw.z.ai",
    notice: null,
  },
  category: "free",
  authModes: ["access_token"],
  hasOAuth: false,
  transport: {
    // Desktop-client inference proxy (autoclawpi 1.17.9 methods).
    // The executor overrides buildUrl to {base}/autoclaw-proxy/proxy/autoclaw/v1/chat/completions.
    baseUrl: "https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw/v1/chat/completions",
    format: "openai",
    forceStream: true,
    // Inference headers are unsigned; the executor builds them via autoclawInferenceHeaders
    // (X-Authorization + X-Harness-Type: zcode + X-Version 1.17.9 + X-Request-Model route id).
    headers: {},
    auth: { header: "X-Authorization", scheme: "bearer", combined: true },
  },
  models: [
    { id: "auto", name: "Auto", alias: "acauto" },
    { id: "auto-fast", name: "Auto Fast" },
    { id: "glm-5-turbo", name: "GLM-5 Turbo", alias: "glm5t" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ],
  features: { usage: true },
};
