export default {
  id: "galadriel",
  priority: 50,
  alias: "galadriel",
  display: {
    name: "Galadriel",
    icon: "auto_awesome",
    color: "#F59E0B",
    textIcon: "GA",
    website: "https://galadriel.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.galadriel.ai/v1/chat/completions",
    validateUrl: "https://api.galadriel.ai/v1/models",
  },
  models: [
    { id: "galadriel-latest", name: "galadriel-latest" }
  ],
};
