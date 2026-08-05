import type { ReactNode } from 'react';

/**
 * The Chromium-only event that makes a PWA installable from inside the page.
 * It is NOT in TypeScript's DOM lib because it is not a standard: Safari and
 * Firefox never fire it, so the spec never absorbed it.
 *
 * The event is a one-shot handle. Once `prompt()` resolves, the browser
 * discards it; a later install attempt needs the NEXT event the browser emits,
 * not this one held over.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

/**
 * How — or whether — this browser can install the app.
 *
 * `ios` exists as its own case because iOS Safari can install but refuses to be
 * asked: there is no programmatic route, only Share → Add to Home Screen. A
 * host that collapses it into `unsupported` shows nothing to the largest slice
 * of a mobile storefront's traffic.
 */
export type InstallPlatform = 'prompt' | 'ios' | 'unsupported';

/** Result of asking the browser to install. `unavailable` = there was no live prompt to fire. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface UsePwaInstallOptions {
  /** localStorage key holding the dismissal timestamp. */
  storageKey?: string;
  /** Days a dismissal suppresses the prompt for. `0` suppresses it permanently. */
  dismissForDays?: number;
  /** Fired once the browser reports the app was installed. */
  onInstalled?: () => void;
}

export interface PwaInstallState {
  /** True only when an install affordance should actually be rendered. */
  canInstall: boolean;
  /** Which install route this browser offers. */
  platform: InstallPlatform;
  /** True when already running as an installed app. */
  isInstalled: boolean;
  /** Fires the native prompt. Must be called from a user gesture. */
  promptInstall: () => Promise<InstallOutcome>;
  /** Suppresses the affordance for `dismissForDays`. */
  dismiss: () => void;
}

export interface InstallPromptProps {
  /** Headline text. */
  title?: string;
  /** Supporting line under the title. */
  description?: string;
  /** Label for the install button (Chromium only). */
  installLabel?: string;
  /** Replaces the built-in iOS Share → Add to Home Screen wording. */
  iosInstructions?: ReactNode;
  /** Accessible label for the dismiss button. */
  dismissLabel?: string;
  /** Leading icon. Defaults to an install glyph. */
  icon?: ReactNode;
  /** Called with the outcome after the native prompt resolves. */
  onInstall?: (outcome: InstallOutcome) => void;
  /** Called when the user dismisses the prompt. */
  onDismiss?: () => void;
  /** localStorage key holding the dismissal timestamp. */
  storageKey?: string;
  /** Days a dismissal suppresses the prompt for. `0` suppresses it permanently. */
  dismissForDays?: number;
  /** Custom CSS class name. */
  className?: string;
  /** Test ID for component testing. */
  'data-testid'?: string;
}
