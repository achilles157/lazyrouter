// Smoke test for the ported circuit breaker stack (recordProviderFailure layer).
// Run: cd lazyrouter && tests/node_modules/.bin/vitest run tests/unit/circuit-breaker-smoke.test.js
import { describe, it, expect, beforeEach } from "vitest";

import {
  getCircuitBreaker,
  resetAllCircuitBreakers,
  PROVIDER_FAILURE_ERROR_CODES,
} from "../../open-sse/utils/circuitBreaker.js";
import {
  recordProviderFailure,
  clearProviderFailure,
  isProviderFullyBlocked,
  getProviderShortestCooldownMs,
  clearProviderFailureDedup,
} from "../../open-sse/services/accountFallback.js";
import { classify429 } from "../../open-sse/utils/classify429.js";

const fakeLog = { warn: () => {}, info: () => {}, debug: () => {} };

describe("circuit breaker stack (ported from VansRouter)", () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
    clearProviderFailureDedup();
  });

  it("429 never counts toward provider failure", () => {
    for (let i = 0; i < 20; i++) {
      recordProviderFailure("prov429", 429, "rate limited", fakeLog, `conn-${i}`, "direct");
    }
    expect(isProviderFullyBlocked("prov429")).toBe(false);
  });

  it("opens after oauth-profile threshold of provider-level 5xx", () => {
    for (let i = 0; i < 10; i++) {
      recordProviderFailure("prov5x", 503, "upstream down", fakeLog, `conn-${i}`, "direct");
    }
    expect(isProviderFullyBlocked("prov5x")).toBe(true);
    expect(getProviderShortestCooldownMs("prov5x")).toBeGreaterThan(0);
  });

  it("per-proxy isolation: healthy direct bucket keeps provider usable", () => {
    // Register a healthy direct bucket first (e.g. from earlier traffic).
    getCircuitBreaker("provProxy:direct", { failureThreshold: 10, resetTimeout: 1000 });
    for (let i = 0; i < 10; i++) {
      recordProviderFailure("provProxy", 502, "down", fakeLog, `conn-${i}`, "proxy-abc");
    }
    // proxy-abc bucket is OPEN, but direct is CLOSED → provider not fully blocked
    expect(getCircuitBreaker("provProxy:proxy-abc").canExecute()).toBe(false);
    expect(isProviderFullyBlocked("provProxy")).toBe(false);

    // Now a different provider with ONLY an OPEN bucket → fully blocked
    for (let i = 0; i < 10; i++) {
      recordProviderFailure("provOnlyProxy", 502, "down", fakeLog, `conn-${i}`, "proxy-abc");
    }
    expect(isProviderFullyBlocked("provOnlyProxy")).toBe(true);
  });

  it("dedups rapid failures from the same connection", () => {
    for (let i = 0; i < 20; i++) {
      recordProviderFailure("provDedup", 500, "down", fakeLog, "same-conn", "direct");
    }
    // oauth threshold 10 — dedup should keep count at 1
    expect(isProviderFullyBlocked("provDedup")).toBe(false);
  });

  it("clearProviderFailure resets the bucket", () => {
    for (let i = 0; i < 10; i++) {
      recordProviderFailure("provClear", 500, "down", fakeLog, `conn-${i}`, "direct");
    }
    expect(isProviderFullyBlocked("provClear")).toBe(true);
    clearProviderFailure("provClear", "direct");
    expect(isProviderFullyBlocked("provClear")).toBe(false);
  });

  it("PROVIDER_FAILURE_ERROR_CODES excludes 429 and 401", () => {
    expect(PROVIDER_FAILURE_ERROR_CODES.has(429)).toBe(false);
    expect(PROVIDER_FAILURE_ERROR_CODES.has(401)).toBe(false);
    expect(PROVIDER_FAILURE_ERROR_CODES.has(500)).toBe(true);
    expect(PROVIDER_FAILURE_ERROR_CODES.has(524)).toBe(true);
  });

  it("classify429 kinds", () => {
    expect(classify429({ status: 429, body: "daily limit reached" }).kind).toBe("daily_quota");
    expect(classify429({ status: 429, body: "too many requests" }).kind).toBe("rate_limit");
    expect(classify429({ status: 429, body: "monthly quota exceeded" }).kind).toBe("quota_exhausted");
  });
});
