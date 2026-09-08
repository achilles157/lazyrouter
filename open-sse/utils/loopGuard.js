// Loop guard: stateless detection of repeating tool call patterns in conversation history.
// Analyzes messages array in the current request body - no cross-request state needed.
// Returns { detected: bool, hint: string|null }

const SINGLE_REPEAT_THRESHOLD = 3; // same tool+args appearing >= this many times in recent window
const SEQUENCE_REPEAT_THRESHOLD = 2; // same sequence of N tool calls appearing >= this many times
const MIN_SEQUENCE_LENGTH = 2; // minimum sequence length to detect
const MAX_SEQUENCE_LENGTH = 8; // maximum sequence length to detect
const RECENT_TOOL_WINDOW = 30; // only inspect recent tool calls (loops happen in recent turns)
const RECENT_ASSISTANT_MSGS = 10; // only inspect recent assistant messages for text loops

// Text-loop detection thresholds (symptom: model repeats planning/intent text
// without ever making a tool call — e.g. "I need to read the key files..." 6×).
const TEXT_MESSAGE_REPEAT_THRESHOLD = 3; // same normalized assistant message >= this many times
const TEXT_SENTENCE_REPEAT_THRESHOLD = 3; // same sentence across all assistant msgs >= this many times
const MIN_TEXT_LENGTH = 12; // ignore tiny fragments (< this many chars) to avoid false positives

/**
 * Normalize tool call arguments for stable hashing:
 * Sort object keys so {b:1,a:2} and {a:2,b:1} produce the same hash.
 */
function normalizeArgs(argsStr) {
  try {
    const obj = JSON.parse(argsStr);
    return JSON.stringify(obj, Object.keys(obj).sort());
  } catch {
    return argsStr || "";
  }
}

function toolCallHash(tc) {
  const name = tc?.function?.name || tc?.name || "";
  const args = normalizeArgs(tc?.function?.arguments || tc?.arguments || "");
  return `${name}::${args}`;
}

/**
 * Extract all tool_call hashes from conversation history in order.
 * Each assistant message with tool_calls contributes its calls in order.
 */
function extractToolCallSequence(messages) {
  const seq = [];
  for (const msg of messages) {
    if (msg?.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        seq.push(toolCallHash(tc));
      }
    }
  }
  return seq;
}

/**
 * Detect single tool call repeated >= SINGLE_REPEAT_THRESHOLD times in recent window.
 */
function detectSingleRepeat(seq) {
  const window = seq.length > RECENT_TOOL_WINDOW ? seq.slice(-RECENT_TOOL_WINDOW) : seq;
  const counts = new Map();
  for (const h of window) {
    counts.set(h, (counts.get(h) || 0) + 1);
    if (counts.get(h) >= SINGLE_REPEAT_THRESHOLD) return h;
  }
  return null;
}

/**
 * Fast O(L) check if the tail of the sequence repeats the preceding sequence.
 * Catches active loops (e.g. A, B, A, B or A, B, C, A, B, C).
 */
function detectTailRepeat(seq) {
  const n = seq.length;
  const maxLen = Math.min(MAX_SEQUENCE_LENGTH, Math.floor(n / SEQUENCE_REPEAT_THRESHOLD));
  for (let len = maxLen; len >= MIN_SEQUENCE_LENGTH; len--) {
    let isRepeat = true;
    for (let i = 0; i < len; i++) {
      if (seq[n - len + i] !== seq[n - len * 2 + i]) {
        isRepeat = false;
        break;
      }
    }
    if (isRepeat) {
      return seq.slice(n - len).join("|");
    }
  }
  return null;
}

/**
 * Detect a sequence of N tool calls that repeats >= SEQUENCE_REPEAT_THRESHOLD times.
 * Inspects immediate tail first, then searches within RECENT_TOOL_WINDOW.
 * Bound to at most RECENT_TOOL_WINDOW=30 items (executes in < 0.1ms).
 */
function detectSequenceRepeat(seq) {
  const tail = detectTailRepeat(seq);
  if (tail) return tail;

  const window = seq.length > RECENT_TOOL_WINDOW ? seq.slice(-RECENT_TOOL_WINDOW) : seq;
  const n = window.length;
  const maxLen = Math.min(MAX_SEQUENCE_LENGTH, Math.floor(n / SEQUENCE_REPEAT_THRESHOLD));

  for (let len = maxLen; len >= MIN_SEQUENCE_LENGTH; len--) {
    for (let start = 0; start <= n - len * 2; start++) {
      let count = 1;
      let pos = start + len;
      while (pos <= n - len) {
        let match = true;
        for (let k = 0; k < len; k++) {
          if (window[start + k] !== window[pos + k]) {
            match = false;
            break;
          }
        }
        if (match) {
          count++;
          if (count >= SEQUENCE_REPEAT_THRESHOLD) {
            return window.slice(start, start + len).join("|");
          }
          pos += len;
        } else {
          pos++;
        }
      }
    }
  }
  return null;
}

