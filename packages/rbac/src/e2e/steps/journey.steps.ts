import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { rbacWorld } from '../world.js';

/**
 * The packaged journeys' step definitions.
 *
 * Every locator is a test id THIS package's own components render, which is what
 * makes the scenarios portable: `team-grid`, `team-search-all`, `roles-grid`,
 * `role-edit-dialog`, `role-dialog` and `member-profile-tabs` mean the same
 * thing in any app that mounts `createWebRbac`. Everything a host owns —
 * sign-in, routing, which rows exist — arrives through the world port rather
 * than being written down here.
 *
 * ## Why `package.json` declares this file under `sideEffects`
 *
 * Every `Given`/`When`/`Then` below runs at IMPORT time — registering a step is
 * the whole point of the module, and it exports nothing anybody imports by
 * name. To a bundler doing tree-shaking that reads as dead weight, and dropping
 * it is licensed: the result is a suite where bddgen reports the features
 * compiled and every scenario then fails on an undefined step, or worse,
 * silently binds none. `**\/e2e/steps/*.steps.*` covers both the source here and
 * the compiled twin a consumer actually resolves.
 *
 * The kebab entries are reached by `team-action-<id>` / `role-action-<id>`,
 * derived from each action's STABLE id. Clicking one by its visible label would
 * pin the scenario to a single adopter's copy, which is the coupling these
 * journeys replaced.
 *
 * Not one step asserts a SENTENCE. The origin host's three specs did (`heading
 * "Equipe"`, the "Novo papel" dialog title), which is why they could only ever
 * have run in that host: the copy is required config, so the next adopter's
 * words are different by construction and the spec would fail for a reason that
 * has nothing to do with the roster.
 */
const { Given, When, Then } = createBdd();

const TEAM_GRID = 'team-grid';
const ROLES_GRID = 'roles-grid';

Given('I am signed in as somebody who may manage the team', async ({ page }) => {
  await rbacWorld().signInAsManager(page);
});

When('I open the team screen', async ({ page }) => {
  await rbacWorld().openTeamScreen(page);
  await expect(page.getByTestId(TEAM_GRID)).toBeVisible();
});

When('I open the roles screen', async ({ page }) => {
  await rbacWorld().openRolesScreen(page);
  await expect(page.getByTestId(ROLES_GRID)).toBeVisible();
});

Then('the team grid is visible', async ({ page }) => {
  await expect(page.getByTestId(TEAM_GRID)).toBeVisible();
});

Then('the roles grid is visible', async ({ page }) => {
  await expect(page.getByTestId(ROLES_GRID)).toBeVisible();
});

/** The inline keyword box commits on Enter — the grid's own affordance. */
async function commitSearch(page: Page, testId: string, term: string): Promise<void> {
  const box = page.getByTestId(testId);
  await box.fill(term);
  await box.press('Enter');
  await expect(box).toHaveValue(term);
}

When('I search the roster for the seeded keyword', async ({ page }) => {
  await commitSearch(page, 'team-search-all', rbacWorld().fixtures.keyword);
});

When('I search the catalog for the seeded custom role', async ({ page }) => {
  await commitSearch(page, 'roles-search-all', rbacWorld().fixtures.customRole);
});

/**
 * The URL is the assertion, not the row count.
 *
 * A server-driven grid writes the committed term to the address bar and
 * re-fetches; asserting on the rows alone cannot tell that apart from a filter
 * applied to rows already in the browser, which is the bug this scenario exists
 * to catch.
 */
