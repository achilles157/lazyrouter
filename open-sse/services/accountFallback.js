import { ERROR_RULES, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS } from "../config/errorConfig.js";
import {
  getCircuitBreaker,
  getAllCircuitBreakerStatuses,
  resetCircuitBreaker,
  PROVIDER_FAILURE_ERROR_CODES,
} from "../utils/circuitBreaker.js";
import { classify429 } from "../utils/classify429.js";
import { getProviderResilienceProfile } from "../config/providerProfiles.js";

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: matches ERROR_RULES top-to-bottom (text rules first, then status)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkFallbackError(status, errorText, backoffLevel = 0) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  for (const rule of ERROR_RULES) {
    // Text-based rule: match substring in error message
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Check if account is currently unavailable (cooldown not expired)
 */
export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

/**
 * Calculate unavailable until timestamp
 */
export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

/**
 * Get the earliest rateLimitedUntil from a list of accounts
 * @param {Array} accounts - Array of account objects with rateLimitedUntil
 * @returns {string|null} Earliest rateLimitedUntil ISO string, or null
 */
export function getEarliestRateLimitedUntil(accounts) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/** Build the flat field key for a model lock */
export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check if a model lock on a connection is still active.
 * Reads flat field `modelLock_${model}` (or `modelLock___all` when model=null).
 */
export function isModelLockActive(connection, model) {
  const key = getModelLockKey(model);
  const expiry = connection[key] || connection[MODEL_LOCK_ALL];
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

/**
 * Get earliest active model lock expiry across all modelLock_* fields.
 * Used for UI cooldown display.
 */
export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * Build update object to set a model lock on a connection.
 */
export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Build update object to clear all model locks on a connection.
 */
export function buildClearModelLocksUpdate(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Filter available accounts (not in cooldown)
 */
export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter(acc => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

/**
 * Reset account state when request succeeds
 * Clears cooldown and resets backoff level to 0
 * @param {object} account - Account object
 * @returns {object} Updated account with reset state
 */
export function resetAccountState(account) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active"
  };
}

/**
 * Apply error state to account
 * @param {object} account - Account object
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @returns {object} Updated account with error state
 */
export function applyErrorState(account, status, errorText) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error"
  };
}

// ── Provider-level circuit breaker ──────────────────────────────────

/**
 * Check if a provider is currently blocked by the circuit breaker.
 * Proxy-aware: each proxy bucket has its own breaker so one dead proxy
 * doesn't block accounts on a different proxy.
 */
export function isProviderInCooldown(provider, proxyHash = "direct") {
  if (!provider) return false;
  const breaker = getCircuitBreaker(`${provider}:${proxyHash}`);
  return breaker ? !breaker.canExecute() : false;
}

/**
 * Get remaining retry-after time for a provider breaker (ms).
 * Proxy-aware.
 */
export function getProviderCooldownRemainingMs(provider, proxyHash = "direct") {
  if (!provider) return null;
  const breaker = getCircuitBreaker(`${provider}:${proxyHash}`);
  if (!breaker || breaker.canExecute()) return null;
  const remaining = breaker.getRetryAfterMs();
  return remaining > 0 ? remaining : null;
}

/**
 * Get the circuit breaker state for a provider.
 * Proxy-aware.
 */
export function getProviderBreakerState(provider, proxyHash = "direct") {
  if (!provider) return null;
  const breaker = getCircuitBreaker(`${provider}:${proxyHash}`);
  return breaker?.getStatus?.() ?? null;
}

/**
 * Record a provider failure against the shared circuit breaker.
 * Deduplicates rapid-fire failures from the same connection within 5s.
 * Proxy-aware: failures are attributed to the specific proxy bucket.
 */
const _lastProviderFailure = new Map();
const _dedupMs = 5_000;
const _dedupMaxSize = 10_000; // cap to prevent unbounded growth

/**
 * Clear the provider-failure dedup map. Used by tests and full resets.
 */
export function clearProviderFailureDedup() {
  _lastProviderFailure.clear();
}

