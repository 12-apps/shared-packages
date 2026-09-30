/**
 * Turning a byte stream into the payloads a {@link WireSource} hands on.
 *
 * The browser has `EventSource` and never needs this. A NODE process — a
 * desktop agent, a worker, a CLI that watches a stream — has `fetch` and a
 * `ReadableStream` and nothing that speaks the event-stream format, so the
 * ten lines of framing have to exist somewhere. They exist HERE, once, rather
 * than in each consumer, and they are pure so they can be tested without a
 * socket.
 *
 * The format (WHATWG `text/event-stream`), reduced to what this wire uses:
 *
 *   - Frames are separated by a BLANK line.
 *   - A line is `field: value`; the space after the colon is optional and one
 *     leading space is stripped.
 *   - `data` accumulates: two `data:` lines in one frame join with `\n`.
 *   - Every other field is ignored here. `id` rides along on this wire but the
 *     channel de-duplicates on the envelope's own id, and `retry` is a hint
 *     the channel's own backoff already covers with jitter this one lacks.
 *   - A line starting with `:` is a comment. The server stopped sending those
 *     deliberately (see `../server/sse.ts` — a comment cannot reach the
 *     client's code), but a proxy may inject one, so they are dropped rather
 *     than parsed.
 *
 * A frame carrying no `data` field yields nothing: a lone `id:` or a stray
 * comment must not wake a consumer that is counting messages as liveness.
 */
export class SseDecoder {
  /** Bytes seen since the last frame boundary. */
  private buffer = "";

  /**
   * Feed a chunk and take whatever COMPLETE frames it finished.
   *
   * A chunk boundary falls wherever TCP put it — mid-line, mid-word, between
   * the two newlines that end a frame — so the tail is always kept rather than
   * parsed, and a caller that stops mid-frame simply never sees that frame.
   */
  push(chunk: string): string[] {
    // Normalised at the door: the spec allows CRLF, LF and a bare CR as line
    // breaks, and a parser that splits on "\n\n" alone silently accumulates
    // one enormous buffer against a server that uses CRLF.
    this.buffer += chunk.replace(/\r\n|\r/g, "\n");
    const payloads: string[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = dataOf(frame);
      if (data !== null) payloads.push(data);
      boundary = this.buffer.indexOf("\n\n");
    }
    return payloads;
  }

  /** Drop whatever a closed stream left half-written. */
  reset(): void {
    this.buffer = "";
  }
}

/** The `data` field of one frame, or `null` when it carries none. */
function dataOf(frame: string): string | null {
  const lines: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice("data:".length);
    lines.push(value.startsWith(" ") ? value.slice(1) : value);
  }
  return lines.length === 0 ? null : lines.join("\n");
}
