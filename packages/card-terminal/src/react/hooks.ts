'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { ChargeRun } from './charge-run';
import type { ChargeFlow } from './flow-types';
import { linkOf, type ChargeLink, type TerminalPort, type TerminalState } from './port';

const NONE = (): (() => void) => () => undefined;

/** The run's flow now, re-rendered on every move; `null` with no run. */
export function useChargeFlow(run: ChargeRun | null): ChargeFlow | null {
  return useSyncExternalStore(run === null ? NONE : run.subscribe, () => run?.current() ?? null);
}

/**
 * The station's links as they stand, kept current from its `state` events,
 * and the {@link ChargeLink} a flow needs. With no port (a browser with no
 * station) the link is known and has no terminal, so every screen charges as
 * before. Until the station's first answer, or after a read that failed, the
 * link is NOT known: a card leg waits, never degrading to a plain one.
 * `reread` asks for the links again (after a re-pair).
 */
export function useTerminalLink(port: TerminalPort | undefined): { state: TerminalState | null; link: ChargeLink; reread: () => void } {
  const [state, setState] = useState<TerminalState | null>(null);
  const [failed, setFailed] = useState(false);
  const take = useCallback((answer: TerminalState) => {
    setState(answer);
    setFailed(false);
  }, []);
  useEffect(() => {
    if (port === undefined) return undefined;
    let live = true;
    const stop = port.onEvent((event) => {
      if (event.kind === 'state' && live) take(event.state);
    });
    void port.state().then(
      (answer) => live && take(answer),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      stop();
    };
  }, [port, take]);
  const reread = useCallback(() => {
    void port?.state({ reread: true }).then(take, () => setFailed(true));
  }, [port, take]);
  const link: ChargeLink = port === undefined ? { known: true, terminals: 0 } : linkOf(state, failed);
  return { state, link, reread };
}
