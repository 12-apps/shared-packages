import { expect, type Page } from '@playwright/test';
import { defineRbacWorld } from '@12-apps/rbac/e2e';

/**
 * THIS APP'S half of the packaged rbac journeys.
 *
 * The scenarios and their steps ship inside `@12-apps/rbac`; none of them is
 * copied here, and none of them knows what a harness page is. What is
 * host-specific is exactly what this file supplies: which URL the roster and
 * the catalog live at, how somebody who may manage the team gets signed in,
 * and which of this app's own seeded rows a scenario may name.
 *
 * That is the integration a real consumer performs too — an admin app routes to
 * `/{tenantSlug}/team` where this routes to `#/rbac-admin`, and signs in with
 * its own provider where this rides the backend's headerless actor seam. The
 * features do not change.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `defineRbacWorld` call below lands in
 * every worker before the first Given executes.
 */

/** The harness page that mounts the surface. Both screens are behind its tabs. */
const PAGE_URL = '#/rbac-admin';

defineRbacWorld({
  /**
   * "Signed in as somebody who may manage the team" is, in this harness, the
   * seeded DIRECTOR — the backend's actor seam answers a headerless request as
   * `owner-1`, which is who an admin screen assumes is driving it. The reset is
   * the load-bearing half: the roster scenarios reassign a role, and the next
   * scenario has to start from the seed rather than from that.
   */
  signInAsManager: async (page: Page) => {
    const response = await page.request.post('/__harness/reset');
    expect(response.status()).toBe(204);
  },

  openTeamScreen: async (page: Page) => {
    await page.goto(PAGE_URL);
    await page.getByTestId('rbac-tab-team').click();
    await expect(page.getByTestId('team-grid')).toBeVisible();
  },

  openRolesScreen: async (page: Page) => {
    await page.goto(PAGE_URL);
    await expect(page.getByTestId('roles-grid')).toBeVisible();
  },

  fixtures: {
    /**
     * `role-target` rather than one of the named staff: the reassignment
     * scenario CHANGES this member's base role, and the seed keeps this row for
     * exactly that — nothing else in the harness reads it, so a scenario that
     * fails halfway leaves no other spec looking at a role it did not expect.
     */
    matching: {
      id: 'role-target',
      email: 'target@harness.dev',
      label: 'Role Target',
      currentRole: 'CONSERVATOR',
    },
    /**
     * Somebody the same keyword must NOT match. This is what makes "the roster
     * narrowed" a real claim rather than "the grid still has rows".
     */
    excluded: {
      id: 'owner-1',
      email: 'ana@harness.dev',
      label: 'Ana Ribeiro',
      currentRole: 'DIRECTOR',
    },
    /** Matches `Role Target` and nothing else in the seeded roster. */
    keyword: 'target',
    /** A base role `role-target` does not hold, so assigning it is a change. */
    assignableRole: 'CLERK',
    /** One of the two seeded custom roles; `Catalogador` is the other, and is
     *  what the catalog search has to drop. */
    customRole: 'Voluntário',
    /**
     * A plain CLASS permission — no owner-marker, no separation-of-duties
     * counterpart — so the composer's checkbox is always togglable on a fresh
     * form. A marked or paired one would be disabled by the governance rules
     * the picker enforces, and the scenario would fail on a rule working.
     */
    composablePermission: 'copies:read',
    /** A name no seed uses, so the compose journey's row is unambiguous. */
    newRoleName: 'Papel do Harness',
  },
});
