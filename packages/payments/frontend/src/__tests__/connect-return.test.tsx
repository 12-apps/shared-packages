// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { takeConnectReturn, useConnectReturn } from '../components/connect-return';

/**
 * The other end of the connect round trip.
 *
 * The property under test throughout: the verdict is read exactly once and is
 * then gone from the address bar, because the address bar is the only place it
 * lives — and a reload that re-announces a connection, or re-announces a
 * failure the owner has since fixed, is the whole failure mode.
 */

const PAGE = '/loja/config/payments';

/** Put the browser on a URL, as the callback's redirect would. */
function at(query: string): void {
  window.history.replaceState({}, '', `${PAGE}${query}`);
}

/** What the address bar says now. */
function url(): string {
  return `${window.location.pathname}${window.location.search}`;
}

afterEach(() => {
  cleanup();
  at('');
});

describe('takeConnectReturn', () => {
  it('reports the provider the callback named', () => {
    at('?connected=pagbank');

    expect(takeConnectReturn()).toEqual({ connected: 'pagbank', errorCode: null });
  });

  it('reports a failure as its CODE, leaving the sentence to the host', () => {
    at('?connectError=access_denied');

    expect(takeConnectReturn()).toEqual({ connected: null, errorCode: 'access_denied' });
  });

  it('passes through a code this package does not know', () => {
    at('?connectError=provider_on_fire');

    // A host that taught its own callback a new failure is not wrong.
    expect(takeConnectReturn().errorCode).toBe('provider_on_fire');
  });

  it('erases every param the callback owns', () => {
    at('?connected=pagbank&provider=pagbank&connectError=access_denied');

    takeConnectReturn();

    expect(url()).toBe(PAGE);
  });

  it('leaves the host’s own query string alone', () => {
    at('?tab=integracoes&connected=pagbank&provider=pagbank');

    takeConnectReturn();

    // Only those three are the callback's to remove.
    expect(url()).toBe(`${PAGE}?tab=integracoes`);
  });

  it('is take-ONCE: a reload finds nothing to announce', () => {
    at('?connected=pagbank');
    expect(takeConnectReturn().connected).toBe('pagbank');

    expect(takeConnectReturn()).toEqual({ connected: null, errorCode: null });
  });

  it('touches nothing when the callback said nothing', () => {
    at('?tab=integracoes');

    expect(takeConnectReturn()).toEqual({ connected: null, errorCode: null });
    expect(url()).toBe(`${PAGE}?tab=integracoes`);
  });
});

describe('useConnectReturn', () => {
  it('holds the verdict after the URL it came from is gone', () => {
    at('?connected=pagbank');
    const { result, rerender } = renderHook(() => useConnectReturn());

    expect(result.current.connected).toBe('pagbank');
    expect(url()).toBe(PAGE);

    rerender();
    expect(result.current.connected).toBe('pagbank');
  });

  it('survives StrictMode running the effect twice', () => {
    at('?connected=pagbank');

    // The real thing, not a simulation: StrictMode mounts, unmounts and
    // re-mounts the effect, so the SECOND run reads a URL the first already
    // scrubbed. Announcing "nothing happened" over a caught verdict is how the
    // owner's confirmation vanishes — in development only, which is worse.
    const { result } = renderHook(() => useConnectReturn(), { wrapper: StrictMode });

    expect(result.current.connected).toBe('pagbank');
  });

  it('reports nothing on a normal visit', () => {
    const { result } = renderHook(() => useConnectReturn());

    expect(result.current).toEqual({ connected: null, errorCode: null });
  });
});
