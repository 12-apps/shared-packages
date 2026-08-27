import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { sendToNetworkPrinter } from "../index";

/**
 * The socket half, against a real socket.
 *
 * Mocking `node:net` here would assert that this module calls the functions it
 * calls, which is the one thing never in doubt. What IS in doubt is the shape
 * of a failure — and the reason it matters is that the caller cannot see the
 * printer either, so the code this returns is the entire basis for whatever an
 * operator is eventually told.
 */

let server: Server | null = null;
const open: Socket[] = [];

afterEach(async () => {
  const running = server;
  server = null;
  // `close()` stops accepting and then WAITS for live connections, and the
  // write-timeout case below deliberately leaves one wedged — so the sockets
  // have to be destroyed first or the hook hangs until vitest kills it.
  while (open.length > 0) open.pop()?.destroy();
  if (running !== null) await new Promise((resolve) => running.close(resolve));
});

/**
 * A listening socket that collects whatever is written to it.
 *
 * With no `onBytes` it never reads, which is how the write-timeout case below
 * wedges a connection that was established perfectly well.
 */
function listen(onBytes?: (chunk: Buffer) => void): Promise<number> {
  return new Promise((resolve) => {
    const created = createServer((socket) => {
      open.push(socket);
      if (onBytes !== undefined) socket.on("data", onBytes);
      socket.on("error", () => {});
    });
    server = created;
    created.listen(0, "127.0.0.1", () => {
      const address = created.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

describe("sendToNetworkPrinter", () => {
  it("reports ok once the bytes have left the process", async () => {
    const received: Buffer[] = [];
    let arrived: () => void = () => {};
    const delivered = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const port = await listen((chunk) => {
      received.push(chunk);
      arrived();
    });

    const result = await sendToNetworkPrinter("127.0.0.1", port, Uint8Array.from([1, 2, 3]));

    expect(result).toEqual({ ok: true });
    // Awaited rather than asserted straight away: `ok` is a claim about THIS
    // process — the bytes left it — and the far end receiving them is a
    // separate event. Asserting it synchronously would be racing the very gap
    // that makes "ok" a weaker promise than "printed".
    await delivered;
    expect(Buffer.concat(received)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("never throws when nothing is listening", async () => {
    // Every way a printer fails is an ordinary Tuesday. A throw here would make
    // an unplugged printer able to fail whatever queued the ticket.
    const result = await sendToNetworkPrinter("127.0.0.1", 1, Uint8Array.from([1]));

    expect(result.ok).toBe(false);
  });

  it("names the target and a reason rather than a sentence", async () => {
    const result = await sendToNetworkPrinter("127.0.0.1", 1, Uint8Array.from([1]));

    if (result.ok) throw new Error("expected a failure");
    expect(result.target).toBe("127.0.0.1:1");
    expect(result.reason).toBe("connection-error");
    // The package does not know the reader's language, so it does not try to
    // write for them. A host maps the code to its own copy.
    expect(Object.keys(result)).not.toContain("message");
  });

  it("blames the WRITE when a printer accepts the connection and then stalls", async () => {
    // The same `timeout` event fires either side of `connect`, so the module
    // carries a flag to tell them apart. Without it a printer that answered and
    // then wedged would be reported as unreachable, and an operator would be
    // sent to check a cable that is fine.
    //
    // Forced by never reading from the server end and writing more than the
    // kernel buffers: the write callback cannot fire, so the timeout does.
    const port = await listen();
    const tooMuch = new Uint8Array(64 * 1024 * 1024);

    const result = await sendToNetworkPrinter("127.0.0.1", port, tooMuch, {
      writeTimeoutMs: 150,
    });

    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("write-failed");
  });

  it("honours a caller's timeouts", async () => {
    const port = await listen();
    const started = Date.now();

    await sendToNetworkPrinter("127.0.0.1", port, new Uint8Array(64 * 1024 * 1024), {
      writeTimeoutMs: 120,
    });

    // The default is six seconds; a queue draining behind one wedged printer is
    // exactly why that has to be overridable.
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
