import { randomUUID } from "node:crypto";

import { createNonceMemory, DEFAULT_LINK_PORT, type LinkPeer, type Message } from "../terminal-link";

import { privateBindAddresses } from "./terminal-bind";
import { ChargeBook, chargeBody, endsCharge } from "./terminal-charges";
import type { TerminalCancelAnswer, TerminalChargeAnswer, TerminalChargeRequest, TerminalEvent, TerminalState } from "./terminal-contract";
import { readHello } from "./terminal-handshake";
import { CLOSE, type StationConnection, type StationListeners, type TerminalLinkDeps, type TerminalLinkServer } from "./terminal-link-api";
import { openStoredLinks, readTerminalLinks, sealLinks, type TerminalLink } from "./terminal-link-cache";

/**
 * The station's LAN server for its paired terminal.
 *
 * The station's process listens; the payment terminal connects as a WebSocket
 * client and speaks first. Free of any server library: the host hands in its
 * WebSocket servers ({@link TerminalLinkDeps.listen}), the link source, the key
 * store and the settings file.
 *
 * - **Where it listens.** Only on the station's private IPv4 addresses
 *   (`./terminal-bind.ts`), never on every interface. Port
 *   {@link DEFAULT_LINK_PORT} unless the store overrides it. The addresses are
 *   re-read on every heartbeat tick and every `refreshLinks`: a station that
 *   booted before its Wi-Fi came up, or whose DHCP lease moved, listens on the
 *   new address and stops listening on the vanished one. A listen that failed
 *   (port taken) is retried on the next tick.
 * - **Who may connect.** The first frame must be the terminal's `hello`, signed
 *   with that device's link secret (`../terminal-link`). An unknown
 *   device, a bad mac, a stale or replayed hello, an unknown key: closed. After
 *   the handshake, any frame the protocol refuses closes the connection too.
 *   At most `maxPendingHandshakes` connections may be waiting on their hello
 *   at once; one past that is closed at once. A frame that arrives on a socket
 *   already closing is neither authenticated nor admitted.
 * - **One live connection per device.** A second hello from the same device
 *   replaces the first, which is closed: a terminal that lost the Wi-Fi and
 *   came back must not wait for the old socket to time out.
 * - **The heartbeat.** The station pings; a terminal that misses
 *   `maxMissedPongs` in a row is dropped and shows as disconnected.
 * - **The server down.** The links are kept in memory and on disk (secrets
 *   sealed), so a restart with no internet still recognises its terminal.
 *
 * **A charge's life.** It stays pending until the terminal says approved or
 * cancelled, or moves it to cash; a decline keeps it pending, since trying
 * again is the terminal's. While pending, the device is BUSY and the charge is
 * in `state()`, so a page that reloaded can see it and cancel it. A session
 * that dies does NOT end it — the terminal may still be charging, and its
 * answer comes on the next session. It is released, with a `charge-released`
 * event (outcome unknown), only when:
 * - the device is unlinked or re-paired (`refreshLinks`);
 * - the cashier cancels it while the terminal is away (`cancel` answers
 *   `OUTCOME_UNKNOWN`);
 * - the station stops.
 *
 * **A status for a charge that is not pending.**
 * - For a charge this station sent to THAT device and released since: an
 *   `approved` or `method_changed` is an `orphan-capture` event, carrying the
 *   capture. Money may have moved, so dropping it would risk charging the
 *   buyer twice; the host binds it to its sale or flags it for refund.
 *   Any other state for it is ignored: nothing was captured.
 * - For a charge never sent to that device: ignored, whatever it says. A
 *   terminal cannot make the station believe in a charge it did not push.
 */

const DEFAULT_PING_INTERVAL_MS = 5_000;
const DEFAULT_MAX_MISSED_PONGS = 3;
const DEFAULT_HELLO_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PENDING_HANDSHAKES = 8;

interface Live {
  readonly deviceId: string;
  readonly socket: StationConnection;
  readonly peer: LinkPeer<"station">;
  /** The secret the session was opened with: a re-pair that rotates it closes the session. */
  readonly secret: string;
  missed: number;
}

