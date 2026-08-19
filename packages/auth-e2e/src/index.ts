/**
 * `@12-apps/auth-e2e` — the e-mail + password journeys, as Gherkin a host runs
 * against its own app.
 *
 * Mounting `createEmailCredentials` and `createEmailAuthScreens` gives you
 * sign-up, confirmation, reset and the add-a-password card. This gives you
 * their end-to-end coverage: nine scenarios across three features. You
 * implement one port and add three lines of bdd config. Nothing is copied, so
 * a scenario added here later runs in your app on the next version bump.
 */

export { authFeatures, authFeaturesRoot, authSteps } from './globs.js';

export { defineAuthWorld, authWorld } from './world.js';

export type { AuthWorld, SeedUserInput, SentAuthEmail } from './world.js';
