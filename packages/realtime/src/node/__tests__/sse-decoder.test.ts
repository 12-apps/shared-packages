import { describe, expect, it } from "vitest";

import { SseDecoder } from "../sse-decoder";

describe("SseDecoder", () => {
  it("yields one payload per complete frame", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("holds a frame split across chunks until it is complete", () => {
    const decoder = new SseDecoder();
    // The split falls mid-JSON and then between the two newlines that end the
    // frame — both are boundaries TCP hands out and a naive split loses.
    expect(decoder.push('data: {"top')).toEqual([]);
    expect(decoder.push('ic":"x"}\n')).toEqual([]);
    expect(decoder.push("\n")).toEqual(['{"topic":"x"}']);
  });

  it("reads CRLF framing", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"a":1}\r\n\r\n')).toEqual(['{"a":1}']);
  });

  it("joins multi-line data with a newline", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: one\ndata: two\n\n")).toEqual(["one\ntwo"]);
  });

  it("strips exactly one leading space, keeping the rest", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data:  padded\n\n")).toEqual([" padded"]);
  });

  it("ignores the id field the server sends alongside data", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('id: evt-1\ndata: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it("yields nothing for a frame carrying no data field", () => {
    const decoder = new SseDecoder();
    // A proxy's keepalive comment and a bare id. Either would be counted as a
    // message by a consumer treating message arrival as liveness.
    expect(decoder.push(": keepalive\n\nid: evt-1\n\n")).toEqual([]);
  });

  it("drops a half-written frame on reset", () => {
    const decoder = new SseDecoder();
    decoder.push("data: half");
    decoder.reset();
    // Without the reset this frame would read "halfdata: whole" — the dropped
    // tail glued onto the next stream's first line.
    expect(decoder.push("data: whole\n\n")).toEqual(["whole"]);
  });
});
