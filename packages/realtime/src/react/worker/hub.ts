import { mergeTopics, sameTopics } from "../subscription-registry";
import type { RealtimeMessage, RealtimeStatus } from "../types";

import { PORT_SILENCE_MS, readTabMessage, type WorkerMessage } from "./protocol";

/**
 * The SharedWorker's actual job (FUT-660): one connection per ENDPOINT, shared by every
 * tab on it.
 *
 * ## What it is deduplicating
 *
 * FUT-659 collapsed the connections a single page opened. This collapses the ones a
 * PERSON opens: a manager with one screen in one tab and another in a second held two
 * sockets, two ticket mints and two full authorization passes — a database read
 * included. A tablet with a few tabs parked open multiplied that straight onto the
 * backend.
 *
 * ## Grouped by endpoint, not by user
 *
 * The endpoint is what a subscription is authorized against, so two tabs on DIFFERENT
 * tenants must not share a connection — one ticket cannot be minted for both, and the
 * gateway is handed resolved names it may not mix. Grouping by endpoint makes that
 * structural rather than a rule someone has to remember.
 *
 * ## No React, no worker globals
 *
 * This class never touches `self`, `onconnect` or a real `MessagePort`, and the channel
 * arrives through a factory. So the sharing rules — union across tabs, a late tab
 * adopting the live status, a dead tab's topics being released — are tested directly,
 * and the worker entry stays a few lines of wiring.
 */

/** The half of a `MessagePort` this hub uses. */
export interface HubPort {
  postMessage(message: WorkerMessage): void;
}

/** The half of the shared channel this hub drives. */
export interface HubChannel {
  setTopics(topics: readonly string[]): void;
  close(): void;
}

/** How the hub builds a connection for an endpoint. Not exported: the constructor is
 * the only thing that names it. */
type HubChannelFactory = (
  endpoint: string,
  handlers: {
    onMessage: (message: RealtimeMessage) => void;
    onStatusChange: (status: RealtimeStatus) => void;
  },
) => HubChannel;

interface Member {
  endpoint: string | null;
  topics: readonly string[];
  lastSeenMs: number;
}

interface Group {
  channel: HubChannel;
  status: RealtimeStatus;
  members: Set<HubPort>;
  /**
   * The union this group last handed the channel.
   *
   * Kept so a tab joining or leaving without changing what the GROUP wants is silent:
   * the channel already treats an unchanged set as nothing to do, and saying it twice
   * would only make that guarantee depend on the other side.
   */
  lastUnion: readonly string[];
}

export class WorkerHub {
  private readonly members = new Map<HubPort, Member>();
  private readonly groups = new Map<string, Group>();

  constructor(private readonly createChannel: HubChannelFactory) {}

  /** A tab connected. It contributes nothing until it says what it wants. */
  connect(port: HubPort, nowMs: number): void {
    this.members.set(port, { endpoint: null, topics: [], lastSeenMs: nowMs });
  }

  /** One raw message from a tab. Anything the protocol does not name is ignored. */
  handle(port: HubPort, data: unknown, nowMs: number): void {
    const member = this.members.get(port);
    if (!member) return;
    const message = readTabMessage(data);
    if (!message) return;
    member.lastSeenMs = nowMs;
    if (message.type === "alive") return;
    if (message.type === "bye") {
      this.disconnect(port);
      return;
    }
    this.moveTo(port, member, message.endpoint, message.topics);
  }

  /** Drop a tab and release whatever only it wanted. */
  disconnect(port: HubPort): void {
    const member = this.members.get(port);
    if (!member) return;
    this.members.delete(port);
    if (member.endpoint) this.leave(port, member.endpoint);
  }

  /**
   * Drop tabs that stopped answering.
   *
   * The only way a closed tab is ever noticed: a SharedWorker is not told when a port
   * goes away, and `bye` is best effort — a crashed or discarded tab never sends one.
   */
  sweep(nowMs: number): void {
    for (const [port, member] of [...this.members]) {
      if (nowMs - member.lastSeenMs > PORT_SILENCE_MS) this.disconnect(port);
    }
  }

  /** Whether anything is still connected — the worker's idle check. */
  get isIdle(): boolean {
    return this.members.size === 0;
  }

  private moveTo(
    port: HubPort,
    member: Member,
    endpoint: string,
    topics: readonly string[],
  ): void {
    const previous = member.endpoint;
    member.endpoint = endpoint;
    member.topics = topics;
    if (previous && previous !== endpoint) this.leave(port, previous);

    const group = this.groups.get(endpoint) ?? this.openGroup(endpoint);
    group.members.add(port);
    // The status this tab must act on is the LIVE one, not the "disconnected" it starts
    // life believing: joining an already-connected group has to relax its poll
    // immediately, or a tab opened second polls fast forever.
    port.postMessage({ type: "status", status: group.status });
    this.applyUnion(endpoint, group);
  }

  private openGroup(endpoint: string): Group {
    const group: Group = {
      status: "disconnected",
      members: new Set<HubPort>(),
      lastUnion: [],
      channel: this.createChannel(endpoint, {
        onMessage: (message) => this.broadcast(endpoint, { type: "event", message }),
        onStatusChange: (status) => {
          const live = this.groups.get(endpoint);
          if (live) live.status = status;
          this.broadcast(endpoint, { type: "status", status });
        },
      }),
    };
    this.groups.set(endpoint, group);
    return group;
  }

  private leave(port: HubPort, endpoint: string): void {
    const group = this.groups.get(endpoint);
    if (!group) return;
    group.members.delete(port);
    if (group.members.size === 0) {
      this.groups.delete(endpoint);
      group.channel.close();
      return;
    }
    this.applyUnion(endpoint, group);
  }

  private applyUnion(endpoint: string, group: Group): void {
    const union = mergeTopics(
      [...group.members].map((port) => this.members.get(port)?.topics ?? []),
    );
    if (sameTopics(group.lastUnion, union)) return;
    group.lastUnion = union;
    group.channel.setTopics(union);
  }

  private broadcast(endpoint: string, message: WorkerMessage): void {
    const group = this.groups.get(endpoint);
    if (!group) return;
    for (const port of group.members) port.postMessage(message);
  }
}
