import { test as base, createBdd } from "playwright-bdd";

/**
 * The BDD world for the beta-cohort journeys (FUT-884) — deliberately tiny,
 * and deliberately host-free (the payments-e2e rule): everything about the
 * APP is asked of the installed `FeatureFlagsWorld`; the only thing a
 * scenario has to remember for itself is which beta the operator opened, so
 * "that beta tallies …" can keep saying "that" instead of naming a key.
 */
export class FlagsJourney {
  #openKey: string | null = null;

  open(key: string): void {
    this.#openKey = key;
  }

  /** Reading it before any beta was opened throws by design. */
  get openKey(): string {
    if (this.#openKey === null) {
      throw new Error("No beta opened yet — a When must open one first.");
    }
    return this.#openKey;
  }
}

export const test = base.extend<{ journey: FlagsJourney }>({
  // eslint-disable-next-line no-empty-pattern -- playwright's fixture signature.
  journey: async ({}, use) => {
    await use(new FlagsJourney());
  },
});

export const { Given, When, Then } = createBdd(test);
