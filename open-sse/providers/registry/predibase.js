export default {
  id: "predibase",
  priority: 50,
  alias: "predibase",
  display: {
    name: "Predibase",
    icon: "deployed_code_history",
    color: "#0F766E",
    textIcon: "PB",
    website: "https://predibase.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://serving.app.predibase.com/v1/chat/completions",
    validateUrl: "https://serving.app.predibase.com/v1/models",
  },
  models: [
    { id: "llama-3.3-70b", name: "llama-3.3-70b" }
  ],
};
