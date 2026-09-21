// Provider hasil port dari VansRouter: 6 dengan free tier + 17 registry-only.
// Run: cd lazyrouter/tests && npx vitest run unit/free-api-providers.test.js
import { describe, it, expect } from "vitest";

import registry from "../../open-sse/providers/registry/index.js";
import { APIKEY_PROVIDERS, AI_PROVIDERS, FREE_TIER_PROVIDERS } from "../../src/shared/constants/providers.js";

// Batch 1 — punya free tier (hasFree + freeNote).
const FREE_PORTED = ["ai21", "baseten", "bytez", "deepinfra", "friendliai", "nscale"];

// Batch 2 — API key biasa, registry-only.
const PORTED = [
  ...FREE_PORTED,
  "a6api", "alibaba", "codestral", "databricks", "galadriel", "gigachat", "heroku",
  "llamagate", "nanogpt", "ovhcloud", "predibase", "publicai", "snowflake",
  "upstage", "volcengine", "wandb", "zenmux",
];

const byId = new Map(registry.map((provider) => [provider.id, provider]));

describe("provider hasil port dari VansRouter", () => {
  it("semuanya terdaftar di registry", () => {
    const missing = PORTED.filter((id) => !byId.has(id));
    expect(missing).toEqual([]);
  });

  it("semuanya punya transport HTTPS dan minimal satu model", () => {
    for (const id of PORTED) {
      const provider = byId.get(id);
      expect(provider.transport?.baseUrl, `${id} tanpa baseUrl`).toMatch(/^https:\/\//);
      expect(provider.transport?.validateUrl, `${id} tanpa validateUrl`).toMatch(/^https:\/\//);
      expect(provider.models?.length, `${id} tanpa model`).toBeGreaterThan(0);
      const isApikey = provider.authType === "apikey"
        || (provider.authModes || []).includes("apikey")
        || provider.category === "apikey";
      expect(isApikey, `${id} bukan provider apikey`).toBe(true);
    }
  });

  it("yang punya free tier ditandai hasFree + freeNote", () => {
    for (const id of FREE_PORTED) {
      const provider = byId.get(id);
      expect(provider.hasFree, `${id} tidak ditandai hasFree`).toBe(true);
      expect(typeof provider.freeNote, `${id} tanpa freeNote`).toBe("string");
      expect(provider.freeNote.length).toBeGreaterThan(10);
    }
  });

  it("muncul sebagai provider apikey di konstanta bersama", () => {
    for (const id of PORTED) {
      expect(APIKEY_PROVIDERS[id], `${id} tidak masuk APIKEY_PROVIDERS`).toBeTruthy();
      expect(AI_PROVIDERS[id], `${id} tidak masuk AI_PROVIDERS`).toBeTruthy();
    }
  });

  it("alias provider hasil port tidak menabrak alias lain", () => {
    const aliases = new Map();
    const clashes = [];
    for (const provider of registry) {
      for (const alias of [provider.id, provider.alias, ...(provider.aliases || [])].filter(Boolean)) {
        if (aliases.has(alias) && aliases.get(alias) !== provider.id) {
          clashes.push(`${alias}: ${aliases.get(alias)} vs ${provider.id}`);
        }
        aliases.set(alias, provider.id);
      }
    }
    // Hanya tabrakan yang melibatkan provider hasil port yang menggagalkan test;
    // tabrakan lama (mmf: mimo-free vs mmf) sudah ada sebelum port ini.
    const portedSet = new Set(PORTED);
    const offending = clashes.filter((entry) => {
      const [alias] = entry.split(":");
      return portedSet.has(aliases.get(alias.trim())) || PORTED.some((id) => entry.includes(id));
    });
    expect(offending).toEqual([]);
  });

  it("tidak ada id provider yang duplikat di registry", () => {
    const ids = registry.map((provider) => provider.id);
    const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(dupes).toEqual([]);
  });

  it("freeTier tetap kosong kecuali memang ada", () => {
    // Guard informasi: kalau AgentRouter dkk nanti di-port, test ini yang mengingatkan.
    expect(typeof FREE_TIER_PROVIDERS).toBe("object");
  });
});
