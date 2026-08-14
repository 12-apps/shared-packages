import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import type { Theme } from '@12-apps/ui/mui/styles';

import type { ImpersonationBannerState } from '../core/types';

import { registerBannerHost, reportBannerPainted } from './banner-host';
import { formatRemaining, useRemainingTime } from './countdown';
import {
  impersonationHeadline,
  tenantChip,
  type ImpersonationBannerLabels,
} from './labels';
import { useChromeOffset } from './offset';
import {
  dropExpiredImpersonation,
  endImpersonation,
  type ImpersonationEndpoints,
} from './session-control';
import { useImpersonationState } from './state';

/**
 * The banner — the safety control that makes acting as someone else impossible
 * to do silently.
 *
 * IT IS NOT DECORATION, and three choices follow from that:
 *
 * 1. IT CANNOT SCROLL AWAY. In a shell that owns a non-scrolling top region it
 *    is a `flex: 0 0 auto` row above the app's own scroll region; in one whose
 *    chrome is fixed it is `position: fixed` with the chrome offset by its
 *    measured height (see `./offset`).
 * 2. IT CANNOT BE DISMISSED. A generic notice component is the obvious thing to
 *    reach for and the wrong one: those own a `visible` state a dismiss button
 *    latches off permanently, and they paint quietly, which is the opposite of
 *    the requirement. This is a solid, contrast-checked bar with no close
 *    affordance at all.
 * 3. IT CANNOT BE COVERED. Fixed placement sits at the snackbar layer, ABOVE
 *    modals and drawers: a dialog that hides the notice that you are inside
 *    somebody else's account is a dialog you can act through without knowing.
 */

/**
 * How the host places the bar.
 *
 * `flow` for a shell that already owns a non-scrolling top region; `fixed` for
 * one whose own header is fixed, or that has routes with no header at all.
 */
export type ImpersonationBannerPlacement = 'flow' | 'fixed';

export interface ImpersonationBannerProps {
  placement?: ImpersonationBannerPlacement;
}

/** What the bound banner needs, resolved once by the factory. */
interface BannerParts {
  endpoints: ImpersonationEndpoints;
  labels: ImpersonationBannerLabels;
  /**
   * Told whenever the live session changes — a host tags its error reporter here
   * so an error raised under impersonation is triaged as being about the tenant
   * being WORN rather than about the platform.
   *
   * What travels is the tenant's SLUG and nothing else. The subject carries the
   * represented person's name and e-mail, and putting either into a reporting
   * queue would move one customer's identity into a queue whose audience is the
   * host's own team.
   */
  onSessionChange?(session: { impersonating: boolean; tenantSlug: string | null }): void;
}

/** Registers this document's banner host, and reports what it is painting. */
function useBannerHost(painting: boolean): void {
  useEffect(() => registerBannerHost(), []);
  useEffect(() => {
    reportBannerPainted(painting);
  }, [painting]);
}

function useSessionReporting(
  parts: BannerParts,
  state: ImpersonationBannerState | null,
): void {
  const { onSessionChange } = parts;
  const slug = state?.tenant?.slug ?? null;
  useEffect(() => {
    onSessionChange?.({ impersonating: state !== null, tenantSlug: slug });
  }, [onSessionChange, state, slug]);
}

/**
 * Put the actor back in their own view the moment the session STOPS being one —
 * however it stopped.
 *
 * Keyed on the observed transition (a session was held, now none is) rather than
 * on the exit call, because there are four ways out and only one of them is a
 * button: the exit, the time box closing while the tab is open, the time box
 * closing while the machine is ASLEEP (the tab wakes, re-reads, and the server
 * simply says no session — nothing local ran), and another tab ending it. Every
 * one of those leaves this document's caches full of pages fetched as the
 * subject; only this watcher sees all four.
 */
function useRestoreOwnView(
  parts: BannerParts,
  state: ImpersonationBannerState | null,
): void {
  const onEnd = parts.endpoints.onEnd;
  const held = useRef(false);
  useEffect(() => {
    const active = state !== null;
    if (held.current && !active) onEnd?.();
    held.current = active;
  }, [state, onEnd]);
}

/**
 * When the time box closes with the tab open, drop the dead cookie.
 *
 * The server stopped honouring it the instant `expiresAt` passed, so this
 * changes no authorization — it clears a cookie every subsequent request would
 * otherwise keep carrying, and re-reads the state so the bar comes down.
 * Restoring the view is NOT done here; see {@link useRestoreOwnView}.
 *
 * Best effort by design: an expiry is not an action anyone took, so there is
 * nobody to hand an error to.
 */
function useExpiryExit(
  parts: BannerParts,
  expiredState: ImpersonationBannerState | null,
  refresh: () => Promise<void>,
): void {
  const handled = useRef(false);
  useEffect(() => {
    if (!expiredState) {
      handled.current = false;
      return;
    }
    if (handled.current) return;
    handled.current = true;
    void dropExpiredImpersonation(parts.endpoints, expiredState)
      .catch(() => undefined)
      .finally(() => void refresh());
  }, [parts, expiredState, refresh]);
}

/** The exit control's own state: in flight, and the last failure to report. */
interface ExitControl {
  leaving: boolean;
  failed: boolean;
  leave: () => void;
}

function useExit(
  parts: BannerParts,
  state: ImpersonationBannerState,
  refresh: () => Promise<void>,
): ExitControl {
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const leave = useCallback(() => {
    setLeaving(true);
    setFailed(false);
    void endImpersonation(parts.endpoints, state)
      .catch(() => setFailed(true))
      .finally(() => {
        setLeaving(false);
        // Whether it worked or not, the server decides what the bar says next.
        void refresh();
      });
  }, [parts, state, refresh]);

  return { leaving, failed, leave };
}

