import { test as base, createBdd } from 'playwright-bdd';

/**
 * The world the buyer journeys are told in (FUT-743 / FUT-561's half).
 *
 * A scenario opens by naming the store it is set in and then talks about "ela"
 * for the rest of it, so the steps need somewhere to remember which harness
 * page they are on. That is all this is.
 *
 * Reading the slug before the opening Given has run throws by design: a
 * scenario that starts with a When is missing its context, and an undefined
 * slug would otherwise surface much later as a mysterious empty page.
 */
export class Journey {
  #slug: string | null = null;

  get slug(): string {
    if (!this.#slug) {
      throw new Error('Nenhuma loja ainda — o cenário precisa começar com um Given.');
    }
    return this.#slug;
  }

  open(slug: string): void {
    this.#slug = slug;
  }
}

/**
 * The BDD `test` every step binds to.
 *
 * Extending Playwright's own `test` rather than cucumber's runner is the whole
 * point of playwright-bdd: these scenarios run as ordinary Playwright tests,
 * against the same web server, with the same reporters, retries and traces as
 * the specs beside them.
 */
export const test = base.extend<{ journey: Journey }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the destructured
  // pattern to resolve fixture dependencies; this one genuinely needs none.
  journey: async ({}, use) => {
    await use(new Journey());
  },
});

export const { Given, When, Then } = createBdd(test);
