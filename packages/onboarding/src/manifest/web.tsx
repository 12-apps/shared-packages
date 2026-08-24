/**
 * `@12-apps/onboarding/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebOnboarding`: the provider, the guided section
 * and the bound store, assembled once per adoption with the `featureKey`
 * closed over so the store and the provider cannot disagree about it.
 *
 * ## Why this manifest exists now
 *
 * The shared manifest narrowed `web` away on a premise that is false: that
 * listing it "would oblige every SERVER host adopting this manifest to answer
 * for a React surface it never mounts". The consumer reports a capability
 * declared for the OTHER runtime as `out-of-scope` and returns fine; only an
 * applicable, unanswered capability is `unbound`. So the narrowing protected
 * nothing, and it cost `OnboardingProvider` and `GuidedSection` the ability to
 * be declared at all.
 *
 * ## Why there are no `areas`
 *
 * A guided flow is not a page of its own — it is a section INSIDE whichever
 * host screen owns the feature being onboarded (payments settings, the AI
 * integration page, the store setup). There is no route to suggest, because
 * the route belongs to the feature, not to the onboarding of it. `featureKey`
 * is the config that says which one, and it is the host's vocabulary.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebOnboarding } from '../create-web-onboarding';

export const onboardingWebManifest = {
  name: '@12-apps/onboarding',
  surface: { create: createWebOnboarding },
} as const satisfies AnyWebManifest;
