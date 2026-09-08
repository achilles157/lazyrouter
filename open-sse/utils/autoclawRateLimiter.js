// Token bucket rate limiter for the AutoClaw upstream — ported from
// hirotomasato/autoclawpi (internal/server/ratelimit.go).
// Paces requests to autoglm-api so the WAF doesn't hard-block the IP.
// Global (process-wide) on purpose: the WAF gates by IP, not by account.

let tokens = 3; // burst capacity
let maxTokens = 3;
let refillRate = 1 / 1.5; // 1 request per 1.5s by default
let lastRefill = Date.now();

let waitQueue = Promise.resolve();

function refill() {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  if (elapsed > 0) {
    tokens = Math.min(maxTokens, tokens + elapsed * refillRate);
    lastRefill = now;
  }
}

function computeWaitMs() {
  refill();
  if (tokens >= 1) {
    tokens -= 1;
    return 0;
  }
  const needed = 1 - tokens;
  return Math.max(10, (needed / refillRate) * 1000);
}

/**
 * Wait until a token is available, then consume it. Serialized so concurrent
 * requests queue in FIFO order instead of all spinning on the bucket.
 * Resolves when the caller may proceed; rejects only if the signal aborts
 * while waiting.
 * @param {AbortSignal} [signal] - client disconnect signal
 * @param {{ ratePerSec?: number, burst?: number }} [opts] - override pacing
 */
export async function autoclawRateLimitWait(signal = null, opts = {}) {
  if (Number.isFinite(opts.burst) && opts.burst >= 1) {
    // Burst raised → top the bucket up so the new capacity is usable.
    if (opts.burst > maxTokens) tokens += opts.burst - maxTokens;
    maxTokens = opts.burst;
  }
  if (Number.isFinite(opts.ratePerSec) && opts.ratePerSec > 0) refillRate = opts.ratePerSec;

  const run = waitQueue.then(
    () =>
      new Promise((resolve, reject) => {
        const attempt = (remainingMs) => {
          if (signal?.aborted) {
            reject(signal.reason || new Error("aborted"));
            return;
          }
          const waitMs = computeWaitMs();
          if (waitMs === 0) {
            resolve();
            return;
          }
          const timer = setTimeout(() => attempt(0), waitMs);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              reject(signal.reason || new Error("aborted"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }
        };
        attempt(0);
      }),
  );
  // Keep the queue alive even if this waiter fails.
  waitQueue = run.then(() => {}, () => {});
  return run;
}

/** Test helper: reset bucket to defaults. */
export function __resetAutoclawRateLimiter() {
  tokens = 3;
  maxTokens = 3;
  refillRate = 1 / 1.5;
  lastRefill = Date.now();
}
