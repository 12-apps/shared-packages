import { describe, expect, it, vi } from "vitest";

import { createSseSource } from "../sse-source";

/** A response whose body this test writes into, frame by frame. */
function streamedResponse(init: { status?: number; contentType?: string } = {}): {
  response: Response;
  write: (text: string) => void;
  end: () => void;
} {
  const chunks: ReadableStreamDefaultController<Uint8Array>[] = [];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.push(controller);
    },
  });
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/event-stream" },
  });
  return {
    response,
    write: (text) => chunks[0]?.enqueue(encoder.encode(text)),
    end: () => chunks[0]?.close(),
  };
}

/** Let the source's own async plumbing run between assertions. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("createSseSource", () => {
  it("opens, delivers each frame's payload, and reports the end as a drop", async () => {
    const stream = streamedResponse();
    const source = createSseSource("https://host.test/realtime?topics=kitchen", {
      fetch: vi.fn().mockResolvedValue(stream.response),
    });
    const opens: unknown[] = [];
    const messages: string[] = [];
    const errors: unknown[] = [];
    source.onopen = (event) => opens.push(event);
    source.onmessage = (event) => messages.push(event.data);
    source.onerror = (event) => errors.push(event);

    await settle();
    expect(opens).toHaveLength(1);

    stream.write('data: {"topic":"tenant:1:kitchen","type":"kitchen.card.moved"}\n\n');
    await settle();
    expect(messages).toEqual(['{"topic":"tenant:1:kitchen","type":"kitchen.card.moved"}']);

    // A clean end is still a drop: this wire has no "finished" state, and the
    // channel above must be told to open another stream.
    stream.end();
    await settle();
    expect(errors).toHaveLength(1);
  });

  it("asks for the event stream and carries the caller's headers", async () => {
    const doFetch = vi.fn().mockResolvedValue(streamedResponse().response);
    createSseSource("https://host.test/realtime", {
      fetch: doFetch,
      headers: { cookie: "session=abc" },
    });
    await settle();

    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ accept: "text/event-stream", cookie: "session=abc" });
  });

  it("refuses a 200 that is not an event stream", async () => {
    // The captive portal / expired-session case: a login page, status 200. A
    // client that read the status alone would report itself connected and then
    // never deliver anything.
    const errors: unknown[] = [];
    const source = createSseSource("https://host.test/realtime", {
      fetch: vi.fn().mockResolvedValue(new Response("<html>sign in</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })),
    });
    const opens: unknown[] = [];
    source.onopen = (event) => opens.push(event);
    source.onerror = (event) => errors.push(event);

    await settle();
    expect(opens).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("reports a refused request as a drop", async () => {
    const errors: unknown[] = [];
    const source = createSseSource("https://host.test/realtime", {
      fetch: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    source.onerror = (event) => errors.push(event);

    await settle();
    expect(errors).toHaveLength(1);
  });

  it("stays silent after close, so a deliberate stop wakes no reconnect", async () => {
    const stream = streamedResponse();
    const source = createSseSource("https://host.test/realtime", {
      fetch: vi.fn().mockResolvedValue(stream.response),
    });
    const errors: unknown[] = [];
    const messages: string[] = [];
    source.onerror = (event) => errors.push(event);
    source.onmessage = (event) => messages.push(event.data);

    await settle();
    source.close();
    stream.write("data: late\n\n");
    stream.end();
    await settle();

    expect(messages).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("offers no send, so a caller can tell there is no back channel", () => {
    const source = createSseSource("https://host.test/realtime", {
      fetch: vi.fn().mockResolvedValue(streamedResponse().response),
    });
    expect(source.send).toBeUndefined();
  });
});