type StatusMessage = Extract<Message<"terminal">, { type: "status" }>;

class StationLinkServer implements TerminalLinkServer {
  private links: readonly TerminalLink[] = [];
  private readonly live = new Map<string, Live>();
  private readonly charges: ChargeBook;
  private readonly listeners: StationListeners;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private handshakes = 0;
  /** The tail of the `refreshLinks` queue. */
  private refreshing: Promise<unknown> = Promise.resolve();
  private readonly nonces: ReturnType<typeof createNonceMemory>;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: TerminalLinkDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => undefined);
    this.nonces = createNonceMemory({ now: this.now });
    this.charges = new ChargeBook((event) => this.emit(event));
    this.listeners = deps.listen((socket) => this.onConnection(socket), this.log);
  }

  async start(): Promise<void> {
    this.stopped = false;
    let reseal = false;
    this.links = await openStoredLinks(this.deps.cache.read(), this.deps.sealer, () => (reseal = true));
    // Stopped while the key store answered (a quit right after the start):
    // nothing may listen or beat after `stop()` returned.
    if (this.stopped) return;
    // The key store rotated its key: the links go back to disk sealed anew, once.
    if (reseal) await this.keepOnDisk();
    await this.syncListeners();
    if (this.listeners.idle) this.log("terminal-link: no private address to listen on yet");
    this.heartbeat = setInterval(() => this.beat(), this.deps.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
    this.emitState();
    void this.refreshLinks();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const entry of this.live.values()) entry.socket.close(CLOSE.goingAway, "station stopping");
    this.live.clear();
    this.charges.releaseAll("stopped");
    await this.listeners.stop();
  }

  refreshLinks(): Promise<boolean> {
    // One after another: an answer that was asked first lands first, so it never overwrites a newer one.
    const run = this.refreshing.then(() => this.refreshOnce());
    this.refreshing = run.catch(() => undefined);
    return run;
  }

  private async refreshOnce(): Promise<boolean> {
    await this.syncListeners();
    let fresh: TerminalLink[];
    try {
      fresh = readTerminalLinks(await this.deps.source());
    } catch (error) {
      this.log(`terminal-link: links not refreshed, keeping ${this.links.length}: ${String(error)}`);
      return false;
    }
    if (this.stopped) return false;
    this.links = fresh;
    this.dropStale();
    await this.keepOnDisk();
    this.emitState();
    return true;
  }

  /** The links in memory, sealed onto disk; a failure is logged and the links stay in memory. */
  private async keepOnDisk(): Promise<void> {
    try {
      await this.deps.cache.write(await sealLinks(this.links, this.deps.sealer));
    } catch (error) {
      this.log(`terminal-link: links not kept on disk: ${String(error)}`);
    }
  }

  addresses(): string[] {
    return this.listeners.addresses();
  }

  state(): TerminalState {
    return {
      listening: this.addresses(),
      terminals: this.links.map((link) => ({
        deviceId: link.deviceId,
        provider: link.provider,
        lanAddress: link.lanAddress,
        status: this.live.has(link.deviceId) ? "connected" : "disconnected",
        pending: this.charges.view(link.deviceId),
      })),
    };
  }

  charge(request: TerminalChargeRequest): TerminalChargeAnswer {
    const link = this.linkFor(request.deviceId);
    if (link === null) return { ok: false, code: request.deviceId === undefined && this.links.length > 1 ? "PICK_TERMINAL" : "NO_TERMINAL" };
    // BUSY before NOT_CONNECTED: a charge waiting on an away terminal is the cashier's to cancel first.
    if (this.charges.of(link.deviceId) !== undefined) return { ok: false, code: "BUSY" };
    const entry = this.live.get(link.deviceId);
    if (entry === undefined) return { ok: false, code: "NOT_CONNECTED" };
    const chargeId = randomUUID();
    if (!this.send(entry, entry.peer.seal({ type: "charge", ...chargeBody(chargeId, request) }))) return { ok: false, code: "NOT_CONNECTED" };
    const split = request.part === undefined || request.parts === undefined ? {} : { part: request.part, parts: request.parts };
    this.charges.add({ chargeId, deviceId: link.deviceId, secret: link.secret, amountCents: request.amountCents, method: request.method, ...split });
    this.emitState();
    return { ok: true, chargeId, deviceId: link.deviceId };
  }

  cancel(chargeId: string): TerminalCancelAnswer {
    const charge = this.charges.get(chargeId);
    if (charge === undefined) return "NO_CHARGE";
    const entry = this.live.get(charge.deviceId);
    if (entry !== undefined && this.send(entry, entry.peer.seal({ type: "cancel", chargeId }))) return "SENT";
    // The terminal cannot be told: the device is free again, and whether the buyer paid is unknown.
    this.charges.release(charge, "cancelled-away");
    this.emitState();
    return "OUTCOME_UNKNOWN";
  }

  ackTyped(deviceId: string, transactionCodes: readonly string[]): boolean {
    const entry = this.live.get(deviceId);
    if (entry === undefined || transactionCodes.length === 0) return false;
    return this.send(entry, entry.peer.seal({ type: "typed_ack", transactionCodes: [...transactionCodes] }));
  }

  /** The named link, or the only one when none is named (the cashier picks only among several). */
  private linkFor(deviceId: string | undefined): TerminalLink | null {
    if (deviceId !== undefined) return this.links.find((candidate) => candidate.deviceId === deviceId) ?? null;
    return this.links.length === 1 ? this.links[0]! : null;
  }

  private emit(event: TerminalEvent): void {
    try {
      this.deps.onEvent?.(event);
    } catch (error) {
      this.log(`terminal-link: a listener threw: ${String(error)}`);
    }
  }

  private emitState(): void {
    this.emit({ kind: "state", state: this.state() });
  }

  private send(entry: Live, raw: string): boolean {
    if (!entry.socket.isOpen()) return false;
    entry.socket.send(raw);
    return true;
  }

  /** Forget a session now (disconnected from this moment), if it is still the device's live one. Its pending charge stays. */
  private forget(entry: Live): void {
    if (this.live.get(entry.deviceId) !== entry) return;
    this.live.delete(entry.deviceId);
    this.emitState();
  }

  /** The hosts to listen on now: the fixed ones, or the private addresses the machine has right now. */
  private wantedHosts(): readonly string[] {
    if (this.deps.hosts !== undefined) return this.deps.hosts;
    const pick = this.deps.pickHosts ?? privateBindAddresses;
    try {
      return pick(this.deps.interfaces());
    } catch (error) {
      this.log(`terminal-link: could not read the interfaces: ${String(error)}`);
      return this.listeners.hosts();
    }
  }

  /** Follow the machine's addresses (see the header). */
  private async syncListeners(): Promise<void> {
    if (this.stopped) return;
    if (await this.listeners.sync(this.wantedHosts(), this.deps.port ?? DEFAULT_LINK_PORT)) this.emitState();
  }

  private onConnection(socket: StationConnection): void {
    const maxHandshakes = this.deps.maxPendingHandshakes ?? DEFAULT_MAX_PENDING_HANDSHAKES;
    if (this.handshakes >= maxHandshakes) {
      this.log("terminal-link: too many connections waiting on their hello; closed one");
      socket.close(CLOSE.busy, "too many handshakes");
      return;
    }
    this.handshakes += 1;
    let handshaking = true;
    const handshakeOver = (): void => {
      if (!handshaking) return;
      handshaking = false;
      this.handshakes -= 1;
    };
    let entry: Live | null = null;
    const timer = setTimeout(() => socket.close(CLOSE.helloTimeout, "no hello"), this.deps.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
    socket.onMessage((text, isBinary) => {
      // A socket already closing (we refused something) neither authenticates nor admits what follows.
      if (!socket.isOpen()) return;
      if (isBinary) return socket.close(CLOSE.malformed, "text only");
      if (entry !== null) return this.onSessionFrame(entry, text);
      clearTimeout(timer);
      handshakeOver();
      entry = this.authenticate(socket, text);
      if (entry !== null) this.emitState();
    });
    socket.onClose(() => {
      clearTimeout(timer);
      handshakeOver();
      if (entry !== null) this.forget(entry);
    });
    socket.onError((error) => this.log(`terminal-link: socket error: ${error.message}`));
  }

  /** The first frame: the terminal's hello, or the connection closes. */
  private authenticate(socket: StationConnection, raw: string): Live | null {
    const hello = readHello(raw, { links: this.links, stationId: this.deps.stationId(), nonces: this.nonces, now: this.now });
    if (!hello.ok) {
      if (hello.log !== undefined) this.log(`terminal-link: refused ${hello.log}`);
      socket.close(hello.code, hello.reason);
      return null;
    }
    return this.admit({ deviceId: hello.deviceId, socket, peer: hello.peer, secret: hello.secret, missed: 0 });
  }

  /** The device's live session from now on; the one it replaces is closed. Its pending charge carries over. */
  private admit(entry: Live): Live {
    const previous = this.live.get(entry.deviceId);
    this.live.set(entry.deviceId, entry);
    if (previous !== undefined) previous.socket.close(CLOSE.replaced, "replaced");
    entry.socket.send(entry.peer.hello());
    return entry;
  }

  private onSessionFrame(entry: Live, raw: string): void {
    const opened = entry.peer.open(raw);
    if (!opened.ok) {
      this.log(`terminal-link: refused a frame from ${entry.deviceId}: ${opened.refusal}`);
      this.forget(entry);
      entry.socket.close(CLOSE.refused, opened.refusal);
      return;
    }
    entry.missed = 0;
    const message = opened.message;
    if (message.type === "status") this.onStatus(entry, message);
    else if (message.type === "typed_captures") this.emit({ kind: "typed-captures", deviceId: entry.deviceId, captures: message.captures });
  }

  private onStatus(entry: Live, message: StatusMessage): void {
    const charge = this.charges.get(message.chargeId);
    if (charge === undefined || charge.deviceId !== entry.deviceId) return this.onLateStatus(entry, message);
    if (endsCharge(message)) this.charges.end(message.chargeId, message.state);
    this.emit({
      kind: "status",
      deviceId: entry.deviceId,
      chargeId: message.chargeId,
      state: message.state,
      ...(message.method === undefined ? {} : { method: message.method }),
      ...(message.capture === undefined ? {} : { capture: message.capture }),
    });
    if (endsCharge(message)) this.emitState();
  }

  /** A status for a charge that is not pending (see the header): an orphan capture, or nothing. */
  private onLateStatus(entry: Live, message: StatusMessage): void {
    const orphan = this.charges.orphan(entry.deviceId, message);
    if (orphan === null) return;
    this.log(`terminal-link: ${entry.deviceId} reported ${message.state} for released charge ${message.chargeId}`);
    this.emit(orphan);
  }

  private beat(): void {
    void this.syncListeners();
    const maxMissed = this.deps.maxMissedPongs ?? DEFAULT_MAX_MISSED_PONGS;
    for (const entry of [...this.live.values()]) {
      if (entry.missed < maxMissed) {
        entry.missed += 1;
        this.send(entry, entry.peer.seal({ type: "ping" }));
        continue;
      }
      this.log(`terminal-link: ${entry.deviceId} missed ${entry.missed} pongs; dropped`);
      this.forget(entry);
      entry.socket.terminate();
    }
  }

  /** Close every session the links no longer allow, and release the charges they held: unlinked, or re-paired with a new secret. */
  private dropStale(): void {
    for (const entry of [...this.live.values()]) {
      const link = this.links.find((candidate) => candidate.deviceId === entry.deviceId);
      if (link !== undefined && link.secret === entry.secret) continue;
      this.live.delete(entry.deviceId);
      entry.socket.close(CLOSE.unlinked, "unlinked");
    }
    for (const charge of this.charges.all()) {
      const link = this.links.find((candidate) => candidate.deviceId === charge.deviceId);
      if (link === undefined) this.charges.release(charge, "unlinked");
      else if (link.secret !== charge.secret) this.charges.release(charge, "repaired");
    }
  }
}

export function createTerminalLinkServer(deps: TerminalLinkDeps): TerminalLinkServer {
  return new StationLinkServer(deps);
}
