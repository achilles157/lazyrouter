import { describe, expect, it } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

function encodeHeader(name, value) {
  const nameBuf = Buffer.from(name, "utf8");
  const valueBuf = Buffer.from(value, "utf8");
  const buf = Buffer.alloc(1 + nameBuf.length + 1 + 2 + valueBuf.length);
  let offset = 0;
  buf[offset++] = nameBuf.length;
  nameBuf.copy(buf, offset);
  offset += nameBuf.length;
  buf[offset++] = 7;
  buf.writeUInt16BE(valueBuf.length, offset);
  offset += 2;
  valueBuf.copy(buf, offset);
  return buf;
}

function buildEventFrame(eventType, payload) {
  const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const headersBuf = Buffer.concat([
    encodeHeader(":message-type", "event"),
    encodeHeader(":event-type", eventType),
    encodeHeader(":content-type", "application/json"),
  ]);
  const totalLength = 4 + 4 + 4 + headersBuf.length + payloadBuf.length + 4;
  const frame = Buffer.alloc(totalLength);
  frame.writeUInt32BE(totalLength, 0);
  frame.writeUInt32BE(headersBuf.length, 4);
  headersBuf.copy(frame, 12);
  payloadBuf.copy(frame, 12 + headersBuf.length);
  return frame;
}

async function transformFrames(requestBody) {
  const frames = [
    buildEventFrame("reasoningContentEvent", {
      reasoningContentEvent: { text: "hidden reasoning" },
    }),
    buildEventFrame("assistantResponseEvent", { content: "final answer" }),
  ];

  const source = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });

  const executor = new KiroExecutor();
  const response = executor.transformEventStreamToSSE(
    new Response(source, { status: 200, statusText: "OK" }),
    "claude-sonnet-4.6",
    requestBody
  );

  return await response.text();
}

describe("KiroExecutor reasoning stream policy", () => {
  it("hides reasoning chunks by default", async () => {
    const text = await transformFrames({});

    expect(text).toContain("final answer");
    expect(text).not.toContain("hidden reasoning");
    expect(text).not.toContain("reasoning_content");
  });

  it("emits reasoning chunks when explicitly enabled", async () => {
    const text = await transformFrames({ _kiroExposeReasoning: true });

    expect(text).toContain("final answer");
    expect(text).toContain("hidden reasoning");
    expect(text).toContain("reasoning_content");
  });
});
