// Cooldown-aware retry helper.
//
// When ALL accounts for a provider are rate-limited, OmniRoute waits briefly
// for the earliest account to come off cooldown and retries the whole request
// once instead of immediately returning 503. VansRoute ports the same idea but
// with tighter bounds: max 30s wait, max 1 retry, clean abort on client
// disconnect.
//
// This module exposes one pure async helper so the retry decision + wait logic
// is unit-testable without spinning up the full chat handler.

export const MAX_RETRY_WAIT_MS = 30_000;
export const MAX_COOLDOWN_RETRIES = 1;

/**
 * Decide whether to wait-and-retry when all accounts are rate-limited.
 *
 * Returns `{ shouldRetry: false }` immediately when:
 *   - retryAfter is missing/invalid (can't compute a wait)
 *   - the required wait exceeds MAX_RETRY_WAIT_MS (30s) — not worth blocking the client
 *   - the client has already disconnected (abort signal already aborted)
 *   - we've already used our retry budget (retries >= MAX_COOLDOWN_RETRIES)
 *
 * Returns `{ shouldRetry: false, reason: "timeout" }` if the wait itself is
 * aborted (client disconnect during sleep) — the caller should return the
 * unavailable response in that case.
 *
 * Returns `{ shouldRetry: true, waitedMs }` after sleeping successfully.
 *
 * @param {object} opts
 * @param {string|number|Date|null} opts.retryAfter — earliest account cooldown expiry (ISO string, epoch ms, or Date)
 * @param {number} opts.retriesSoFar — how many cooldown retries already used
 * @param {AbortSignal} [opts.signal] — client disconnect signal; aborts the wait
 * @param {number} [opts.maxWaitMs] — override max wait (default 30s)
 * @param {number} [opts.maxRetries] — override retry budget (default 1)
 * @param {() => number} [opts.now] — injectable clock for tests (default Date.now)
 * @returns {Promise<{ shouldRetry: boolean, reason?: string, waitedMs?: number }>}
 */
export async function maybeWaitForCooldown({ retryAfter, retriesSoFar, signal, maxWaitMs = MAX_RETRY_WAIT_MS, maxRetries = MAX_COOLDOWN_RETRIES, now = Date.now }) {
  // Budget exhausted — don't wait.
  if (retriesSoFar >= maxRetries) {
    return { shouldRetry: false, reason: "budget_exhausted" };
  }

  // Client already disconnected — don't bother waiting.
  if (signal?.aborted) {
    return { shouldRetry: false, reason: "client_disconnected" };
  }

  // Compute required wait.
  const targetMs = toEpochMs(retryAfter);
  if (targetMs == null) {
    return { shouldRetry: false, reason: "invalid_retry_after" };
  }

  const waitMs = targetMs - now();
  if (waitMs <= 0) {
    // Already past the cooldown — retry immediately, no sleep needed.
    return { shouldRetry: true, waitedMs: 0 };
  }
  if (waitMs > maxWaitMs) {
    return { shouldRetry: false, reason: "wait_too_long" };
  }

  // Sleep with abort support. Resolves early (rejects) if the client disconnects.
  try {
    await sleepMs(waitMs, signal);
    return { shouldRetry: true, waitedMs: waitMs };
  } catch (e) {
    if (signal?.aborted) {
      return { shouldRetry: false, reason: "client_disconnected" };
    }
    // Unexpected abort reason — treat as not retryable.
    return { shouldRetry: false, reason: "wait_failed" };
  }
}

/**
 * Sleep for `ms` milliseconds, rejecting early if `signal` aborts.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleepMs(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason || new Error("aborted"));
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Normalize retryAfter (ISO string | epoch ms | Date) to epoch ms.
 * Returns null if the value is missing/unparseable.
 * @param {string|number|Date|null} value
 * @returns {number|null}
 */
function toEpochMs(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
