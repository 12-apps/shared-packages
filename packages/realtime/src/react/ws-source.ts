import type { RealtimeTransportConfig, WireSource } from "./types";

/**
 * The WebSocket wire (FUT-643) — the second implementation of {@link WireSource},
 * beside the default `EventSource` one.
 *
 * ## Why this file is small
 *
 * `WireSource` is deliberately the INTERSECTION of `EventSource` and `WebSocket`, so
 * a browser `WebSocket` satisfies it natively. Everything below exists for the one
 * thing the two APIs genuinely disagree about — how the connection is authorized.
 *
 * ## The handshake, and why it takes two round trips
 *
 * `EventSource` sends cookies, so the SSE endpoint authorizes the request itself. The
 * `WebSocket` constructor cannot set headers, and the socket is served by a process
 * with no session (see `../gateway`). So:
 *
 *   1. POST the ticket endpoint on the API — a normal authenticated request, through
 *      the authorization that already exists.
 *   2. Open the socket with the short-lived signed ticket it returns.
 *
 * `WireSourceFactory` is SYNCHRONOUS, so that dance happens inside this object and
 * the handlers the channel installs are forwarded once the socket exists. A failure
 * at either step surfaces through `onerror`, which is exactly what the channel's
 * reconnect/backoff already handles — no new failure path.
 *
 * ## `close` is an error, deliberately
 *
 * `EventSource` reports a dropped stream through `onerror` and the channel's whole
 * recovery machine is built on that. A WebSocket reports it through `onclose`, which
 * the channel has no concept of — so a clean server close (a deploy, a
 * `stop_grace_period`) would silently strand a client that believes it is still
 * connected. Mapping `onclose` onto `onerror` keeps ONE recovery path for both
 * transports.
 */

/** How a subscribe URL maps to its ticket-minting sibling. */
export function ticketUrlFor(subscribeUrl: string): string {
  const [path = "", query = ""] = subscribeUrl.split("?");
  return query ? `${path}/ticket?${query}` : `${path}/ticket`;
}

/**
 * Where the gateway listens, derived from this context's own origin.
 *
 * `location`, not `window.location`: this module also runs inside a SharedWorker,
 * which has no `window` at all. Reading it through `window` failed the capability
 * check in `createWebSocketSource` rather than throwing, so the worker would have
 * quietly served every tab over SSE — a WebSocket switched off by accident. A
 * worker's `location` is its own script URL, same origin as the page that spawned it.
 */
export function defaultSocketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

/** Resolve the configured gateway endpoint, per attempt. */
function socketBase(transport: RealtimeTransportConfig | undefined): string {
  const configured = transport?.socketUrl;
  if (typeof configured === "function") return configured();
  return configured ?? defaultSocketUrl();
}

/** Append the ticket to the gateway endpoint, respecting a query it already has. */
export function socketUrlWithTicket(base: string, ticket: string): string {
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}ticket=${encodeURIComponent(ticket)}`;
}

/** `WebSocket.OPEN`, named so this module reads without the magic number. */
const WS_OPEN = 1;

/** The ticket endpoint's response envelope (the `{ data }` success wrapper). */
interface TicketResponse {
  data?: { ticket?: string };
}

/**
 * Mint a ticket at `ticketUrl`, or throw.
 *
 * Extracted from the handshake below because the handshake is no longer the only
 * caller: a shell that owns one long-lived connection widens it by minting a ticket
 * for the ADDED topics and pushing a `subscribe` frame, and that must be the same
 * request the handshake makes — same route, same credentials, same authorization — or
 * the two ways of acquiring a topic could disagree about who may have it.
 */
export async function fetchRealtimeTicket(ticketUrl: string): Promise<string> {
  const response = await fetch(ticketUrl, {
    method: "POST",
    // The ticket request is the authenticated half; without the session cookie it is
    // a 401 and the channel falls back to polling.
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    // 401/403/503 all mean the same thing to a client: no socket here.
    // Distinguishing them would only add branches with identical outcomes.
    throw new Error(`realtime ticket refused: ${response.status}`);
  }
  const body = (await response.json()) as TicketResponse;
  const minted = body.data?.ticket;
  if (!minted) throw new Error("realtime ticket response carried no ticket");
  return minted;
}

/** Mint through the configured seams, defaulting to the derived URL + real fetch. */
export function mintTicketFor(
  subscribeUrl: string,
  transport: RealtimeTransportConfig | undefined,
): Promise<string> {
  const url = (transport?.ticketUrl ?? ticketUrlFor)(subscribeUrl);
  return (transport?.fetchTicket ?? fetchRealtimeTicket)(url);
}

class WebSocketWireSource implements WireSource {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  private socket: WebSocket | null = null;
  /** Set by `close()`; suppresses every late callback from the async start. */
  private closed = false;

  constructor(
    subscribeUrl: string,
    private readonly transport: RealtimeTransportConfig | undefined,
  ) {
    void this.start(subscribeUrl);
  }

  private fail(reason: unknown): void {
    if (this.closed) return;
    this.onerror?.(reason);
  }

  private async start(subscribeUrl: string): Promise<void> {
    let ticket: string;
    try {
      ticket = await mintTicketFor(subscribeUrl, this.transport);
    } catch (error) {
      this.fail(error);
      return;
    }

    // The consumer may have unmounted during the round trip; opening a socket now
    // would leak one nothing will ever close.
    if (this.closed) return;

    try {
      const socket = new WebSocket(socketUrlWithTicket(socketBase(this.transport), ticket));
      this.socket = socket;
      socket.onopen = (event) => {
        if (!this.closed) this.onopen?.(event);
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        if (!this.closed) this.onmessage?.({ data: String(event.data) });
      };
      socket.onerror = (event) => this.fail(event);
      // See the module docstring: one recovery path for both transports.
      socket.onclose = (event) => this.fail(event);
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Push a frame. `false` when there is nothing to push it through.
   *
   * The socket is opened ASYNCHRONOUSLY — the ticket round trip happens inside this
   * object — so a caller can hold this source before `socket` exists. That is a real
   * state, not an error: the channel reports `connecting` and the caller keeps its
   * fallback. Answering `false` says "not now" without pretending the frame was
   * queued, which matters because these verbs are all about THIS connection and a
   * queued one would arrive describing a socket that no longer exists.
   */
  send(payload: string): boolean {
    if (this.closed) return false;
    const socket = this.socket;
    if (!socket || socket.readyState !== WS_OPEN) return false;
    try {
      socket.send(payload);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }
}

/**
 * Build a WebSocket-backed wire source, or `null` where the transport is unavailable
 * — same contract as the `EventSource` default, so the channel's "no transport here"
 * path is unchanged.
 */
export function createWebSocketSource(
  subscribeUrl: string,
  transport?: RealtimeTransportConfig,
): WireSource | null {
  // `location` rather than `window`: true in a page AND in a worker, false under SSR
  // — see `defaultSocketUrl` for why the difference matters.
  if (typeof WebSocket === "undefined" || typeof location === "undefined") return null;
  return new WebSocketWireSource(subscribeUrl, transport);
}