/**
 * Extract plain-text content from a single message (handles string + content-array).
 */
function messageText(msg) {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p) => p && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

/**
 * Normalize text for stable comparison: lowercase, collapse whitespace, strip
 * trailing punctuation. Keeps internal words so semantic repeats still match.
 */
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?…]+$/g, "")
    .trim();
}

/**
 * Split text into sentence-ish chunks for finer-grained repeat detection.
 * Uses common sentence delimiters (incl. newlines for planning-style text).
 */
function splitSentences(text) {
  return String(text || "")
    .split(/[\n.!?…]+/)
    .map((s) => normalizeText(s))
    .filter((s) => s.length >= MIN_TEXT_LENGTH);
}

/**
 * Extract all assistant message texts in conversation order.
 */
function extractAssistantTexts(messages) {
  const texts = [];
  for (const msg of messages) {
    if (msg?.role === "assistant") {
      const t = messageText(msg);
      if (t.length >= MIN_TEXT_LENGTH) texts.push(t);
    }
  }
  return texts;
}

/**
 * Detect text-only reasoning loops (no tool calls involved).
 * Catches two patterns:
 *  1. Same assistant message repeated >= TEXT_MESSAGE_REPEAT_THRESHOLD times
 *     (e.g. model emits "Subagent gagal. Saya cek langsung." 6× across turns)
 *  2. Same sentence appearing >= TEXT_SENTENCE_REPEAT_THRESHOLD times across
 *     all assistant messages (e.g. "I need to read the key files..." in 3+ msgs)
 * @param {object[]} messages
 * @returns {{ detected: boolean, hint: string|null }}
 */
function detectTextRepeat(messages) {
  const allTexts = extractAssistantTexts(messages);
  const texts = allTexts.length > RECENT_ASSISTANT_MSGS ? allTexts.slice(-RECENT_ASSISTANT_MSGS) : allTexts;
  if (texts.length < TEXT_MESSAGE_REPEAT_THRESHOLD) return { detected: false, hint: null };

  // 1. Exact message repeat (normalized)
  const msgCounts = new Map();
  for (const t of texts) {
    const norm = normalizeText(t);
    if (norm.length < MIN_TEXT_LENGTH) continue;
    const count = (msgCounts.get(norm) || 0) + 1;
    msgCounts.set(norm, count);
    if (count >= TEXT_MESSAGE_REPEAT_THRESHOLD) {
      return {
        detected: true,
        hint: "You have repeated the same response multiple times without making progress. This is a text loop — you are NOT moving forward. STOP repeating yourself. Either call a tool to act, or give your final answer now with the information you already have."
      };
    }
  }

  // 2. Sentence-level repeat across messages
  const sentenceCounts = new Map();
  for (const t of texts) {
    for (const s of splitSentences(t)) {
      const count = (sentenceCounts.get(s) || 0) + 1;
      sentenceCounts.set(s, count);
      if (count >= TEXT_SENTENCE_REPEAT_THRESHOLD) {
        return {
          detected: true,
          hint: "You keep repeating the same planning statement without acting on it. STOP planning in circles. Either execute a tool call NOW, or provide your final answer with current knowledge. Do not restate your plan again."
        };
      }
    }
  }

  return { detected: false, hint: null };
}

/**
 * Main loop detection function.
 * @param {object} body - the translated request body (must have messages array)
 * @returns {{ detected: boolean, hint: string|null }}
 */
export function detectLoop(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return { detected: false, hint: null };

  // Tool-call loop detection (existing)
  const seq = extractToolCallSequence(messages);
  if (seq.length >= SINGLE_REPEAT_THRESHOLD) {
    const singleRepeat = detectSingleRepeat(seq);
    if (singleRepeat) {
      return {
        detected: true,
        hint: "You have called the same tool with identical arguments multiple times with no new progress. STOP repeating. Summarize findings from existing results or change your strategy."
      };
    }

    const seqRepeat = detectSequenceRepeat(seq);
    if (seqRepeat) {
      return {
        detected: true,
        hint: "You have repeated the same sequence of tool calls multiple times. This is a loop. STOP this pattern immediately. Summarize what you have already found or take a completely different approach."
      };
    }
  }

  // Text-only loop detection (symptom 1: model repeats planning/intent text
  // without making tool calls — detectLoop's tool-call check misses this)
  const textLoop = detectTextRepeat(messages);
  if (textLoop.detected) return textLoop;

  return { detected: false, hint: null };
}
