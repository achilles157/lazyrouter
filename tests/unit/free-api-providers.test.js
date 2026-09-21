// Provider gratis (API key + free tier) yang di-port dari VansRouter.
// Run: cd lazyrouter/tests && npx vitest run unit/free-api-providers.test.js
import { describe, it, expect } from "vitest";

import registry from "../../open-sse/providers/registry/index.js";
import { APIKEY_PROVIDERS, AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const PORTED = ["ai21", "baseten", "bytez", "deepinfra", "friendliai", "nscale"];

describe("provider gratis hasil port dari VansRouter", () => {
  it("semuanya terdaftar di registry", () => {
    const ids = new Set(registry.map((provider) => provider.id));
    for (const id of PORTED) expect(ids.has(id), `${id} tidak ada di registry`).toBe(true);
  });

  it("ditandai punya free tier, punya catatan free, dan punya endpoint HTTPS", () => {
    const byId = new Map(registry.map((provider) => [provider.id, provider]));
    for (const id of PORTED) {
      const provider = byId.get(id);
      expect(provider.hasFree, `${id} tidak ditandai hasFree`).toBe(true);
      expect(typeof provider.freeNote, `${id} tanpa freeNote`).toBe("string");
      expect(provider.freeNote.length).toBeGreaterThan(10);
      expect(provider.transport?.baseUrl, `${id} tanpa baseUrl`).toMatch(/^https:\/\//);
      expect(provider.transport?.validateUrl, `${id} tanpa validateUrl`).toMatch(/^https:\/\//);
      expect(provider.models?.length, `${id} tanpa model`).toBeGreaterThan(0);
    }
  });

  it("muncul sebagai provider apikey di konstanta bersama", () => {
    for (const id of PORTED) {
      expect(APIKEY_PROVIDERS[id], `${id} tidak masuk APIKEY_PROVIDERS`).toBeTruthy();
      expect(AI_PROVIDERS[id], `${id} tidak masuk AI_PROVIDERS`).toBeTruthy();
    }
  });

  it("tidak ada id provider yang duplikat di registry", () => {
    const ids = registry.map((provider) => provider.id);
    const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(dupes).toEqual([]);
  });
});