/** One short fact beside the headline — the tenant, read-only, the countdown. */
function Meta({ children, testId }: { children: string; testId: string }): JSX.Element {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{ fontSize: '0.8125rem', opacity: 0.92, whiteSpace: 'nowrap' }}
    >
      {children}
    </Box>
  );
}

interface BarProps {
  parts: BannerParts;
  state: ImpersonationBannerState;
  remaining: number;
  expired: boolean;
  unconfirmed: boolean;
  placement: ImpersonationBannerPlacement;
  refresh: () => Promise<void>;
}

/**
 * The short facts beside the headline, in the order they answer "and how bad is
 * this?": where, whether anything can change, how long is left, and then the two
 * that only appear when something has gone wrong.
 */
function BarFacts({
  labels,
  state,
  remaining,
  expired,
  unconfirmed,
  exitFailed,
}: {
  labels: ImpersonationBannerLabels;
  state: ImpersonationBannerState;
  remaining: number;
  expired: boolean;
  unconfirmed: boolean;
  exitFailed: boolean;
}): JSX.Element {
  const tenant = tenantChip(state);
  return (
    <>
      {tenant ? <Meta testId="impersonation-banner-tenant">{tenant}</Meta> : null}
      {state.readOnly ? (
        <Meta testId="impersonation-banner-readonly">{labels.readOnly}</Meta>
      ) : null}
      <Meta testId="impersonation-banner-remaining">
        {expired ? labels.timeUp : labels.remaining({ formatted: formatRemaining(remaining) })}
      </Meta>
      {unconfirmed ? (
        <Meta testId="impersonation-banner-unconfirmed">{labels.unconfirmed}</Meta>
      ) : null}
      {exitFailed ? (
        <Meta testId="impersonation-banner-error">{labels.exitFailed}</Meta>
      ) : null}
    </>
  );
}

/**
 * The bar's own paint.
 *
 * A function rather than an inline object so the three claims it encodes stay
 * readable: the tone says WHICH kind of session this is, `fixed` placement sits
 * at the snackbar layer (above modals — a dialog that hides this notice is one
 * you can act through without knowing), and `flow` placement is a non-shrinking
 * row that the content region gets shorter for.
 */
function barSx(state: ImpersonationBannerState, placement: ImpersonationBannerPlacement) {
  return (theme: Theme) => {
    // The stronger tone for an operator session (you are in a real person's
    // account right now), the softer one for a preview (you are still yourself,
    // seeing less).
    const tone = state.kind === 'operator' ? theme.palette.error : theme.palette.warning;
    return {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 1.5,
      px: { xs: 2, md: 3 },
      py: 1,
      bgcolor: tone.main,
      color: theme.palette.getContrastText(tone.main),
      ...(placement === 'fixed'
        ? { position: 'fixed', top: 0, left: 0, right: 0, zIndex: theme.zIndex.snackbar }
        : { flex: '0 0 auto', position: 'relative' }),
    };
  };
}

/** The bar itself, rendered only when a session is actually in force. */
function ImpersonationBar(props: BarProps): JSX.Element {
  const { parts, state, expired, placement } = props;
  const { labels } = parts;
  const [bar, setBar] = useState<HTMLElement | null>(null);
  useChromeOffset(placement === 'fixed' ? bar : null);
  const { leaving, failed, leave } = useExit(parts, state, props.refresh);

  return (
    <Box
      ref={setBar}
      role="region"
      aria-label={labels.regionLabel}
      data-testid="impersonation-banner"
      data-impersonation-kind={state.kind}
      sx={barSx(state, placement)}
    >
      <Box
        component="span"
        aria-live="polite"
        data-testid="impersonation-banner-title"
        sx={{ fontWeight: 700, fontSize: '0.9375rem' }}
      >
        {expired ? labels.expired : impersonationHeadline(state, labels)}
      </Box>
      <BarFacts
        labels={labels}
        state={state}
        remaining={props.remaining}
        expired={expired}
        unconfirmed={props.unconfirmed}
        exitFailed={failed}
      />
      <Box sx={{ marginLeft: 'auto' }}>
        <Button
          variant="solid"
          color="neutral"
          size="sm"
          loading={leaving}
          disabled={leaving}
          onClick={leave}
          dataTestId="impersonation-banner-exit"
        >
          {labels.exit}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Mount once per app, in the chrome — never per page.
 *
 * It renders nothing at all when there is no session, but it STAYS MOUNTED: the
 * start handshake refuses to begin a session in a document with no banner host,
 * so the host's presence is the precondition and its paint is the proof.
 */
export function bindImpersonationBanner(
  parts: BannerParts,
): (props: ImpersonationBannerProps) => JSX.Element | null {
  const source = {
    transport: parts.endpoints.transport,
    platformPath: parts.endpoints.platformPath,
  };

  return function ImpersonationBanner({ placement = 'flow' }): JSX.Element | null {
    const { state, unconfirmed, refresh } = useImpersonationState(source);
    const remaining = useRemainingTime(state?.expiresAt ?? null);
    const expired = state !== null && remaining !== null && remaining <= 0;

    useBannerHost(state !== null);
    useRestoreOwnView(parts, state);
    useExpiryExit(parts, expired ? state : null, refresh);
    useSessionReporting(parts, state);

    if (!state) return null;
    return (
      <ImpersonationBar
        parts={parts}
        state={state}
        remaining={remaining ?? 0}
        expired={expired}
        unconfirmed={unconfirmed}
        placement={placement}
        refresh={refresh}
      />
    );
  };
}
