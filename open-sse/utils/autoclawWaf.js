// AutoClaw WAF prefix stripping (ported from hirotomasato/autoclawpi).
// The autoglm inference proxy sometimes injects standalone JSON blobs
// `{"message":"forbidden"}` before the real SSE payload — possibly several in
// a row, and a blob can be split across chunk boundaries. Strip them before
// the SSE line parser sees them.

const WAF_MARKER = `"message":"forbidden"`;

/**
 * Remove every WAF forbidden blob from `text`.
 * A blob is the standalone object starting at the `{` at/behind the marker and
 * ending at its matching `}` (brace-counted). Anything between blobs (e.g. the
 * "data: " prefix of the real event) is preserved. An incomplete blob at the
 * end of the chunk is dropped; its remainder is re-emitted by the upstream and
 * would be stripped again on the next chunk — because it never forms valid SSE,
 * dropping is safe.
 * @param {string} text
 * @returns {string}
 */
export function stripAutoclawWafPrefixes(text) {
  let out = text;
  while (true) {
    const idx = out.indexOf(WAF_MARKER);
    if (idx < 0) break;
    const start = out.lastIndexOf("{", idx);
    if (start < 0) {
      // Marker without an object start — dangling fragment, drop it.
      out = out.slice(0, idx) + out.slice(idx + WAF_MARKER.length);
      continue;
    }
    let depth = 0;
    let end = -1;
    let inString = false;
    let escape = false;
    for (let i = start; i < out.length; i++) {
      const ch = out[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) {
      // Incomplete blob (chunk boundary mid-object) — drop the partial object.
      out = out.slice(0, start);
      break;
    }
    out = out.slice(0, start) + out.slice(end + 1);
  }
  return out;
}
