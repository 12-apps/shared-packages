import { RealtimeChannel } from "./connection";
import { topicServes } from "./subscription-registry";
import type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransportConfig,
  WireSourceFactory,
} from "./types";
import { mintTicketFor } from "./ws-source";

/**
 * One connection for a whole app, with a subscription that changes underneath it
 * (FUT-659).
 *
 * ## What this replaces
 *
 * Every `useRealtime()` call site used to own a channel, and every one of them lived
 * inside a page component. Navigating unmounted the page, the cleanup closed the
 * socket, the next page opened another — several at once on a screen with two
 * consumers, and a fresh handshake on every route change. Under SSE that handshake was
 * a `GET` the cookie already authorized. Under the WebSocket it is a ticket `POST`
 * that runs the full authorization pass plus, for a station-scoped caller, a database
 * read — per mount, unamortisable, because a ticket lives 30 s and authorizes one
 * subscription.
 *
 * The wire was never the limit: one connection has always been able to carry many
 * topics. What was missing was an owner for the UNION, and — before FUT-644 — any way
 * to change that union without reconnecting, which would have traded N short
 * connections for one that reopens on every navigation.
 *
 * ## The two wires diverge here, and only here
 *
 * On a WebSocket the union is mutated IN PLACE: mint a ticket for the topics that were
 * added, push a `subscribe`, push an `unsubscribe` for the ones that went away. On SSE
 * there is no back channel at all, so a changed union means a new stream — exactly the
 * old behaviour, which is the no-regression floor. A caller never learns which of the
 * two it got.
 *
 * ## Why `unsubscribe` needs the server's answers
 *
 * A screen asks for `kitchen`; the gateway holds `tenant:<id>:kitchen`, and
 * `unsubscribe` names topics in the server's spelling. The client cannot translate —
 * the mapping lives in the ticket, which is a credential it must not parse. So it
 * reads the RESOLVED list off the control frames the gateway already sends
 * (`readServedTopics`), and matches with the same suffix rule that routes events. A
 * `ping` on connect asks for that list immediately instead of waiting up to a
 * heartbeat for it.
 */

/**
 * Topics per ticket — the signed payload's own cap (`MAX_TICKET_TOPICS`), which exists
 * because a ticket travels in a query string.
 *
 * It bounds a single MINT, not the subscription. A union larger than this is not
 * refused: the connection opens with the first chunk and the rest arrive as `subscribe`
 * frames, each with its own ticket. That is the paging the cap was always going to need
 * once the union became per-user rather than per-screen, and it costs nothing when the
 * union is small.
 */
export const MAX_TOPICS_PER_TICKET = 16;

export interface SharedRealtimeChannelOptions {
  /** Subscribe endpoint WITHOUT a query, e.g. `/api/admin/<slug>/realtime`. */
  endpoint: string;
  onMessage: (message: RealtimeMessage) => void;
  onStatusChange: (status: RealtimeStatus) => void;
  /** Where the ws/ticket endpoints live, when they are not the defaults. */
  transport?: RealtimeTransportConfig;
  /** Test/transport seam — leave unset in app code. */
  createSource?: WireSourceFactory;
  /** Randomness for the channel's reconnect jitter; injected by tests. */
  random?: () => number;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function missingFrom(wanted: readonly string[], held: readonly string[]): string[] {
  return wanted.filter((topic) => !held.includes(topic));
}

export class SharedRealtimeChannel {
  private channel: RealtimeChannel | null = null;
  private status: RealtimeStatus = "disconnected";
  private desired: readonly string[] = [];
  /** What the CURRENT channel has been told to serve. Reset on every reopen. */
  private attached: readonly string[] = [];
  /**
   * The topics the channel's own URL carries.
   *
   * A reconnect re-runs the handshake against that URL and nothing else, so every
   * `subscribe` pushed since the last open is gone. Remembering the handshake set is
   * how `attached` gets rewound to the truth on a drop — without it the widened topics
   * would be silently missing after the first reconnect, and the reconcile pass would
   * see nothing to fix.
   */
  private handshake: readonly string[] = [];
  /** Resolved names, straight from the gateway's control frames. */
  private served: readonly string[] = [];
  /** Bumped on every teardown, so async work from a dead channel is dropped. */
  private generation = 0;
  private reconciling = false;
  private closed = false;
  /**
   * Set while a reopen was caused by the TOPICS changing rather than by anything going
   * wrong (the SSE path — see {@link reconcile}).
   *
   * It suppresses the `connecting` that a fresh channel always announces. From a
   * screen's point of view its subscription never lapsed, and reporting a transition
   * would say otherwise: a consumer that re-reads on every return to `connected` would
   * treat a routine station switch as a recovery from a dropped stream and issue the
   * widest invalidation it has, right behind the read the switch itself just triggered.
   *
   * Only `connecting` is held. If the new stream actually fails, the `disconnected`
   * that follows goes straight through and clears the flag — the suppression covers a
   * round trip, never a real outage.
   */
  private resubscribing = false;

