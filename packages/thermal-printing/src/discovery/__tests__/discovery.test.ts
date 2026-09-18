import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PRINTER_PORT,
  STATUS_QUERY,
  probePrinter,
  scanForPrinters,
  type InterfaceAddress,
} from "../index";

/**
 * The knocking half, against real sockets.
 *
 * What is in doubt here is the GRADE — whether a device that answered gets
 * reported as a printer, a maybe, or nothing at all. A merchant acts on that
 * grade, so it is asserted against a listener that behaves the way the awkward
 * half of this hardware behaves: one that answers the status request, one that
 * takes the connection and says nothing, and one that hangs up.
 */

const harness: { servers: Server[]; sockets: Socket[] } = { servers: [], sockets: [] };

/** Timeouts a test can afford. The defaults are tuned for a real sweep. */
const FAST = { probeTimeoutMs: 150, statusTimeoutMs: 120 };

afterEach(async () => {
  const running = harness.servers.splice(0, harness.servers.length);
  // Live connections are destroyed first: `close()` stops accepting and then
  // WAITS for them, so a wedged probe would hang the hook until vitest kills it.
  while (harness.sockets.length > 0) harness.sockets.pop()?.destroy();
  await Promise.all(running.map((server) => new Promise((done) => server.close(done))));
});

/** A listener on loopback. `behave` decides which kind of device it imitates. */
function listen(behave: (socket: Socket) => void, address = "127.0.0.1", port = 0): Promise<number> {
  return new Promise((resolve) => {
    const created = createServer((socket) => {
      harness.sockets.push(socket);
      socket.on("error", () => {});
      behave(socket);
    });
    harness.servers.push(created);
    created.listen(port, address, () => {
      const bound = created.address();
      resolve(typeof bound === "object" && bound !== null ? bound.port : 0);
    });
  });
}

/** A printer that implements real-time status: one byte back, and no paper. */
const answersStatus = (statusByte: number) => (socket: Socket) => {
  socket.on("data", (chunk: Buffer) => {
    if (chunk.equals(Buffer.from(STATUS_QUERY))) socket.write(Buffer.from([statusByte]));
  });
};

/** The cheap end of the class: takes the socket, implements nothing. */
const staysSilent = (): void => {};

describe("probePrinter", () => {
  it("confirms a device that answers the ESC/POS status request", async () => {
    const port = await listen(answersStatus(0x16));

    const found = await probePrinter("127.0.0.1", port, FAST);

    expect(found).toEqual({
      host: "127.0.0.1",
      port,
      confidence: "confirmed",
      statusByte: 0x16,
    });
  });

  it("still finds a printer that never implements real-time status", async () => {
    // Silence is not evidence against a printer — a great many of them simply
    // do not answer. Grading this as "nothing here" would hide the device.
    const port = await listen(staysSilent);

    const found = await probePrinter("127.0.0.1", port, FAST);

    expect(found).toEqual({ host: "127.0.0.1", port, confidence: "candidate" });
  });

  it("still reports a device that accepts the connection and hangs up", async () => {
    const port = await listen((socket) => socket.destroy());

    const found = await probePrinter("127.0.0.1", port, FAST);

    expect(found?.confidence).toBe("candidate");
  });

  it("reports nothing for an address with nothing behind it", async () => {
    // Bound and immediately closed, so the port is known to be free.
    const port = await listen(staysSilent);
    const running = harness.servers.pop();
    await new Promise((resolve) => running?.close(resolve));

    expect(await probePrinter("127.0.0.1", port, FAST)).toBeNull();
  });

  it("never throws for an unroutable address", async () => {
    // The expected outcome for 253 of the 254 doors on a shop's network.
    expect(await probePrinter("192.0.2.1", DEFAULT_PRINTER_PORT, FAST)).toBeNull();
  });
});

/**
 * A range around 127.0.0.2, so the sweep probes loopback and nothing else.
 *
 * `internal` is forced false because the real `os.networkInterfaces()` marks
 * loopback internal and `rangeFor` drops it — correct in production, useless
 * here, and this is the seam that exists for it. A /30 leaves exactly
 * 127.0.0.1 to probe; a /29 leaves .1 and .3 through .6.
 */
function loopbackRange(prefix: 29 | 30 = 30): InterfaceAddress[] {
  return [
    {
      name: "test0",
      address: "127.0.0.2",
      netmask: prefix === 30 ? "255.255.255.252" : "255.255.255.248",
      family: "IPv4",
      internal: false,
    },
  ];
}

describe("scanForPrinters", () => {
  it("finds a printer on the range it was pointed at", async () => {
    const port = await listen(answersStatus(0x12));

    const result = await scanForPrinters({ ...FAST, port, interfaces: loopbackRange() });

    expect(result.printers).toEqual([
      { host: "127.0.0.1", port, confidence: "confirmed", statusByte: 0x12 },
    ]);
    expect(result.aborted).toBe(false);
  });

  it("reports which ranges it swept, so a UI can say where it looked", async () => {
    const port = await listen(staysSilent);

    const result = await scanForPrinters({ ...FAST, port, interfaces: loopbackRange() });

    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.interfaceName).toBe("test0");
    expect(result.ranges[0]?.selfAddress).toBe("127.0.0.2");
  });

  it("finds nothing, without failing, when no door answers", async () => {
    const result = await scanForPrinters({
      ...FAST,
      port: DEFAULT_PRINTER_PORT,
      interfaces: [
        {
          name: "test0",
          // TEST-NET-1, reserved by RFC 5737 and routed nowhere.
          address: "192.0.2.2",
          netmask: "255.255.255.252",
          family: "IPv4",
          internal: false,
        },
      ],
    });

    expect(result.printers).toEqual([]);
    expect(result.ranges).toHaveLength(1);
  });

  it("stops when the caller aborts and says the list is incomplete", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await scanForPrinters({
      ...FAST,
      interfaces: loopbackRange(),
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.printers).toEqual([]);
  });

  it("offers the device that proved it speaks ESC/POS ahead of a mere open port", async () => {
    // Two listeners on one port, across two loopback addresses. The silent one
    // sits at the LOWER address, so sweep order alone would put it first — and
    // a UI that defaults to the head of the list would then offer the device
    // that proved nothing.
    const port = await listen(staysSilent, "127.0.0.1");
    await listen(answersStatus(0x12), "127.0.0.3", port);

    const result = await scanForPrinters({ ...FAST, port, interfaces: loopbackRange(29) });

    expect(result.printers.map((printer) => printer.host)).toEqual(["127.0.0.3", "127.0.0.1"]);
    expect(result.printers[0]?.confidence).toBe("confirmed");
  });
});