Then('the address bar carries the keyword', async ({ page }) => {
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(rbacWorld().fixtures.keyword)}`));
});

Then('the address bar carries the custom role name', async ({ page }) => {
  await expect(page).toHaveURL(
    new RegExp(`[?&]q=${encodeURIComponent(rbacWorld().fixtures.customRole)}`),
  );
});

Then('the matching member is listed', async ({ page }) => {
  await expect(page.getByTestId(TEAM_GRID).getByText(rbacWorld().fixtures.matching.label)).toBeVisible();
});

/** The half that makes "narrowed" mean something: somebody is GONE. */
Then('the excluded member is not listed', async ({ page }) => {
  await expect(
    page.getByTestId(TEAM_GRID).getByText(rbacWorld().fixtures.excluded.label),
  ).toHaveCount(0);
});

Then('the seeded custom role is listed', async ({ page }) => {
  await expect(page.getByTestId(ROLES_GRID).getByText(rbacWorld().fixtures.customRole)).toBeVisible();
});

/**
 * One role checkbox's INPUT.
 *
 * The design system puts the test id on the wrapping element and keeps a real
 * `<input type="checkbox">` inside it, so a click lands either way but
 * `toBeChecked()` only means something on the input.
 */
function roleOption(page: Page, role: string) {
  return page.getByTestId(`role-opt-${role}`).locator('input[type="checkbox"]');
}

When('I open the role editor for the matching member', async ({ page }) => {
  const { matching } = rbacWorld().fixtures;
  await page.getByTestId(`team-actions-${matching.id}`).click();
  await page.getByTestId('team-action-edit-roles').click();
  await expect(page.getByTestId('role-edit-dialog')).toBeVisible();
});

When('I assign the seeded base role', async ({ page }) => {
  const { matching, assignableRole } = rbacWorld().fixtures;
  // Exactly ONE system role may be selected, so the swap is two clicks: the
  // save stays disabled between them, which is the rule working.
  await page.getByTestId(`role-opt-${matching.currentRole}`).click();
  await page.getByTestId(`role-opt-${assignableRole}`).click();
  await page.getByTestId('role-edit-save').click();
  await expect(page.getByTestId('role-edit-dialog')).toHaveCount(0);
});

/**
 * The reassignment is proved by REOPENING the editor, not by reading the grid.
 *
 * The roster's roles column renders a role's LABEL — host copy, different in
 * every adopter — so an assertion there would either name one app's words or
 * need the fixture to carry them, and a journey that asserts a sentence is the
 * coupling these replaced. `role-opt-<name>` is keyed on the WIRE value, which
 * means the same thing everywhere.
 *
 * It is also the stronger claim: reopening refetches, so what is checked is
 * what the SERVER stored rather than what the dialog left on screen.
 */
Then('the role editor shows the seeded base role selected', async ({ page }) => {
  const { matching, assignableRole } = rbacWorld().fixtures;
  await expect(roleOption(page, assignableRole)).toBeChecked();
  // And the old one is GONE — exactly one system role may be held, so a
  // reassignment that only ADDED would leave an invalid selection the dialog
  // refuses to save, which a check on the new role alone passes straight over.
  await expect(roleOption(page, matching.currentRole)).not.toBeChecked();
});

When('I start composing a new role', async ({ page }) => {
  await page.getByTestId('add-role-button').click();
});

Then('the role form dialog is open', async ({ page }) => {
  await expect(page.getByTestId('role-dialog')).toBeVisible();
  await expect(page.getByTestId('role-form')).toBeVisible();
});

When('I dismiss the role form', async ({ page }) => {
  await page.getByTestId('role-cancel').click();
});

Then('the role form dialog is closed', async ({ page }) => {
  await expect(page.getByTestId('role-dialog')).toHaveCount(0);
});

When('I open the matching member\u2019s profile', async ({ page }) => {
  const { matching } = rbacWorld().fixtures;
  await page.getByTestId(TEAM_GRID).getByText(matching.label).first().click();
});

Then('the member profile is visible', async ({ page }) => {
  await expect(page.getByTestId('member-profile-tabs')).toBeVisible();
  await expect(page.getByTestId('member-details-tab')).toBeVisible();
});

Then('the profile names the member', async ({ page }) => {
  const { matching } = rbacWorld().fixtures;
  await expect(page.getByTestId('member-dashboard-header')).toContainText(matching.label);
});

/**
 * The tab lives in the URL, which is what makes a profile view shareable. It is
 * asserted on the address bar rather than on the panel, because a panel that
 * switched without the URL moving looks identical and is not the same thing.
 */
When('I open the member\u2019s activity tab', async ({ page }) => {
  await page.getByTestId('member-profile-tabs').getByRole('tab').nth(1).click();
});

Then('the address bar carries that tab', async ({ page }) => {
  await expect(page).toHaveURL(/[?&]tab=actions/);
});

When('I start adding an administrator', async ({ page }) => {
  await page.getByTestId('add-admin-button').click();
});

Then('the invite form is open', async ({ page }) => {
  await expect(page.getByTestId('invite-dialog')).toBeVisible();
  await expect(page.getByTestId('invite-form')).toBeVisible();
});

When('I dismiss the invite form', async ({ page }) => {
  // The dialog's own close control, by test id. The form has no cancel button
  // of its own, and reaching for the close by its accessible NAME would be a
  // sentence assertion wearing a different hat.
  await page.getByTestId('invite-dialog-close').click();
});

Then('the invite form is closed', async ({ page }) => {
  await expect(page.getByTestId('invite-dialog')).toHaveCount(0);
});

/**
 * THE WRITE JOURNEYS.
 *
 * The three above this line only read. These three compose a role, grant and
 * revoke an additive one, and prove the editor refuses an invalid selection —
 * the package's own contract, and until now described only by a spec living in
 * the consumer that happened to be able to reset its database.
 *
 * They are safe here for the same reason: `signInAsManager` returns the host to
 * a known state, which the port has always required.
 */

When('I compose a role from the seeded permission', async ({ page }) => {
  const { newRoleName, composablePermission } = rbacWorld().fixtures;
  await page.getByTestId('add-role-button').click();
  const dialog = page.getByTestId('role-dialog');
  await dialog.getByTestId('role-name').fill(newRoleName);
  // The submit unlocks only with a name AND at least one permission — so the
  // order here is the rule, not a preference.
  await dialog.getByTestId(`perm-${composablePermission}`).click();
  await dialog.getByTestId('role-submit').click();
  await expect(dialog).toHaveCount(0);
});

Then('the composed role is listed', async ({ page }) => {
  // A role's NAME is the one user-visible string that is not copy: the host
  // chose it in this scenario, so naming it here is naming a fixture.
  await expect(
    page.getByTestId(ROLES_GRID).getByText(rbacWorld().fixtures.newRoleName),
  ).toBeVisible();
});

When('I add the seeded custom role to the matching member', async ({ page }) => {
  await toggleCustomRole(page);
});

When('I take the seeded custom role back', async ({ page }) => {
  await toggleCustomRole(page);
});

Then('the member holds the seeded custom role', async ({ page }) => {
  await expect(roleOption(page, rbacWorld().fixtures.customRole)).toBeChecked();
});

Then('the member no longer holds the seeded custom role', async ({ page }) => {
  await expect(roleOption(page, rbacWorld().fixtures.customRole)).not.toBeChecked();
});

/**
 * A custom role is ADDITIVE, so the same click grants and revokes it — the
 * dialog diffs the selection and calls the grant or the revoke endpoint. One
 * helper, because they are one affordance.
 */
async function toggleCustomRole(page: Page): Promise<void> {
  const { customRole } = rbacWorld().fixtures;
  await page.getByTestId(`role-opt-${customRole}`).click();
  await page.getByTestId('role-edit-save').click();
  await expect(page.getByTestId('role-edit-dialog')).toHaveCount(0);
}

When("I clear the member's base role", async ({ page }) => {
  await page.getByTestId(`role-opt-${rbacWorld().fixtures.matching.currentRole}`).click();
});

Then('the editor refuses the save', async ({ page }) => {
  // Exactly one system role, always. Zero is as invalid as two, and the
  // refusal is stated on screen rather than only enforced on submit.
  await expect(page.getByTestId('role-edit-invalid')).toBeVisible();
  await expect(page.getByTestId('role-edit-save')).toBeDisabled();
});
