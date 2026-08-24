/**
 * `createWebOnboarding(config)` — the `createWeb*` factory this package never
 * had, and the reason its screens could not be declared.
 *
 * Everything below already shipped: `OnboardingProvider`, `GuidedSection`, and
 * `createOnboardingApiStore` bound to this package's own endpoints. What was
 * missing is the ONE thing the wiring contract's `surface` capability names —
 * a factory from a config object to a bound surface — so every host repeated
 * the same three-line assembly (build the store, wrap in the provider, thread
 * the featureKey through both) and no manifest could point at it.
 *
 * The assembly is not hard. It is just the kind of thing that gets written
 * slightly differently in each host, and then cannot be adopted at all: the
 * `featureKey` has to be the SAME string in the store and the provider, which
 * is a coupling nothing checked before this factory closed over it once.
 *
 * `Provider` and `Section` are component TYPES, so the surface must be built
 * once per config — the consumer's binder does that memoisation, which is why
 * this is a factory rather than a hook.
 */

import type { ComponentType, ReactNode } from 'react';

import { createOnboardingApiStore, type OnboardingApiStoreConfig } from './api-store';
import { GuidedSection, type GuidedSectionProps } from './guided-section';
import { OnboardingProvider } from './onboarding-context';
import type { OnboardingStateSnapshot, OnboardingStore } from './types';

/**
 * The factory's config: the api store's, plus an escape hatch.
 *
 * `store` lets a host that persists progress somewhere other than these
 * endpoints (or a test) supply its own, without giving up the binding. When it
 * is set, `apiBase` is unused — which is why it is the one field the api store
 * needs that this type keeps optional.
 */
export interface WebOnboardingConfig extends Omit<OnboardingApiStoreConfig, 'apiBase'> {
  apiBase?: string;
  store?: OnboardingStore;
}

/** The bound surface: the two components plus the store they share. */
export interface WebOnboarding {
  /**
   * Wrap the guided area once. `featureKey` is already closed over, so it
   * cannot disagree with the store's — the coupling this factory exists for.
   */
  Provider: ComponentType<{
    initialState: OnboardingStateSnapshot | null;
    children: ReactNode;
  }>;
  /** The guided flow itself; every word stays a required prop. */
  Section: ComponentType<GuidedSectionProps>;
  /** The bound store, for host glue that reads or resets progress directly. */
  store: OnboardingStore;
}

/**
 * The api-store half of the config, with the one field it cannot do without
 * checked HERE rather than at the first failed request — an empty `apiBase`
 * sends every save to `/onboarding/<key>` at the app's own origin, which is a
 * 404 wearing a network error's clothes (the `createWebEntitlements`
 * precedent, same failure, same refusal).
 */
function apiStoreConfigOf(config: WebOnboardingConfig): OnboardingApiStoreConfig {
  if (typeof config.apiBase !== 'string' || config.apiBase.trim() === '') {
    throw new Error(
      'createWebOnboarding({ apiBase }) is required unless you pass your own `store`.',
    );
  }
  return {
    apiBase: config.apiBase,
    featureKey: config.featureKey,
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  };
}

export function createWebOnboarding(config: WebOnboardingConfig): WebOnboarding {
  const store = config.store ?? createOnboardingApiStore(apiStoreConfigOf(config));
  const featureKey = config.featureKey;

  return {
    Provider: ({ initialState, children }) => (
      <OnboardingProvider featureKey={featureKey} store={store} initialState={initialState}>
        {children}
      </OnboardingProvider>
    ),
    Section: GuidedSection,
    store,
  };
}
