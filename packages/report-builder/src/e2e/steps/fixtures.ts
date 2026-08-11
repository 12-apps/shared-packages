import type { Download, Page } from '@playwright/test';
import { test as base, createBdd } from 'playwright-bdd';

/**
 * The BDD world for the report journeys (FUT-755).
 *
 * A scenario names the author once and then talks about "she" for the rest of
 * it, and it says things like "fewer days than before" — so the steps need
 * somewhere to remember what "before" was and, once the author has walked away
 * and come back, WHICH BROWSER she is looking at. That is all this is.
 *
 * It deliberately holds no host knowledge. `@12-apps/payments-e2e` ships with no
 * fixture at all for exactly that reason: an earlier version of it remembered
 * which harness page a scenario had opened, which is the kind of thing that
 * stops journeys from shipping with the library. Everything here is about the
 * SCENARIO — a row count, a measured height, a second session — and every
 * question about the app is asked of the installed `ReportsWorld` instead.
 */
export class ReportsJourney {
  #session: Page | null = null;
  #rows: number | null = null;
  #height: number | null = null;
  #reportId: string | null = null;
  #download: Download | null = null;

  /**
   * The page the author is actually looking at.
   *
   * The scenario's own `page` until she comes back in a new session, and that
   * one afterwards — so every step downstream keeps reading "the screen" and
   * none of them has to know a second browser exists.
   */
  screen(fallback: Page): Page {
    return this.#session ?? fallback;
  }

  /** Called by the step that opens a brand-new session. */
  useSession(page: Page): void {
    this.#session = page;
  }

  /** The extra session to tear down, if the scenario opened one. */
  get session(): Page | null {
    return this.#session;
  }

  /**
   * How many rows the report held last time a step counted them.
   *
   * Reading it before anything has counted throws by design: "fewer than
   * before" in a scenario with no earlier count is a sentence with no meaning,
   * and comparing against a silent zero would make it pass for the wrong
   * reason.
   */
  get rows(): number {
    if (this.#rows === null) {
      throw new Error('Nothing counted yet — a Then must read the report first.');
    }
    return this.#rows;
  }

  countedRows(rows: number): void {
    this.#rows = rows;
  }

  /** The same idea for a block's measured height, used by the sizing journey. */
  get height(): number {
    if (this.#height === null) {
      throw new Error('Nothing measured yet — a Then must read the block first.');
    }
    return this.#height;
  }

  measuredHeight(height: number): void {
    this.#height = height;
  }

  /**
   * The id of the report the scenario has just created.
   *
   * Read off the address bar the surface writes, so a Then can name that
   * report's card exactly instead of hunting the grid for one whose text
   * happens to match — which would also match the card of a report that merely
   * MENTIONS the name.
   */
  get reportId(): string {
    if (this.#reportId === null) {
      throw new Error('No report opened yet — a When must save or open one first.');
    }
    return this.#reportId;
  }

  opened(id: string): void {
    this.#reportId = id;
  }

  /** The file the browser was handed, for the Then that reads it. */
  get download(): Download {
    if (this.#download === null) {
      throw new Error('Nothing downloaded yet — a When must ask for the file first.');
    }
    return this.#download;
  }

  downloaded(download: Download): void {
    this.#download = download;
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
 * The teardown closes the second session's whole CONTEXT rather than its page.
 * A context left open holds a browser's worth of state between scenarios, and
 * the journey that opens one is precisely the journey about state surviving —
 * so leaking it would let the next scenario inherit the very thing this one is
 * proving the server, not the browser, is holding.
 */
export const test = base.extend<{ journey: ReportsJourney }>({
  /* eslint-disable-next-line no-empty-pattern -- Playwright reads the destructured
     pattern to resolve fixture dependencies; this one genuinely needs none. */
  journey: async ({}, use) => {
    const journey = new ReportsJourney();
    await use(journey);
    const session = journey.session;
    if (session) await session.context().close();
  },
});

export const { Given, When, Then } = createBdd(test);
