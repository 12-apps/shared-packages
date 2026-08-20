import { expect, type Locator, type Page } from "@playwright/test";

import { featureFlagsWorld } from "../world.js";
import { Given, Then, When } from "./fixtures.js";

/**
 * The step definitions behind `features/*.feature`. Every locator here is a
 * test id or data attribute this package's own screen renders, so the steps
 * mean the same thing in any host that mounts `createWebFeatureFlags`; every
 * name a scenario speaks (which betas, whose emails) comes from the host's
 * installed world.
 */

function flagTile(page: Page, key: string): Locator {
  return page.getByTestId(`ff-flag-${key}`);
}

function grantRow(page: Page, userId: string): Locator {
  return page.getByTestId(`ff-grant-${userId}`);
}

async function enroll(page: Page, email: string): Promise<void> {
  await page.getByTestId("ff-add-email").fill(email);
  await page.getByTestId("ff-add-submit").click();
}

Given("the beta catalog is open", async ({ page }) => {
  const world = featureFlagsWorld();
  await world.reset(page);
  await world.openFlags(page);
});

When("the operator opens the seeded beta", async ({ page, journey }) => {
  const { seededFlag } = featureFlagsWorld().fixtures;
  await flagTile(page, seededFlag.key).click();
  journey.open(seededFlag.key);
});

When("the operator opens the empty beta", async ({ page, journey }) => {
  const { emptyFlag } = featureFlagsWorld().fixtures;
  await flagTile(page, emptyFlag.key).click();
  journey.open(emptyFlag.key);
});

When("she enrolls the new tester by email", async ({ page }) => {
  await enroll(page, featureFlagsWorld().fixtures.newTester.email);
});

When("she tries to enroll an email the host does not know", async ({ page }) => {
  await enroll(page, featureFlagsWorld().fixtures.strangerEmail);
});

When("she pauses the seeded tester", async ({ page }) => {
  const { seededTester } = featureFlagsWorld().fixtures;
  await page.getByTestId(`ff-toggle-${seededTester.userId}`).click();
});

When("she revokes the seeded tester", async ({ page }) => {
  const { seededTester } = featureFlagsWorld().fixtures;
  await page.getByTestId(`ff-revoke-${seededTester.userId}`).click();
});

Then("the new tester is in the cohort, enabled", async ({ page }) => {
  const row = grantRow(page, featureFlagsWorld().fixtures.newTester.userId);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-enabled", "true");
});

Then("the seeded tester is in the cohort, enabled", async ({ page }) => {
  const row = grantRow(page, featureFlagsWorld().fixtures.seededTester.userId);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-enabled", "true");
});

Then("the seeded tester is still in the cohort, disabled", async ({ page }) => {
  const row = grantRow(page, featureFlagsWorld().fixtures.seededTester.userId);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-enabled", "false");
});

Then("the seeded tester is out of the cohort", async ({ page }) => {
  await expect(grantRow(page, featureFlagsWorld().fixtures.seededTester.userId)).toHaveCount(0);
});

Then("the enrollment is stamped with the operator's identity", async ({ page }) => {
  const { newTester, operatorEmail } = featureFlagsWorld().fixtures;
  await expect(grantRow(page, newTester.userId)).toContainText(operatorEmail);
});

Then(
  "that beta tallies {int} enabled of {int} enrolled",
  async ({ page, journey }, enabled: number, total: number) => {
    // The machine-readable tally the tile carries beside its copy — the copy
    // is the host's to override, the numbers are not.
    const tile = flagTile(page, journey.openKey);
    await expect(tile).toHaveAttribute("data-enabled-count", String(enabled));
    await expect(tile).toHaveAttribute("data-grant-count", String(total));
  },
);

Then("the surface refuses with the server's own words", async ({ page }) => {
  const refusal = page.getByTestId("ff-error");
  await expect(refusal).toBeVisible();
  // The words are the server's (pt-BR in the package's defaults) — what this
  // pins is that they REACHED the operator, not which language they are in.
  await expect(refusal).not.toBeEmpty();
});
