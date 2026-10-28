import { Box } from "@mui/material";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";

/**
 * The Pix code's deadline as a countdown (FUT-1181, FUT-592; option A of the
 * owner's 2026-10-28 prototype): "expira em 12:34" beside the pane's title, a
 * bar under it that drains with the window, and — in the last two minutes —
 * the bar and the clock in amber with one sentence saying that an expired code
 * costs nothing.
 *
 * It replaces "Válido até 14:37", a static clock the buyer had to subtract
 * from, and it stays on the after-copy face, where the old clock was not drawn
 * at all: the shopper who copied the code — the usual path — is the one who
 * leaves for the bank app and needs to know how long she has.
 */

/** The last stretch: under this, the countdown turns amber and says so. */
const PIX_URGENT_MS = 2 * 60_000;

/**
 * The window the bar is drawn against when the charge says nothing longer.
 *
 * A charge carries only its expiry, not when it was raised, so the bar's whole
 * is the longer of this and the time left when the pane first saw the code: a
 * fresh fifteen-minute code (the providers' default) opens full, a reload in
 * its tenth minute opens two-thirds drained, and a longer window (a Pix the
 * store confirms, with its own minutes) opens full and drains from there.
 */
export const PIX_FULL_WINDOW_MS = 15 * 60_000;

/** Milliseconds left on the code at `now`, never below zero; `null` for an unreadable expiry. */
export function pixRemainingMs(expiresAt: string, now: number): number | null {
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return null;
  return Math.max(0, deadline - now);
}

/**
 * "MM:SS", rounded UP to the second: the clock reads 00:00 only once the code
 * has actually lapsed, never a second early. A window of an hour or more (a
 * store's own) reads "H:MM:SS" rather than a minute count nobody reads.
 */
export function formatCountdown(remainingMs: number): string {
  const total = Math.ceil(Math.max(0, remainingMs) / 1000);
  const two = (n: number): string => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** What the countdown draws at one instant. */
interface PixCountdownState {
  remainingMs: number;
  /** "12:34". */
  clock: string;
  /** The bar's fill, 0..1. */
  fraction: number;
  urgent: boolean;
  lapsed: boolean;
}

/** The countdown at `now`, against a bar whose whole is `windowMs`. Pure, for the tests. */
export function pixCountdownAt(remainingMs: number, windowMs: number): PixCountdownState {
  const whole = Math.max(windowMs, 1);
  // Urgent by the second the clock SHOWS, so amber starts at 01:59, never at a 02:00 still on screen.
  const shownMs = Math.ceil(Math.max(0, remainingMs) / 1000) * 1000;
  return {
    remainingMs,
    clock: formatCountdown(remainingMs),
    fraction: Math.min(1, Math.max(0, remainingMs / whole)),
    // Still amber at 00:00: a lapsed code is not back to calm.
    urgent: shownMs < PIX_URGENT_MS,
    lapsed: remainingMs <= 0,
  };
}

/** The delay until the displayed second changes — so the clock never skips or repeats one. */
function nextTickMs(remainingMs: number): number {
  const into = remainingMs % 1000;
  return into === 0 ? 1000 : into;
}

/**
 * The ticking countdown for one charge, or `null` when its expiry cannot be
 * read (the pane then draws no clock rather than a wrong one).
 *
 * `onLapse` runs ONCE per charge, as the clock reaches zero — or at once, for
 * a code that was already past its expiry when the pane drew it. It is the
 * client-side half of the expiry (FUT-1181): the pane asks the server now
 * instead of at its next, possibly decayed, poll. The server is the one that
 * decides — a Pix the store confirms may still settle after its window — so
 * the countdown never declares the code expired by itself.
 */
export function usePixCountdown(expiresAt: string, onLapse?: () => void): PixCountdownState | null {
  const [now, setNow] = useState(() => Date.now());
  // The bar's whole, fixed once per charge: recomputed every render it would
  // shrink with the time left and the bar would never drain.
  const windowMs = useMemo(() => Math.max(PIX_FULL_WINDOW_MS, pixRemainingMs(expiresAt, Date.now()) ?? 0), [expiresAt]);
  const lapsedFor = useRef<string | null>(null);
  const lapse = useRef(onLapse);
  useEffect(() => {
    lapse.current = onLapse;
  }, [onLapse]);

  const remainingMs = pixRemainingMs(expiresAt, now);
  useEffect(() => {
    if (remainingMs === null) return undefined;
    if (remainingMs <= 0) {
      if (lapsedFor.current !== expiresAt) {
        lapsedFor.current = expiresAt;
        lapse.current?.();
      }
      return undefined;
    }
    const timer = setTimeout(() => setNow(Date.now()), nextTickMs(remainingMs));
    return () => clearTimeout(timer);
  }, [expiresAt, remainingMs]);

  if (remainingMs === null) return null;
  return pixCountdownAt(remainingMs, windowMs);
}

/** The words the countdown says, from the host's pack. */
export interface PixCountdownCopy {
  /** "expira em 12:34". */
  expiresIn: (clock: string) => string;
  /** "Menos de 2 minutos. Se expirar, é só gerar outro — nada é cobrado." */
  lastMinutes: string;
  /**
   * The same moment for a Pix the STORE confirms: "Menos de 2 minutos. Se você
   * já pagou, não pague de novo — a loja confirma." Its code is a static BR
   * Code on the store's key, which the bank does not expire, and a buyer who
   * paid by hand waits here for the store: "gere outro, nada é cobrado" would
   * invite her to pay twice.
   */
  lastMinutesByStore: string;
}

/**
 * The title row with the clock on its right, the bar under it, and the
 * last-minutes sentence. The title is the caller's, so the pane keeps its own
 * heading element and test id.
 */
export function PixCountdown({ state, copy, title, storeConfirms = false }: {
  state: PixCountdownState;
  copy: PixCountdownCopy;
  title: JSX.Element;
  /** The store confirms this Pix (`confirmation: "MANUAL"`): the last-minutes line says not to pay again. */
  storeConfirms?: boolean;
}): JSX.Element {
  const ink = state.urgent ? "warning.dark" : "text.primary";
  return (
    <Box data-testid="pix-countdown" data-urgent={state.urgent ? "true" : "false"} sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
        {title}
        {/* A timer is not announced as it ticks (role="timer" is aria-live off): a
            reader asks for it, rather than hearing every second read out. */}
        <Box
          component="span"
          role="timer"
          data-testid="pix-countdown-clock"
          sx={{ typography: "body1", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: ink }}
        >
          {copy.expiresIn(state.clock)}
        </Box>
      </Box>
      <Box aria-hidden sx={{ height: (t) => t.spacing(0.75), borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
        <Box
          data-testid="pix-countdown-bar"
          sx={{
            height: "100%",
            width: `${(state.fraction * 100).toFixed(2)}%`,
            bgcolor: state.urgent ? "warning.main" : "text.secondary",
            transition: "width 1s linear",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        />
      </Box>
      {/* Announced once, as it appears (a status, unlike the timer above). Gone at
          00:00: the screen then learns from the server what the lapse meant. */}
      {/* A store-confirmed Pix keeps its warning at 00:00: the order still waits on the store, so the
          buyer who paid by hand is exactly who must not be invited to pay again. */}
      {state.urgent && (!state.lapsed || storeConfirms) ? (
        <Box component="p" role="status" data-testid="pix-countdown-urgent" sx={{ m: 0, typography: "body2", color: "warning.dark" }}>
          {storeConfirms ? copy.lastMinutesByStore : copy.lastMinutes}
        </Box>
      ) : null}
    </Box>
  );
}
