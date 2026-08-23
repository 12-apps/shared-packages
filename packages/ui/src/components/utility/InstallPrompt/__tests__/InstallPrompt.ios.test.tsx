/**
 * `InstallPrompt` on iOS Safari.
 *
 * Its own file because the platform probe has to be replaced at module scope,
 * and `vi.mock` is hoisted over the whole file — the Chromium cases in
 * `usePwaInstall.test.tsx` must keep the real probe.
 *
 * What matters here is the ABSENCE of the install button. Safari exposes no way
 * to open its own Add to Home Screen sheet, so a button on iOS would be a
 * control that does nothing when tapped; the instructions take its place.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallPrompt } from '../index';
import { PT_BR_INSTALL_PROMPT_COPY } from '../../../../pt-BR';

vi.mock('../InstallPrompt.helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../InstallPrompt.helpers')>();

  return { ...actual, resolveInstallPlatform: () => 'ios' as const };
});

describe('InstallPrompt on iOS Safari', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('shows without waiting for an event that iOS never fires', async () => {
    render(<InstallPrompt copy={{ ...PT_BR_INSTALL_PROMPT_COPY, title: 'Instalar FutureDrink' }} />);

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt')).toBeInTheDocument();
    });
    expect(screen.getByTestId('install-prompt-title')).toHaveTextContent('Instalar FutureDrink');
  });

  it('offers instructions instead of an install button', async () => {
    render(<InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} />);

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt-ios-instructions')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt-install')).not.toBeInTheDocument();
    });
  });

  it('accepts host-supplied instruction copy', async () => {
    render(<InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} iosInstructions={<span>Toque em Compartilhar</span>} />);

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt-ios-instructions')).toHaveTextContent(
        'Toque em Compartilhar',
      );
    });
  });

  it('can still be dismissed', async () => {
    render(<InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} />);

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt-dismiss')).toBeInTheDocument();
    });
  });
});
