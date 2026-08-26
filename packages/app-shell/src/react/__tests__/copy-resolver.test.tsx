// @vitest-environment jsdom
/**
 * THE LOCALE AXIS ON THE BROWSER HALF'S COPY FIELD.
 *
 * `WebAppShellConfig.messages` was a plain pack bound at a module-scope mount,
 * which is the binding that mattered most on this package: a product mounts
 * this shell on every SPA it ships, so the frozen language was on all of its
 * screens at once. The server half's cases live in
 * `../../__tests__/copy-resolver.test.ts`.
 *
 * The words are the cycling club's (`../../__tests__/host-copy`), so a
 * package-shipped default sneaking back fails these cases rather than
 * satisfying them.
 */
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  clubLocaleCopy,
  CLUB_MESSAGES,
  CLUB_MESSAGES_EN,
  CLUB_MESSAGES_PACK,
} from '../../__tests__/host-copy';
import { createWebAppShell } from '../create-web-app-shell';

const VERSION = '2026-08-25';

/** A shell config with everything required and nothing rendered by default. */
function shellConfig(
  messages: Parameters<typeof createWebAppShell>[0]['messages'],
  useLocale?: () => string | null | undefined,
): Parameters<typeof createWebAppShell>[0] {
  return {
    brand: { name: 'Clube' },
    onCrash: () => undefined,
    consent: false,
    messages,
    ...(useLocale ? { useLocale } : {}),
  };
}

function Boom(): JSX.Element {
  throw new Error('a chunk went missing');
}

describe('the browser half — the chrome follows whoever has the app open', () => {
  it('still takes a plain pack, unchanged', () => {
    const shell = createWebAppShell(shellConfig(CLUB_MESSAGES));
    const { RouteErrorBoundary } = shell;
    // The console line the boundary writes is deliberate (support reads it back
    // over the phone); silenced here so a crash on purpose is not noise.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <RouteErrorBoundary resetKey="t">
        <Boom />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(CLUB_MESSAGES.routeErrorTitle)).toBeDefined();
  });

  it('renders the crashed page in the reader`s language', () => {
    // The shell is built ONCE at module scope, which is what made this field
    // frozen: whatever language the first import saw was every reader's. The
    // fallback is a component now, so the choice happens when it renders.
    const shell = createWebAppShell(
      shellConfig(clubLocaleCopy(CLUB_MESSAGES_PACK), () => 'en-US'),
    );
    const { RouteErrorBoundary } = shell;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <RouteErrorBoundary resetKey="t">
        <Boom />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(CLUB_MESSAGES_EN.routeErrorTitle)).toBeDefined();
  });

  it('follows a reader who switches after the shell was built', () => {
    /**
     * The case a factory-time resolve passes and a render-time one earns: the
     * shell is constructed while the reader is on Portuguese, and the crash
     * happens after they have switched. Nothing rebuilds the shell in between —
     * a host cannot, the boundary is a component type.
     */
    const reader = { locale: 'pt-BR' };
    const shell = createWebAppShell(
      shellConfig(clubLocaleCopy(CLUB_MESSAGES_PACK), () => reader.locale),
    );
    reader.locale = 'en-US';
    const { RouteErrorBoundary } = shell;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <RouteErrorBoundary resetKey="t">
        <Boom />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(CLUB_MESSAGES_EN.routeErrorTitle)).toBeDefined();
  });

  it('words the consent gate for the reader it is interrupting', async () => {
    const stale = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { stale: true, version: VERSION } }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    try {
      const shell = createWebAppShell({
        ...shellConfig(clubLocaleCopy(CLUB_MESSAGES_PACK), () => 'en-US'),
        consent: {},
      });
      render(<shell.TermsConsentGate />);
      await waitFor(() => {
        expect(screen.getByText(CLUB_MESSAGES_EN.consentTitle)).toBeDefined();
      });
    } finally {
      stale.mockRestore();
    }
  });

  it('hands a host the same sentences in the same language', () => {
    // `useMessages` replaced a resolved `messages` table for this exact reason:
    // a host rendering the shell's words elsewhere would otherwise have kept
    // the import-time language while the shell itself had moved on.
    const shell = createWebAppShell(
      shellConfig(clubLocaleCopy(CLUB_MESSAGES_PACK), () => 'en-US'),
    );
    expect(renderHook(() => shell.useMessages()).result.current).toBe(CLUB_MESSAGES_EN);
  });

  it('treats an unwired locale seam as "nobody said"', () => {
    const seen: Array<string | null | undefined> = [];
    const shell = createWebAppShell(
      shellConfig(({ locale }) => {
        seen.push(locale);
        return CLUB_MESSAGES;
      }),
    );
    renderHook(() => shell.useMessages());
    expect(seen).toEqual([undefined]);
  });
});
