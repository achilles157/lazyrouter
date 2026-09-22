export default {
  id: "sambanova",
  priority: 50,
  alias: "samba",
  aliases: ["sambanova-ai"],
  uiAlias: "samba",
  authModes: ["apikey"],
  display: {
    name: "SambaNova",
    icon: "memory",
    color: "#DC2626",
    textIcon: "SN",
    website: "https://sambanova.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.sambanova.ai/v1/chat/completions",
    validateUrl: "https://api.sambanova.ai/v1/models",
  },
  models: [
    { id: "MiniMax-M2.7", name: "MiniMax-M2.7" },
    { id: "DeepSeek-V3.2", name: "DeepSeek-V3.2" },
    { id: "Llama-4-Maverick-17B-128E-Instruct", name: "Llama-4-Maverick-17B-128E-Instruct" },
    { id: "Meta-Llama-3.3-70B-Instruct", name: "Meta-Llama-3.3-70B-Instruct" },
    { id: "gpt-oss-120b", name: "gpt-oss-120b" }
  ],
  hasFree: true,
  freeNote: "$5 free credits on signup (30-day validity), no credit card required",
};
