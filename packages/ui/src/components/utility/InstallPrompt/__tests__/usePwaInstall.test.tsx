/**
 * `usePwaInstall` / `InstallPrompt` — the machinery that turns an installable
 * site into one that actually asks.
 *
 * The regression this file exists for: a manifest and a service worker satisfy
 * every installability criterion a browser checks, and still produce no prompt
 * of any kind, because nothing in the page captures `beforeinstallprompt`. The
 * `preventDefault` case below guards that hole — without that call the browser
 * reclaims the event and the app can never install itself.
 *
 * The iOS branch lives in `InstallPrompt.ios.test.tsx`, which needs a
 * module-level mock this file must not carry.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallPrompt } from '../index';
import {
  isDismissalActive,
  isIosSafariAgent,
  readDismissedAt,
  writeDismissedAt,
} from '../InstallPrompt.helpers';
import type { BeforeInstallPromptEvent } from '../InstallPrompt.types';
import { usePwaInstall } from '../usePwaInstall';
import { PT_BR_INSTALL_PROMPT_COPY } from '../../../../pt-BR';

const STORAGE_KEY = 'pwa-install-dismissed';

// A fixed clock. Deriving expectations from the real `Date.now()` would make
// them depend on how long the test took to run.
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

type MockPromptEvent = BeforeInstallPromptEvent & { prompt: ReturnType<typeof vi.fn> };

/**
 * Stands in for the Chromium event: `prompt()` records that it was called and
 * `userChoice` resolves with whatever answer the test wants the user to give.
 */
const createPromptEvent = (outcome: 'accepted' | 'dismissed'): MockPromptEvent => {
  const event = new Event('beforeinstallprompt') as MockPromptEvent;

  Object.assign(event, {
    platforms: ['web'],
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });

  return event;
};

/** Renders the hook's state into the DOM so assertions can read it directly. */
const HookProbe = ({ dismissForDays }: { dismissForDays?: number }) => {
  const { canInstall, platform, isInstalled } = usePwaInstall({ dismissForDays });

  return (
    <div>
      <span data-testid="can-install">{String(canInstall)}</span>
      <span data-testid="platform">{platform}</span>
      <span data-testid="is-installed">{String(isInstalled)}</span>
    </div>
  );
};

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPADOS_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const CHROME_ON_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('isIosSafariAgent', () => {
  it('detects Safari on iPhone', () => {
    expect(isIosSafariAgent(IPHONE_SAFARI, 5)).toBe(true);
  });

  it('detects iPadOS, which reports a Macintosh agent with touch points', () => {
    expect(isIosSafariAgent(IPADOS_SAFARI, 5)).toBe(true);
  });

  it('rejects desktop Safari, which shares that agent but has no touch points', () => {
    expect(isIosSafariAgent(IPADOS_SAFARI, 0)).toBe(false);
  });

  it('rejects Chrome on iOS, which cannot add to the home screen at all', () => {
    expect(isIosSafariAgent(CHROME_ON_IOS, 5)).toBe(false);
  });

  it('rejects desktop Chrome', () => {
    expect(isIosSafariAgent(DESKTOP_CHROME, 0)).toBe(false);
  });
});

describe('InstallPrompt dismissal storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('reports no dismissal when nothing was ever stored', () => {
    expect(readDismissedAt(STORAGE_KEY)).toBeNull();
    expect(isDismissalActive(null, 30, NOW)).toBe(false);
  });

  it('round-trips a dismissal timestamp', () => {
    writeDismissedAt(STORAGE_KEY, NOW);
    expect(readDismissedAt(STORAGE_KEY)).toBe(NOW);
  });

  it('ignores a corrupted stored value instead of throwing', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-a-number');
    expect(readDismissedAt(STORAGE_KEY)).toBeNull();
  });

  it('keeps a dismissal active inside the window and expires it after', () => {
    expect(isDismissalActive(NOW, 30, NOW + 29 * DAY)).toBe(true);
    expect(isDismissalActive(NOW, 30, NOW + 31 * DAY)).toBe(false);
  });

  it('treats dismissForDays of 0 as permanent', () => {
    expect(isDismissalActive(NOW, 0, NOW + 3650 * DAY)).toBe(true);
  });

  it('treats a future timestamp as active so a wound-back clock cannot re-prompt', () => {
    expect(isDismissalActive(NOW + DAY, 30, NOW)).toBe(true);
  });
});

