import { createConnection } from "node:net";

/**
 * Writing ESC/POS to a printer that has an address.
 *
 * A Wi-Fi or Ethernet receipt printer listens on a TCP port — 9100 by
 * convention, the JetDirect "raw printing" port every printer in this class
 * implements — and prints whatever bytes arrive. There is no protocol above the
 * socket: no handshake, no acknowledgement, no status frame. Write, flush,
 * close.
 *
 * That absence is the whole shape of this module. **A successful write means
 * the bytes left this process, and nothing more.** The printer may be out of
 * paper, jammed, or a different device entirely that happened to answer on
 * :9100 — the socket cannot tell us. So a host that reports "printed" is making
 * a promise the transport never made; the honest states are "sent" and "could
 * not send", and a reprint the operator can trigger is the answer to everything
 * in between.
 *
 * Server-only, and Node-only: `node:net` exists in neither a browser nor an
 * edge runtime, which is one more reason a cable-attached printer takes the
 * other path entirely. It lives behind its own subpath so that importing the
 * encoders into a browser bundle never drags this in.
 */

/**
 * Why a send did not happen.
 *
 * A CODE rather than a sentence, and that is the package boundary doing its
 * job. This module knows the socket failed and how; it does not know what
 * language the person reading the screen speaks, nor how much of the address
 * that person is allowed to see. A host maps these to its own copy — which is
 * also what lets one host say "the printer at 10.0.0.9 did not answer" and
 * another say "the kitchen printer is offline" from the same event.
 */
export type PrintFailureReason =
  /** The connection was not established inside {@link CONNECT_TIMEOUT_MS}. */
  | "unreachable"
  /** The socket refused, reset, or failed to resolve. */
  | "connection-error"
  /** Connected, then the write itself failed or timed out. */
  | "write-failed";

export type PrintDeliveryResult =
  | { ok: true }
  | {
      ok: false;
      reason: PrintFailureReason;
      /** `host:port`, for a host that shows the operator which device. */
      target: string;
      /** The transport's own message, when it had one. Never localized. */
      detail?: string;
    };

/**
 * How long to wait on a printer before giving up.
 *
 * Short on purpose. A printer that is switched off does not refuse the
 * connection — it is simply absent, and the OS default would hold the socket
 * for over a minute. Whatever drains the host's queue runs behind this, so one
 * dead printer would otherwise stall every other printer's tickets for as long
 * as it took to find out.
 */
export const CONNECT_TIMEOUT_MS = 4_000;

/** …and how long the write itself may take once connected. */
export const WRITE_TIMEOUT_MS = 6_000;

export interface SendOptions {
  connectTimeoutMs?: number;
  writeTimeoutMs?: number;
}

/**
 * Send bytes to `host:port`.
 *
 * **Never throws.** A printer is a piece of hardware in somebody's shop and
 * every way it can fail is an ordinary Tuesday, not an exception. The caller
 * records the outcome and shows it; nothing here decides that a failed ticket
 * should also fail whatever the host was doing when it queued one.
 */
export function sendToNetworkPrinter(
  host: string,
  port: number,
  bytes: Uint8Array,
  options: SendOptions = {},
): Promise<PrintDeliveryResult> {
  const connectTimeout = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const writeTimeout = options.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
  const target = `${host}:${port}`;
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    const finish = (result: PrintDeliveryResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = createConnection({ host, port });
    socket.setTimeout(connectTimeout);

    socket.on("timeout", () => {
      // The same event means two different things either side of `connect`,
      // and a host that showed one sentence for both would tell an operator
      // to check the cable when the cable is fine.
      finish({ ok: false, reason: connected ? "write-failed" : "unreachable", target });
    });
    socket.on("error", (error: Error) => {
      finish({ ok: false, reason: "connection-error", target, detail: error.message });
    });
    socket.on("connect", () => {
      connected = true;
      // Re-armed once connected: reaching the printer and being unable to write
      // to it are different failures with different budgets, and a single
      // timeout covering both would report the wrong one.
      socket.setTimeout(writeTimeout);
      socket.write(bytes, (error) => {
        if (error) {
          finish({ ok: false, reason: "write-failed", target, detail: error.message });
          return;
        }
        // `end()` flushes and half-closes; the printer never replies, so the
        // close is what tells us the bytes are gone rather than any answer.
        socket.end(() => finish({ ok: true }));
      });
    });
  });
}
