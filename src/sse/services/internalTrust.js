import crypto from "node:crypto";
import { getConsistentMachineId } from "@/shared/utils/machineId";

// Internal CLI/dashboard trust token — same scheme as dashboardGuard.
// A request carrying a valid token originates from the local dashboard/CLI
// (which knows the machine-bound random secret). Such requests are treated as
// the local owner and bypass the per-API-key allow-lists (provider/combo/kind).
//
// SECURITY: this is a privilege-escalation gate. Everything here is written to
// fail CLOSED and to leak no information about the expected token:
//   - missing/empty/non-string header        → false
//   - header value not exactly the right shape → false (length check, no early exit on content)
//   - comparison is constant-time             → no timing side-channel
//   - any unexpected error                    → false
const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

// getConsistentMachineId(CLI_TOKEN_SALT) returns a 16-char lowercase hex string.
const EXPECTED_TOKEN_RE = /^[0-9a-f]{16}$/;

let _cachedCliToken = null;

// Test-only: clear the memoized token so different mocked machine IDs take effect.
export function __resetInternalTrustCacheForTests() {
  _cachedCliToken = null;
}

/**
 * Returns true ONLY when the request carries a valid internal CLI token, i.e.
 * it provably originates from the local dashboard/CLI rather than an external
 * API consumer. Trusted requests bypass the per-API-key ACL.
 *
 * @param {Request|{headers:{get(name:string):string|null}}} request
 * @returns {Promise<boolean>}
 */
export async function isTrustedInternalRequest(request) {
  try {
    const getter = request?.headers?.get;
    if (typeof getter !== "function") return false;

    const token = request.headers.get(CLI_TOKEN_HEADER);
    if (typeof token !== "string" || token.length === 0) return false;

    if (_cachedCliToken === null) {
      const computed = await getConsistentMachineId(CLI_TOKEN_SALT);
      _cachedCliToken = typeof computed === "string" ? computed : "";
    }
    // If the expected token is missing/malformed, fail closed — never accept.
    if (!EXPECTED_TOKEN_RE.test(_cachedCliToken)) return false;

    const provided = Buffer.from(token, "utf8");
    const expected = Buffer.from(_cachedCliToken, "utf8");
    // timingSafeEqual throws on length mismatch; bail first (length is not secret).
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}