describe('usePwaInstall', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('cannot install before the browser offers a prompt', async () => {
    render(<HookProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('platform')).toHaveTextContent('unsupported');
    });
    expect(screen.getByTestId('can-install')).toHaveTextContent('false');
  });

  it('becomes installable once beforeinstallprompt fires', async () => {
    render(<HookProbe />);
    fireEvent(window, createPromptEvent('accepted'));

    await waitFor(() => {
      expect(screen.getByTestId('can-install')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('platform')).toHaveTextContent('prompt');
  });

  it('calls preventDefault so the deferred handle survives', async () => {
    render(<HookProbe />);

    const event = createPromptEvent('accepted');
    const preventDefault = vi.spyOn(event, 'preventDefault');
    fireEvent(window, event);

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled();
    });
  });

  // `dismissForDays: 0` makes the stored dismissal permanent, so this asserts
  // that the hook consults storage at all without depending on the wall clock.
  // The expiry arithmetic itself is covered above against a fixed clock.
  it('stays suppressed while a dismissal is stored', async () => {
    writeDismissedAt(STORAGE_KEY, NOW);

    render(<HookProbe dismissForDays={0} />);
    fireEvent(window, createPromptEvent('accepted'));

    await waitFor(() => {
      expect(screen.getByTestId('platform')).toHaveTextContent('prompt');
    });
    expect(screen.getByTestId('can-install')).toHaveTextContent('false');
  });

  it('reports installed and stays suppressed after appinstalled', async () => {
    render(<HookProbe />);
    fireEvent(window, createPromptEvent('accepted'));

    await waitFor(() => {
      expect(screen.getByTestId('can-install')).toHaveTextContent('true');
    });

    fireEvent(window, new Event('appinstalled'));

    await waitFor(() => {
      expect(screen.getByTestId('is-installed')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('can-install')).toHaveTextContent('false');
  });
});

describe('InstallPrompt', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing until the browser offers a prompt', async () => {
    render(<InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} />);

    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });
  });

  it('appears with an install button once the prompt is captured', async () => {
    render(<InstallPrompt copy={{ ...PT_BR_INSTALL_PROMPT_COPY, title: 'Install FutureDrink' }} />);
    fireEvent(window, createPromptEvent('accepted'));

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt')).toBeInTheDocument();
    });
    expect(screen.getByTestId('install-prompt-install')).toBeInTheDocument();
  });

  it('fires the native prompt and reports the accepted outcome', async () => {
    const onInstall = vi.fn();

    render(<InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} onInstall={onInstall} />);
    const event = createPromptEvent('accepted');
    fireEvent(window, event);

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt-install')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('install-prompt-install'));

    await waitFor(() => {
      expect(onInstall).toHaveBeenCalledWith('accepted');
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('records a dismissal when the user declines the native dialog', async () => {
    render(<InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} onInstall={vi.fn()} />);
    fireEvent(window, createPromptEvent('dismissed'));

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt-install')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('install-prompt-install'));

    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });
    expect(readDismissedAt(STORAGE_KEY)).not.toBeNull();
  });

  it('hides and persists the dismissal when the close button is used', async () => {
    const onDismiss = vi.fn();

    render(<InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} onDismiss={onDismiss} />);
    fireEvent(window, createPromptEvent('accepted'));

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt-dismiss')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('install-prompt-dismiss'));

    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(readDismissedAt(STORAGE_KEY)).not.toBeNull();
  });
});
