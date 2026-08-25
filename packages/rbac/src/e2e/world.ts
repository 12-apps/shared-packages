import type { Page } from '@playwright/test';

/**
 * The port a HOST implements to run the packaged rbac journeys.
 *
 * The journeys are portable because every assertion in them reads a test id
 * this package's own components render — `team-grid`, `team-search-all`,
 * `roles-grid`, `roles-search-all`, `role-edit-dialog`, `role-form-dialog` mean
 * the same thing in any app that mounts `createWebRbac`. What is NOT portable
 * is everything around them: how an app signs somebody in, how it routes to the
 * roster, how it returns to a known state, and which of its own seeded rows a
 * scenario may name.
 *
 * That is the whole of this port. A host implements it once, adds two globs to
 * its bdd config, and inherits every scenario the library ships — including the
 * ones added after it integrated. Nothing is copied, so nothing can rot.
 *
 * It replaces three hand-written specs in the origin host (`team.e2e.ts`,
 * `team-roles.e2e.ts`, `roles.e2e.ts`), which asserted on this package's test
 * ids from outside it — the arrangement where a renamed id inside the package
 * breaks a spec the package cannot see.
 */

/** A seeded member a scenario acts on, as the host's own roster shows them. */
export interface RbacMemberFixture {
  /** The user id the row action is addressed by. */
  id: string;
  /** The address the roster's keyword search matches. */
  email: string;
  /** What the grid PRINTS for them — the name when there is one. */
  label: string;
  /**
   * The base role they hold NOW.
   *
   * The role editor is a checklist over all roles with exactly-one-system-role
   * enforced, so reassigning means unchecking this one as well as checking the
   * new one. A scenario that only checked the new one would sit on an invalid
   * selection with a disabled save — passing or failing for a reason unrelated
   * to the reassignment.
   */
  currentRole: string;
}

/**
 * Facts about the host's own seed that the assertions have to name.
 *
 * A journey has to talk about SOMETHING: somebody to find, somebody who must
 * then be absent, a role to assign. None of that can live in a feature file
 * without inventing one host's fixture as though it were everybody's, and none
 * of it can be discovered from the screen without the scenario asserting
 * whatever it happens to find — which is not an assertion at all.
 */
export interface RbacFixtures {
  /** A member the keyword search MATCHES. */
  matching: RbacMemberFixture;
  /**
   * A member the same keyword must NOT match — what makes "the roster narrowed"
   * a real claim rather than "the grid still has rows".
   */
  excluded: RbacMemberFixture;
  /** The keyword that separates the two above. */
  keyword: string;
  /** A base role the roster may assign, and that `matching` does not hold. */
  assignableRole: string;
  /** A seeded custom role the catalog lists, for the roles-grid scenarios. */
  customRole: string;
}

/** What a host must be able to do for these journeys to run in it. */
export interface RbacWorld {
  /** Put the browser in a known signed-in state as somebody who may manage the team. */
  signInAsManager(page: Page): Promise<void>;
  /** Land on the roster and wait until it has rendered. */
  openTeamScreen(page: Page): Promise<void>;
  /** Land on the roles catalog and wait until it has rendered. */
  openRolesScreen(page: Page): Promise<void>;
  fixtures: RbacFixtures;
}

let installed: RbacWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the host's
 * OWN steps glob — playwright-bdd imports every step file before any scenario
 * runs, so a top-level call there is registered in time, in every worker.
 */
export function defineRbacWorld(world: RbacWorld): void {
  installed = world;
}

/**
 * The installed world, or a refusal naming the fix.
 *
 * Throws rather than returning null: a step that ran against an absent world
 * would fail on whatever it touched next, somewhere unrelated to the actual
 * mistake, which is a diagnosis nobody should have to make twice.
 */
export function rbacWorld(): RbacWorld {
  if (!installed) {
    throw new Error(
      'No rbac e2e world is installed. Call defineRbacWorld({ … }) from a module ' +
        "inside your own `steps` glob — playwright-bdd imports those before any " +
        'scenario runs, which is what makes the registration land in every worker.',
    );
  }
  return installed;
}
