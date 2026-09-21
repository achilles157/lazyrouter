export default {
  id: "codestral",
  priority: 50,
  alias: "codestral",
  display: {
    name: "Codestral",
    icon: "terminal",
    color: "#FF7000",
    textIcon: "CS",
    website: "https://mistral.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://codestral.mistral.ai/v1/chat/completions",
    validateUrl: "https://codestral.mistral.ai/v1/models",
    quirks: {
      dropClientMetadata: true,
    },
  },
  models: [
    { id: "codestral-2508", name: "codestral-2508" },
    { id: "codestral-latest", name: "codestral-latest" }
  ],
};
