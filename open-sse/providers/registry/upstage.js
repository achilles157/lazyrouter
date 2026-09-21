export default {
  id: "upstage",
  priority: 50,
  alias: "upstage",
  display: {
    name: "Upstage",
    icon: "trending_up",
    color: "#0F766E",
    textIcon: "UP",
    website: "https://www.upstage.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.upstage.ai/v1/chat/completions",
    validateUrl: "https://api.upstage.ai/v1/models",
  },
  models: [
    { id: "solar-pro3", name: "solar-pro3" },
    { id: "solar-mini", name: "solar-mini" }
  ],
};