  constructor(private readonly options: SharedRealtimeChannelOptions) {}

  /** Replace the union. Opens, mutates, reopens or closes as needed. */
  setTopics(next: readonly string[]): void {
    if (this.closed) return;
    this.desired = next;
    if (next.length === 0) {
      this.teardown();
      this.options.onStatusChange("disconnected");
      return;
    }
    if (!this.channel) {
      this.open();
      return;
    }
    void this.reconcile();
  }

  close(): void {
    this.closed = true;
    this.teardown();
  }

  private teardown(): void {
    this.generation += 1;
    this.channel?.close();
    this.channel = null;
    this.attached = [];
    this.handshake = [];
    this.served = [];
  }

  private subscribeUrl(topics: readonly string[]): string {
    return `${this.options.endpoint}?topics=${encodeURIComponent(topics.join(","))}`;
  }

  private open(): void {
    // The handshake carries only the first chunk; `onConnected` pushes the rest.
    this.handshake = this.desired.slice(0, MAX_TOPICS_PER_TICKET);
    this.attached = this.handshake;
    // Every callback below is bound to THIS generation. A closing channel announces
    // `disconnected` on its way out, and that announcement belongs to a connection this
    // object has already replaced — propagating it would tell every screen the stream
    // dropped in the middle of a routine resubscribe.
    const generation = this.generation;
    const isCurrent = (): boolean => generation === this.generation && !this.closed;
    this.channel = new RealtimeChannel({
      url: this.subscribeUrl(this.handshake),
      transport: this.options.transport,
      createSource: this.options.createSource,
      random: this.options.random,
      onMessage: (message) => {
        if (isCurrent()) this.options.onMessage(message);
      },
      onServedTopics: (topics) => {
        if (isCurrent()) this.served = topics;
      },
      onStatusChange: (status) => {
        if (!isCurrent()) return;
        this.status = status;
        if (status === "connected") {
          this.resubscribing = false;
          this.options.onStatusChange(status);
          this.onConnected();
          return;
        }
        // Not connected: whatever was pushed onto the old socket is gone, and the
        // gateway's spelling with it. Rewind to what a reconnect restores.
        this.attached = this.handshake;
        this.served = [];
        if (this.resubscribing && status === "connecting") return;
        this.resubscribing = false;
        this.options.onStatusChange(status);
      },
    });
  }

  private onConnected(): void {
    // Ask for the resolved topic list now rather than at the next heartbeat: until it
    // arrives there is no way to spell an `unsubscribe`. A no-op on SSE, where nothing
    // can be pushed.
    this.channel?.send({ type: "ping" });
    void this.reconcile();
  }

