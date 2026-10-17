import { CONTROL_TOPIC } from "./liveness";
import type { RealtimeMessage, WireSource } from "./types";

/**
 * A planned SSE reconnect, made BEFORE the old stream is let go.
 *
 * An SSE stream has no client→server half, so a phone that drops off the network
 * keeps its stream open on the server — and with it every presence key the
 * stream holds — until TCP gives up, which can take a quarter of an hour. The
 * server bounds that by giving a presence-holding stream a maximum age
 * (`../server/sse.ts`): at the limit it sends a `rotate` control frame, then ends
 * the stream a few seconds later. A live client answers by opening its next
 * stream at once and retiring the old one only when the new one is open; a dead
 * one answers nothing, so its stream ends and its presence lapses within a bound.
 *
 * Make-before-break is what keeps a live client invisible to its consumers: the
 * status never leaves `connected`, so nothing re-reads, and the server sees two
 * holds of the same key overlap rather than a release and a re-hold. An event
 * published while both are open arrives twice, which costs one extra
 * invalidation — every message is a hint to re-read, never the data.
 *
 * A client that does not know the frame (a tab still on an older bundle) ignores
 * it, and its stream simply ends: the ordinary reconnect path, a beat later.
 */

/** The control frame's type, on the `$gateway` topic every control frame uses. */
export const ROTATE_TYPE = "rotate";

/** Whether a control message asks this client to move to a new stream. */
export function isRotation(message: RealtimeMessage): boolean {
  return message.topic === CONTROL_TOPIC && message.type === ROTATE_TYPE;
}

interface ReplacementHandlers {
  /** Every frame the new stream delivers while it is still the replacement. */
  onMessage: (raw: string) => void;
  /** The new stream opened: the caller adopts it and retires the old one. */
  onReady: (next: WireSource) => void;
  /** It failed before opening: the caller keeps the old one until it ends. */
  onFail: () => void;
}

/**
 * Open the next stream beside the current one. Returns its cancel — which closes
 * the replacement if it has not been adopted yet — or `null` when no stream can be
 * opened here, in which case the caller lets the old one end on its own.
 */
export function openReplacement(
  create: () => WireSource | null,
  handlers: ReplacementHandlers,
): (() => void) | null {
  const next = create();
  if (!next) return null;
  let settled = false;
  const detach = (): void => {
    settled = true;
    next.onopen = null;
    next.onmessage = null;
    next.onerror = null;
  };
  next.onmessage = (event) => {
    if (!settled) handlers.onMessage(event.data);
  };
  next.onopen = () => {
    if (settled) return;
    detach();
    handlers.onReady(next);
  };
  next.onerror = () => {
    if (settled) return;
    detach();
    next.close();
    handlers.onFail();
  };
  return () => {
    if (settled) return;
    detach();
    next.close();
  };
}
