export default {
  id: "gigachat",
  priority: 50,
  alias: "gigachat",
  display: {
    name: "GigaChat (Sber)",
    icon: "lock_person",
    color: "#10B981",
    textIcon: "GC",
    website: "https://developers.sber.ru",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://gigachat.devices.sberbank.ru/api/v1",
    validateUrl: "https://gigachat.devices.sberbank.ru/api/v1",
  },
  models: [
    { id: "GigaChat-2-Max", name: "GigaChat-2-Max" },
    { id: "GigaChat-2-Pro", name: "GigaChat-2-Pro" },
    { id: "GigaChat-2-Lite", name: "GigaChat-2-Lite" }
  ],
};