export function recordProviderFailure(provider, statusCode, errorText, log, connectionId, proxyHash = "direct") {
  if (!provider) return;

  // Deduplicate
  if (connectionId) {
    const dedupKey = `${provider}:${proxyHash}:${connectionId}`;
    const now = Date.now();
    const last = _lastProviderFailure.get(dedupKey);
    if (last && now - last < _dedupMs) return;
    _lastProviderFailure.set(dedupKey, now);
    // Evict oldest entries when over the cap to prevent unbounded memory growth
    if (_lastProviderFailure.size > _dedupMaxSize) {
      const evictCount = Math.floor(_dedupMaxSize / 10);
      const keysToEvict = Array.from(_lastProviderFailure.keys()).slice(0, evictCount);
      for (const key of keysToEvict) _lastProviderFailure.delete(key);
    }
  }

  // Only count failure-eligible status codes
  if (statusCode && !PROVIDER_FAILURE_ERROR_CODES.has(statusCode)) return;

  const profile = getProviderResilienceProfile(provider);
  const breakerKey = `${provider}:${proxyHash}`;
  const breaker = getCircuitBreaker(breakerKey, {
    failureThreshold: profile.providerFailureThreshold,
    failureWindowMs: profile.providerFailureWindowMs,
    resetTimeout: profile.providerCooldownMs,
  });
  if (!breaker) return;
  if (!breaker.canExecute()) return; // already OPEN, skip

  breaker._onFailure({ statusCode, message: errorText });

  if (!breaker.canExecute()) {
    log?.warn?.("AUTH", `[ProviderFailure] ${breakerKey}: circuit breaker opened after ${breaker.failureCount} failures`);
  }
}

/**
 * Reset the shared provider breaker for a proxy bucket.
 * Proxy-aware.
 */
export function clearProviderFailure(provider, proxyHash = "direct") {
  if (!provider) return;
  resetCircuitBreaker(`${provider}:${proxyHash}`);
}

/**
 * Check if a status code should count toward provider failure threshold.
 */
export function isProviderFailureCode(status) {
  return PROVIDER_FAILURE_ERROR_CODES.has(status);
}

/**
 * Get all providers currently blocked by the circuit breaker.
 */
export function getProvidersInCooldown() {
  return getAllCircuitBreakerStatuses()
    .filter((s) => {
      const breaker = getCircuitBreaker(s.name);
      return Boolean(breaker && !breaker.canExecute());
    })
    .map((s) => ({
      provider: s.name,
      failureCount: s.failureCount,
      cooldownRemainingMs: s.retryAfterMs || null,
      lastFailureAt: s.lastFailureTime,
    }));
}

/**
 * Pipeline gate: returns true if the circuit breaker is OPEN for ALL known proxy
 * buckets of a provider. When true, the request should short-circuit BEFORE any
 * credential lookup — no point querying the DB when every bucket is blocked.
 * If even one proxy bucket can execute, returns false so the credential loop can
 * try accounts on that bucket.
 */
export function isProviderFullyBlocked(provider) {
  if (!provider) return false;
  const all = getAllCircuitBreakerStatuses();
  // Collect breaker names matching this provider: `${provider}:${proxyHash}`
  const providerBreakers = all.filter((s) => {
    const name = s.name || "";
    return name === provider || name.startsWith(`${provider}:`);
  });
  if (providerBreakers.length === 0) return false; // no breakers registered → not blocked
  // Blocked only if EVERY registered bucket is OPEN (canExecute=false)
  return providerBreakers.every((s) => {
    const breaker = getCircuitBreaker(s.name);
    return Boolean(breaker && !breaker.canExecute());
  });
}

/**
 * Get the shortest remaining cooldown across all proxy buckets for a provider.
 * Used to populate Retry-After when the pipeline gate blocks.
 */
export function getProviderShortestCooldownMs(provider) {
  if (!provider) return 0;
  const all = getAllCircuitBreakerStatuses();
  let shortest = Infinity;
  for (const s of all) {
    const name = s.name || "";
    if (name !== provider && !name.startsWith(`${provider}:`)) continue;
    const breaker = getCircuitBreaker(s.name);
    if (breaker && !breaker.canExecute()) {
      const remaining = breaker.getRetryAfterMs();
      if (remaining > 0 && remaining < shortest) shortest = remaining;
    }
  }
  return shortest === Infinity ? 0 : shortest;
}