  /**
   * Does the live channel's own subscription disagree with what is wanted?
   *
   * Compared against the FIRST CHUNK only, because that is all a URL can carry
   * (`MAX_TOPICS_PER_TICKET`). Comparing the whole union instead would find a permanent
   * disagreement whenever it exceeds the cap, and every status change would reopen the
   * channel to satisfy it — a reconnect loop, on the one shape of subscription the
   * paging above exists to support.
   */
  private drifted(): boolean {
    const wanted = this.desired.slice(0, MAX_TOPICS_PER_TICKET);
    return (
      missingFrom(wanted, this.attached).length > 0 || missingFrom(this.attached, wanted).length > 0
    );
  }

  /** Replace the channel. `resubscribing` when the topics, not a fault, moved. */
  private reopen(resubscribing: boolean): void {
    const wasConnected = this.status === "connected";
    this.teardown();
    this.resubscribing = resubscribing && wasConnected;
    if (this.desired.length > 0) this.open();
  }

  /**
   * Bring the live subscription in line with `desired`.
   *
   * Serialised through `reconciling` because widening is asynchronous (a ticket round
   * trip) and a route change can land mid-flight: two overlapping passes would each
   * diff against a stale `attached` and re-subscribe what the other had just added. The
   * trailing re-entry at the end is what makes the last caller win rather than the
   * slowest.
   */
  private async reconcile(): Promise<void> {
    if (this.reconciling || this.closed || !this.channel) return;

    // Two cases, one answer: the URL is the only way to say what we want.
    //
    //   - SSE has no back channel at all — the pre-FUT-659 behaviour, kept deliberately
    //     as the no-regression floor.
    //   - A channel that has not opened yet cannot be sent to either, and this is the
    //     common case rather than an edge: the topics a screen wants are usually derived
    //     from a read (permissions, an open shift) that lands AFTER the first render, so
    //     the first union is routinely provisional. Waiting for `connected` would leave
    //     the connection permanently subscribed to whatever was known at mount.
    if (this.status !== "connected" || !this.channel.canSend) {
      if (this.drifted()) this.reopen(true);
      return;
    }

    this.reconciling = true;
    const target = this.desired;
    try {
      this.drop(missingFrom(this.attached, target));
      await this.widen(missingFrom(target, this.attached));
    } finally {
      this.reconciling = false;
    }
    // Identity, not contents: `setTopics` is only ever called with a fresh array the
    // registry built because the union really moved, so a different reference here means
    // exactly "the target changed while we awaited".
    if (this.desired !== target) void this.reconcile();
  }

  /** Narrow the subscription, translating specs through the served list. */
  private drop(specs: readonly string[]): void {
    if (specs.length === 0) return;
    const resolved = this.served.filter((topic) => specs.some((spec) => topicServes(topic, spec)));
    // Nothing resolved means the gateway never told us its spelling. Dropping is an
    // optimisation — the events would be filtered out client-side anyway — so skipping
    // is safe, and guessing a name would not be.
    if (resolved.length === 0) return;
    if (this.channel?.send({ type: "unsubscribe", topics: resolved })) {
      this.attached = this.attached.filter((spec) => !specs.includes(spec));
    }
  }

  /** Widen it, one ticket per chunk — see {@link MAX_TOPICS_PER_TICKET}. */
  private async widen(specs: readonly string[]): Promise<void> {
    const generation = this.generation;
    for (const batch of chunk(specs, MAX_TOPICS_PER_TICKET)) {
      let ticket: string;
      try {
        ticket = await mintTicketFor(this.subscribeUrl(batch), this.options.transport);
      } catch {
        // A refused ticket leaves the union short. Every consumer still has its polling
        // fallback, which is the documented degraded mode — and the next union change
        // tries again.
        return;
      }
      // The channel may have dropped or been replaced during the round trip; this ticket
      // describes a connection that no longer exists.
      if (this.closed || generation !== this.generation) return;
      if (!this.channel?.send({ type: "subscribe", ticket })) return;
      this.attached = [...this.attached, ...batch];
    }
  }
}
