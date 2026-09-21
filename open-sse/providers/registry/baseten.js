export default {
  id: "baseten",
  priority: 50,
  alias: "baseten",
  display: {
    name: "Baseten",
    icon: "deployed_code",
    color: "#111827",
    textIcon: "BT",
    website: "https://baseten.co",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.baseten.co/v1/chat/completions",
    validateUrl: "https://inference.baseten.co/v1/models",
  },
  models: [
    { id: "moonshotai/Kimi-K2.6", name: "moonshotai/Kimi-K2.6" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "deepseek-ai/DeepSeek-V4-Pro" },
    { id: "zai-org/GLM-5", name: "zai-org/GLM-5" },
    { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMaxAI/MiniMax-M2.5" },
    { id: "nvidia/Nemotron-120B-A12B", name: "nvidia/Nemotron-120B-A12B" },
    { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b" }
  ],
  hasFree: true,
  freeNote: "$30 free trial credits for GPU inference",
};
