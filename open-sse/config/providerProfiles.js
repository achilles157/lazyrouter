/**
 * Provider resilience profiles (ported from VansRouter).
 *
 * Thresholds and windows are tuned per provider auth category so that large
 * account pools do not trip the provider-level circuit breaker too quickly.
 * Keeps the proxy-aware breaker behavior of 9router intact.
 */

import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PROFILES = {
  oauth: {
    // OAuth sessions can be flaky and recover; give them more headroom.
    providerFailureThreshold: envInt("LAZYROUTER_PROVIDER_FAILURE_OAUTH_THRESHOLD", 10),
    providerFailureWindowMs: envInt("LAZYROUTER_PROVIDER_FAILURE_OAUTH_WINDOW_MS", 15 * 60 * 1000),
    providerCooldownMs: envInt("LAZYROUTER_PROVIDER_FAILURE_OAUTH_COOLDOWN_MS", 5 * 60 * 1000),
  },
  apikey: {
    // API key providers recover faster but can spam many accounts at once.
    providerFailureThreshold: envInt("LAZYROUTER_PROVIDER_FAILURE_APIKEY_THRESHOLD", 5),
    providerFailureWindowMs: envInt("LAZYROUTER_PROVIDER_FAILURE_APIKEY_WINDOW_MS", 30 * 1000),
    providerCooldownMs: envInt("LAZYROUTER_PROVIDER_FAILURE_APIKEY_COOLDOWN_MS", 30 * 1000),
  },
  local: {
    // Local providers are either up or down; fail fast.
    providerFailureThreshold: envInt("LAZYROUTER_PROVIDER_FAILURE_LOCAL_THRESHOLD", 2),
    providerFailureWindowMs: envInt("LAZYROUTER_PROVIDER_FAILURE_LOCAL_WINDOW_MS", 5 * 60 * 1000),
    providerCooldownMs: envInt("LAZYROUTER_PROVIDER_FAILURE_LOCAL_COOLDOWN_MS", 60 * 1000),
  },
};

const _categoryCache = new Map();

function providerSetIncludes(providerSet, id) {
  if (Array.isArray(providerSet)) {
    return providerSet.some((p) => String(p).toLowerCase() === id);
  }
  if (providerSet && typeof providerSet === "object") {
    return Object.keys(providerSet).some((key) => String(key).toLowerCase() === id);
  }
  return false;
}

function resolveProviderCategory(provider) {
  if (!provider) return "apikey";
  if (_categoryCache.has(provider)) return _categoryCache.get(provider);

  const id = String(provider).toLowerCase();
  let category = "apikey";
  if (providerSetIncludes(OAUTH_PROVIDERS, id)) {
    category = "oauth";
  } else if (providerSetIncludes(APIKEY_PROVIDERS, id)) {
    category = "apikey";
  } else if (id === "ollama" || id === "local" || id === "lmstudio" || id === "kobold") {
    category = "local";
  }

  _categoryCache.set(provider, category);
  return category;
}

/**
 * Return the resilience profile for a provider.
 * @param {string} provider
 * @returns {{ providerFailureThreshold: number, providerFailureWindowMs: number, providerCooldownMs: number }}
 */
export function getProviderResilienceProfile(provider) {
  return PROFILES[resolveProviderCategory(provider)] ?? PROFILES.apikey;
}

/**
 * Clear the provider-category cache. Useful in tests.
 */
export function clearProviderResilienceCache() {
  _categoryCache.clear();
}
