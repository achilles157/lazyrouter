import { describe, it, expect } from "vitest";
import { detectLoop } from "../../open-sse/utils/loopGuard.js";

describe("LoopGuard (anti-lockup & loop detection)", () => {
  it("detects single tool call repeated 3+ times in recent window", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [{ function: { name: "search", arguments: '{"q":"foo"}' } }] },
        { role: "assistant", tool_calls: [{ function: { name: "search", arguments: '{"q":"foo"}' } }] },
        { role: "assistant", tool_calls: [{ function: { name: "search", arguments: '{"q":"foo"}' } }] },
      ],
    };
    const res = detectLoop(body);
    expect(res.detected).toBe(true);
    expect(res.hint).toContain("same tool with identical arguments");
  });

  it("detects sequence of tool calls repeated 2+ times", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [{ function: { name: "toolA", arguments: "{}" } }] },
        { role: "assistant", tool_calls: [{ function: { name: "toolB", arguments: "{}" } }] },
        { role: "assistant", tool_calls: [{ function: { name: "toolA", arguments: "{}" } }] },
        { role: "assistant", tool_calls: [{ function: { name: "toolB", arguments: "{}" } }] },
      ],
    };
    const res = detectLoop(body);
    expect(res.detected).toBe(true);
    expect(res.hint).toContain("same sequence of tool calls");
  });

  it("handles large conversation history (1,000+ messages) in milliseconds without event loop freeze", () => {
    const messages = [];
    for (let i = 0; i < 1000; i++) {
      messages.push({
        role: "assistant",
        tool_calls: [{ function: { name: `tool_${i}`, arguments: `{"i":${i}}` } }],
      });
    }
    const start = performance.now();
    const res = detectLoop({ messages });
    const duration = performance.now() - start;
    expect(res.detected).toBe(false);
    expect(duration).toBeLessThan(50);
  });

  it("detects text loops when assistant repeats the exact same message 3+ times in recent turns", () => {
    const body = {
      messages: [
        { role: "assistant", content: "I will now search for the files in the directory." },
        { role: "user", content: "continue" },
        { role: "assistant", content: "I will now search for the files in the directory." },
        { role: "user", content: "continue" },
        { role: "assistant", content: "I will now search for the files in the directory." },
      ],
    };
    const res = detectLoop(body);
    expect(res.detected).toBe(true);
    expect(res.hint).toContain("text loop");
  });
});
