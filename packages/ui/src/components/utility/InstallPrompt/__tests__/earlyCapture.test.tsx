/**
 * The capture that runs before React does.
 *
 * Every other test of this component fires `beforeinstallprompt` while the
 * hook is already mounted. That ordering is convenient and it never occurs:
 * Chromium fires the event once, during initial page load, before hydration
 * and — when the component is code-split — before its chunk has been
 * downloaded at all. A suite that only covers the mounted case passes in full
 * against a component that can never install anything, which is exactly what
 * shipped.
 *
 * jsdom has no page load to be early or late relative to, so these tests
 * express the ordering the only way it can be expressed here: the stash is
 * populated BEFORE anything renders. That is the same handoff a real browser
 * performs, and it is the mechanic the fix depends on.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstallPrompt } from '../index';
import {
  capturePwaInstallEvent,
  readPwaInstallStash,
  resetPwaInstallStash,
  PWA_INSTALL_AVAILABLE_EVENT,
} from '../InstallPrompt.earlyCapture';
import type { BeforeInstallPromptEvent } from '../InstallPrompt.types';
import { PT_BR_INSTALL_PROMPT_COPY } from '../../../../pt-BR';

const STORAGE_KEY = 'early-capture-test';

type MockPromptEvent = BeforeInstallPromptEvent & { prompt: ReturnType<typeof vi.fn> };

const createPromptEvent = (): MockPromptEvent => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as MockPromptEvent;

  Object.assign(event, {
    platforms: ['web'],
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });

  return event;
};

/**
 * Everything the document does before the app exists: the host installs the
 * capture, then the browser decides the page is installable. No component is
 * alive for either step, which is the entire point.
 */
const bootPageWithOffer = (): MockPromptEvent => {
  capturePwaInstallEvent();
  const event = createPromptEvent();
  window.dispatchEvent(event);
  return event;
};

const renderPrompt = () => render(
    <InstallPrompt copy={{ ...PT_BR_INSTALL_PROMPT_COPY, title: 'Install' }} storageKey={STORAGE_KEY} />,
  );

// `resetPwaInstallStash` unwinds listeners as well as data, so no case can
// leak a live capture into the next one.
beforeEach(() => {
  resetPwaInstallStash();
  window.localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  resetPwaInstallStash();
  vi.restoreAllMocks();
});

describe('capturePwaInstallEvent', () => {
  it('suppresses the default so the browser hands the handle over', async () => {
    capturePwaInstallEvent();
    const event = createPromptEvent();
    const preventDefault = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    // Without this the browser keeps the event and the page can never ask.
    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled();
    });
    expect(readPwaInstallStash()?.event).toBe(event);
  });

  it('records when the offer arrived, so a silent no-show can be diagnosed', async () => {
    capturePwaInstallEvent();
    window.dispatchEvent(createPromptEvent());

    await waitFor(() => {
      expect(readPwaInstallStash()?.firedAt).toEqual(expect.any(Number));
    });
  });

  it('is idempotent, so a host may wire both the snippet and the function', async () => {
    capturePwaInstallEvent();
    capturePwaInstallEvent();
    const event = createPromptEvent();
    const preventDefault = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    // One capture, not two — double-handling would spend the handle twice.
    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  it('stops capturing once torn down', async () => {
    capturePwaInstallEvent()();
    window.dispatchEvent(createPromptEvent());

    // The stash object survives; what stops is anything being put into it.
    await waitFor(() => {
      expect(readPwaInstallStash()?.event).toBeNull();
    });
  });

  it('remembers an install that happened before the app mounted', async () => {
    capturePwaInstallEvent();
    window.dispatchEvent(createPromptEvent());
    window.dispatchEvent(new Event('appinstalled'));

    await waitFor(() => {
      expect(readPwaInstallStash()?.installedAt).toEqual(expect.any(Number));
    });
    // The handle is spent — offering it would be a button that does nothing.
    expect(readPwaInstallStash()?.event).toBeNull();
  });
});

describe('usePwaInstall adopting the capture', () => {
  it('offers an install for an event that fired before it mounted', async () => {
    // THE production ordering, and the case the component used to fail.
    bootPageWithOffer();

    renderPrompt();

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt')).toBeInTheDocument();
    });
  });

  it('adopts an event captured while it was already running', async () => {
    capturePwaInstallEvent();
    renderPrompt();

    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });

    window.dispatchEvent(createPromptEvent());

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt')).toBeInTheDocument();
    });
  });

  it('adopts a stash announced without a live event reaching it', async () => {
    // The capture consumed the browser event; the hook only ever sees the
    // announcement. This is the real sequence behind an inline script.
    capturePwaInstallEvent();
    window.dispatchEvent(createPromptEvent());

    renderPrompt();
    window.dispatchEvent(new Event(PWA_INSTALL_AVAILABLE_EVENT));

    await waitFor(() => {
      expect(screen.getByTestId('install-prompt')).toBeInTheDocument();
    });
  });

  it('offers nothing when the app was installed before it mounted', async () => {
    bootPageWithOffer();
    window.dispatchEvent(new Event('appinstalled'));

    renderPrompt();

    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });
  });

  it('offers nothing on Chromium when no capture was ever wired', async () => {
    // A REQUIREMENT, not a defect: the hook cannot listen early enough on its
    // own, so an unwired host genuinely cannot offer an install.
    window.dispatchEvent(createPromptEvent());

    renderPrompt();

    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });
  });

  it('carries a working handle through, not merely a flag', async () => {
    const event = bootPageWithOffer();

    renderPrompt();

    fireEvent.click(await screen.findByTestId('install-prompt-install'));

    // A version that only set a boolean would render this button and then do
    // nothing when it was pressed.
    await waitFor(() => {
      expect(event.prompt).toHaveBeenCalledTimes(1);
    });
  });
});
