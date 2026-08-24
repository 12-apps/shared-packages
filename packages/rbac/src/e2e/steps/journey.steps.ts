import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { rbacWorld } from '../world.js';

/**
 * The packaged journeys' step definitions.
 *
 * Every locator is a test id THIS package's own components render, which is what
 * makes the scenarios portable: `team-grid`, `team-search-all`, `roles-grid`,
 * `role-edit-dialog` and `role-form-dialog` mean the same thing in any app that
 * mounts `createWebRbac`. Everything a host owns — sign-in, routing, which rows
 * exist — arrives through the world port rather than being written down here.
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

When('I open the role editor for the matching member', async ({ page }) => {
  const { matching } = rbacWorld().fixtures;
  await page.getByTestId(`team-actions-${matching.id}`).click();
  await page.getByTestId('team-action-edit-roles').click();
  await expect(page.getByTestId('role-edit-dialog')).toBeVisible();
});

When('I assign the seeded base role', async ({ page }) => {
  const { assignableRole } = rbacWorld().fixtures;
  await page.getByTestId('role-edit-base').selectOption(assignableRole);
  await page.getByTestId('role-edit-save').click();
  await expect(page.getByTestId('role-edit-dialog')).toHaveCount(0);
});

Then('the team grid shows the member with that role', async ({ page }) => {
  const { matching, assignableRole } = rbacWorld().fixtures;
  const row = page.getByTestId(TEAM_GRID).getByRole('row', { name: new RegExp(matching.label) });
  await expect(row.getByText(assignableRole)).toBeVisible();
});

When('I start composing a new role', async ({ page }) => {
  await page.getByTestId('roles-new').click();
});

Then('the role form dialog is open', async ({ page }) => {
  await expect(page.getByTestId('role-form-dialog')).toBeVisible();
});

When('I dismiss the role form', async ({ page }) => {
  await page.getByTestId('role-form-cancel').click();
});

Then('the role form dialog is closed', async ({ page }) => {
  await expect(page.getByTestId('role-form-dialog')).toHaveCount(0);
});
