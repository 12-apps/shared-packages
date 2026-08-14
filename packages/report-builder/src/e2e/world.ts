import type { Browser, Page } from '@playwright/test';

/**
 * The port a HOST implements to run the packaged report journeys (FUT-755).
 *
 * The journeys themselves are portable: every assertion in them reads a test id
 * this package's own components render, so `reports-card-new`,
 * `report-editor-save`, `builder-chart-type-line` and `report-block-<id>` mean
 * the same thing in any app that mounts `createWebReportBuilder`. What is NOT
 * portable is everything around them — how this app routes to the reports area,
 * how it gets back to a known set of saved documents, and which of its own rows
 * a scenario is allowed to name.
 *
 * That is the whole of this port. A host implements it once, adds two globs to
 * its bdd config, and inherits every scenario the library ships — including the
 * ones added after it integrated. Nothing is copied, so nothing can rot.
 *
 * It is deliberately the same shape as `@12-apps/payments-e2e`'s `PaymentsWorld`:
 * a couple of navigations, a way back to a known fixture, and the facts an
 * assertion has to name out loud.
 */

/**
 * One entry of the host's block-template picker, as a scenario has to address
 * it: by the `id` the tile's test id is built from, and by the `title` printed
 * on it.
 *
 * BOTH, and the `id` especially, because the alternative was a map: the package
 * used to carry a title → id table so a host could name titles alone, and that
 * table held the seven templates of the application this package was extracted
 * from — inside the published tarball, `src/e2e/**` being published — and threw
 * `unknown block template` for any title not in it. Every journey was therefore
 * unrunnable for any host but that one, while the features above it had already
 * stopped naming a title out loud. A host states its own id; there is nothing
 * left to keep a list of.
 */
export interface ReportsBlockTemplate {
  /** The picker's own id — `block-template-picker-<id>` is the tile. */
  id: string;
  /** What the tile prints, and what the block it creates is titled. */
  title: string;
}

/**
 * Facts about the host's own seed that the assertions have to name.
 *
 * These exist because a journey has to talk about SOMETHING — a report that is
 * already published, a grouping the catalog orders and one it does not, a
 * window with data in it. None of that can live in the feature file without
 * inventing one host's fixture as though it were everybody's, and none of it
 * can be discovered from the screen without the scenario asserting whatever it
 * happens to find, which is not an assertion at all.
 */
export interface ReportsFixtures {
  /**
   * Two entries of the host's own block-template picker.
   *
   * A scenario has to start a block from something, and what a picker offers is
   * the host's product: this package ships only the blank template. The
   * features used to name `"Receita por dia"` and `"Formas de pagamento"` out
   * loud — one store's menu, written into a journey every other store runs — so
   * they say "the first template" and "a second template" and read the entries
   * from here.
   *
   * They must be DIFFERENT templates: the scenario that puts two blocks on one
   * canvas is about two blocks, and picking the same one twice would still pass
   * while proving less.
   */
  blockTemplates: {
    /** The one a scenario builds its first block from. */
    first: ReportsBlockTemplate;
    /** A different one, added beside it. */
    second: ReportsBlockTemplate;
  };
  /** A report the whole team can already read — the one a reader opens. */
  publishedReport: {
    id: string;
    /** Its name, as the list and the viewer print it. */
    name: string;
    /** A block of it drawn as a chart: what the table toggle and the CSV act on. */
    chartBlockId: string;
    /** A block of it drawn as a table: what a period narrows, row by row. */
    tableBlockId: string;
  };
  /**
   * A grouping whose values have a real order, so a line may join them — a
   * date, or an encoded hour. Named by the label the host's catalog gives it.
   */
  orderedGrouping: string;
  /** A grouping whose values have NO order, where the same line is a fiction. */
  unorderedGrouping: string;
  /**
   * A window the author picks by hand out of the calendar, and what the host's
   * data answers with.
   *
   * The two days are read off the FIRST month the picker opens on, which is the
   * start of the period already on screen — so a host seeds them against its own
   * clock rather than against the machine running the test.
   */
  customWindow: {
    /** The day of the month the window opens on. */
    fromDay: number;
    /** The day of the month it closes on. */
    toDay: number;
    /** What the resolved-window line reads once it is applied. */
    reads: string;
    /** How many rows the report's table block then holds. */
    rows: number;
  };
}

/** Everything a host supplies to run the packaged journeys. */
export interface ReportsWorld {
  /**
   * Back to the seeded documents.
   *
   * Every scenario starts here, because these journeys WRITE — one publishes a
   * new report, another parks a working copy — and a suite whose second run
   * sees the first run's leftovers passes exactly once.
   */
  reset(page: Page): Promise<void>;
  /** Put the browser on the list of saved reports. */
  openReports(page: Page): Promise<void>;
  /**
   * The same list, in a BRAND-NEW browser session: no cookies, no storage,
   * nothing this scenario has already loaded.
   *
   * It is a port rather than a `browser.newContext()` in the steps because the
   * host decides what a session IS — the harness needs only a fresh context,
   * an app behind a login needs to sign in again. Closing the page (and its
   * context) is the caller's job.
   *
   * `from` is the session being left, and it is passed because a fresh context
   * inherits none of the config's `use` options — its `baseURL` included — so
   * without it the host would have to write its own origin down a second time,
   * where it could drift from the one the suite is actually running against.
   */
  openInNewSession(browser: Browser, from: Page): Promise<Page>;
  fixtures: ReportsFixtures;
}

let installed: ReportsWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the host's
 * OWN steps glob — playwright-bdd imports every step file before any scenario
 * runs, so a top-level call there is registered in time, in every worker.
 */
export function defineReportsWorld(world: ReportsWorld): void {
  installed = world;
}

/**
 * The installed world.
 *
 * Throws rather than degrading: a journey that ran against a half-configured
 * world would fail somewhere deep inside a step with a message about a missing
 * element, and the actual cause — a host that forgot to call
 * {@link defineReportsWorld} — would be several layers away from the error.
 */
export function reportsWorld(): ReportsWorld {
  if (!installed) {
    throw new Error(
      'No ReportsWorld installed. Call defineReportsWorld(...) from a module ' +
        "inside this app's bdd `steps` glob — see @12-apps/report-builder/e2e's README.",
    );
  }
  return installed;
}
