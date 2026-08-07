import { test as base, createBdd } from 'playwright-bdd';

/**
 * The BDD `test` every packaged step binds to (FUT-743, packaged by FUT-561).
 *
 * Extending Playwright's own `test` rather than cucumber's runner is the whole
 * point of playwright-bdd: these scenarios run as ordinary Playwright tests,
 * against the host's own web server, with the same reporters, retries and
 * traces as the specs beside them.
 *
 * There is deliberately NO fixture here beyond Playwright's own. An earlier
 * version carried a `journey` fixture remembering which harness page a scenario
 * had opened, which is exactly the kind of host knowledge that stopped these
 * journeys from shipping with the library. Where a step needs the host, it asks
 * {@link paymentsWorld} — a module-level registry the host installs into — so
 * this `test` stays something a consumer never has to reconstruct.
 */
export const test = base;

export const { Given, When, Then } = createBdd(test);
