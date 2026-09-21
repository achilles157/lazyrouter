export default {
  id: "databricks",
  priority: 50,
  alias: "databricks",
  display: {
    name: "Databricks",
    icon: "table_chart",
    color: "#F97316",
    textIcon: "DB",
    website: "https://www.databricks.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://adb-0000000000000000.0.azuredatabricks.net/serving-endpoints",
    validateUrl: "https://adb-0000000000000000.0.azuredatabricks.net/serving-endpoints",
  },
  models: [
    { id: "databricks-gpt-5", name: "databricks-gpt-5" },
    { id: "databricks-meta-llama-3-3-70b-instruct", name: "databricks-meta-llama-3-3-70b-instruct" },
    { id: "databricks-claude-sonnet-4", name: "databricks-claude-sonnet-4" },
    { id: "databricks-gemini-2-5-pro", name: "databricks-gemini-2-5-pro" }
  ],
};
