import { test as base, createBdd } from 'playwright-bdd';

/**
 * Who the scenario is about, and what it has learned so far.
 *
 * This is SCENARIO memory, not host knowledge, which is why it can live in the
 * package: "the address this journey names", "the password she last chose",
 * "the link we last read out of her inbox". Every step after the opening
 * `Given` says "she", and this is what that word resolves to.
 *
 * Contrast `AuthWorld`, which is the host's — how a user comes to exist, how
 * the switches flip, how mail is read. Keeping the two apart is what lets these
 * scenarios ship with the library.
 */
export class AuthAccount {
  #account: { email: string; password: string | null } | null = null;
  #lastLink: string | null = null;

  get email(): string {
    if (!this.#account) {
      throw new Error(
        'No account yet — an auth scenario must open with a Given naming an address.',
      );
    }
    return this.#account.email;
  }

  /** The password most recently chosen, for a step that signs in "with it". */
  get password(): string | null {
    return this.#account?.password ?? null;
  }

  get lastLink(): string {
    if (!this.#lastLink) {
      throw new Error('No link read yet — a step must open one from the inbox first.');
    }
    return this.#lastLink;
  }

  start(email: string, password: string | null = null): void {
    this.#account = { email, password };
  }

  rememberPassword(password: string): void {
    this.#account = { email: this.email, password };
  }

  rememberLink(link: string): void {
    this.#lastLink = link;
  }
}

/**
 * The BDD `test` every packaged step binds to.
 *
 * Extending Playwright's own `test` rather than cucumber's runner is the whole
 * point of playwright-bdd: these scenarios run as ordinary Playwright tests,
 * against the host's own web server, with the same reporters, retries and
 * traces as the specs beside them.
 *
 * The one fixture beyond Playwright's own is {@link AuthAccount} — see its
 * docstring for why that is not host knowledge. Anything that IS, a step asks
 * `authWorld()` for.
 */
export const test = base.extend<{ account: AuthAccount }>({
  // Playwright resolves fixtures by reading the destructuring pattern, so the
  // first parameter must be one even when this fixture depends on nothing.
  // eslint-disable-next-line no-empty-pattern -- see above
  account: async ({}, use) => {
    await use(new AuthAccount());
  },
});

export const { Given, When, Then } = createBdd(test);
