import type { Page } from '@playwright/test';

/**
 * The port a HOST implements to run the packaged promotions journeys.
 *
 * The journeys are portable because every assertion in them reads a test id
 * this package's own components render — `discounts-grid`, `discount-dialog`,
 * `discount-action-edit`, `total-form-field-*` mean the same thing in any app
 * that mounts `createWebDiscounts`. What is NOT portable is everything around
 * them: how an app signs somebody in, how it routes to the promotions screen,
 * how it returns to a known state, and how it renders a percentage.
 *
 * It replaces a 167-line spec in the origin host (`discounts.e2e.ts`), which
 * asserted this package's test ids from a repo it does not build — the
 * arrangement whose failure mode is silent from here: rename an id inside the
 * package and a spec it cannot see goes red somewhere it does not run.
 */

/**
 * Facts about the host that the assertions have to name.
 *
 * A journey has to talk about SOMETHING: a permission to tick, a name to type,
 * a rendered value to look for. None of that can live in a feature file without
 * inventing one host's fixture as though it were everybody's.
 */
export interface DiscountsFixtures {
  /**
   * A name no seed uses, minted FRESH per call.
   *
   * A function rather than a string because these journeys WRITE: the
   * promotions table carries a per-tenant unique index on the name, so a
   * constant would collide with itself on the second scenario and on every
   * re-run against the same database.
   */
  newName: (prefix: string) => string;
  /** The percentage a create journey types, as the form takes it (e.g. `15`). */
  percent: string;
  /**
   * How that percentage READS in the grid once saved (e.g. `15%`).
   *
   * Stated by the host because formatting is the host's: `createWebDiscounts`
   * takes a locale and a currency, so the same 15 renders differently in two
   * adopters. It is the round-trip that matters — a value typed as a percentage
   * comes back as one only if the conversion into basis points and back out
   * both ran — and this is the half a package cannot spell.
   */
  percentInGrid: string;
}

/** What a host must be able to do for these journeys to run in it. */
export interface DiscountsWorld {
  /**
   * Put the browser in a known signed-in state as somebody who may manage
   * promotions, and return the store to a known one.
   *
   * These journeys write, so the reset is load-bearing rather than hygiene: a
   * scenario that renamed a promotion would otherwise hand the next one a
   * catalog it did not expect.
   */
  signInAsManager(page: Page): Promise<void>;
  /** Land on the promotions screen and wait until its grid has rendered. */
  openDiscountsScreen(page: Page): Promise<void>;
  fixtures: DiscountsFixtures;
}

let installed: DiscountsWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the host's
 * OWN steps glob — playwright-bdd imports every step file before any scenario
 * runs, so a top-level call there is registered in time, in every worker.
 */
export function defineDiscountsWorld(world: DiscountsWorld): void {
  installed = world;
}

/**
 * The installed world, or a refusal naming the fix.
 *
 * Throws rather than returning null: a step that ran against an absent world
 * would fail on whatever it touched next, somewhere unrelated to the actual
 * mistake, which is a diagnosis nobody should have to make twice.
 */
export function discountsWorld(): DiscountsWorld {
  if (!installed) {
    throw new Error(
      'No discounts e2e world is installed. Call defineDiscountsWorld({ … }) from a module ' +
        "inside your own `steps` glob — playwright-bdd imports those before any " +
        'scenario runs, which is what makes the registration land in every worker.',
    );
  }
  return installed;
}
