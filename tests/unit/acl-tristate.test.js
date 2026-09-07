// Smoke test for the ported per-API-key ACL tri-state semantics.
// Run: cd lazyrouter/tests && npx vitest run unit/acl-tristate.test.js
import { describe, it, expect } from "vitest";

import { isProviderAllowed, isComboAllowed, isKindAllowed } from "../../src/sse/services/auth.js";
// Direct imports of the tri-state helpers would drag the whole auth.js DB chain;
// the helpers above are pure except isProviderAllowed's alias resolution, which
// needs the providers constants only.

describe("ACL tri-state (ported from VansRouter)", () => {
  const aliasKey = (allowed) => ({ allowedProviders: allowed, allowedCombos: allowed, allowedKinds: allowed });

  it("null apiKeyInfo (local/no key) allows everything", async () => {
    expect(await isProviderAllowed(null, "kiro")).toBe(true);
    expect(isComboAllowed(null, "mycombo")).toBe(true);
    expect(isKindAllowed(null, "llm")).toBe(true);
  });

  it("null list = all allowed", async () => {
    const info = aliasKey(null);
    expect(await isProviderAllowed(info, "kiro")).toBe(true);
    expect(isComboAllowed(info, "any-combo")).toBe(true);
    expect(isKindAllowed(info, "tts")).toBe(true);
  });

  it("empty array = none allowed (deny all)", async () => {
    const info = aliasKey([]);
    expect(await isProviderAllowed(info, "kiro")).toBe(false);
    expect(isComboAllowed(info, "mycombo")).toBe(false);
    expect(isKindAllowed(info, "llm")).toBe(false);
  });

  it("whitelist = only listed items allowed", async () => {
    const info = aliasKey(["kiro", "fb", "mycombo", "llm"]);
    expect(await isProviderAllowed(info, "kiro")).toBe(true);
    expect(await isProviderAllowed(info, "freebuff")).toBe(true); // alias fb
    expect(await isProviderAllowed(info, "codex")).toBe(false);
    expect(isComboAllowed(info, "mycombo")).toBe(true);
    expect(isComboAllowed(info, "other")).toBe(false);
    expect(isKindAllowed(info, "llm")).toBe(true);
    expect(isKindAllowed(info, "embedding")).toBe(false);
  });

  it("combo/ prefix is stripped before matching", () => {
    const info = aliasKey(["mycombo"]);
    expect(isComboAllowed(info, "combo/mycombo")).toBe(true);
  });
});
