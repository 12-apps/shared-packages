import { expect, type Page } from '@playwright/test';
import { defineImpersonationWorld } from '@12-apps/impersonation/e2e';

/**
 * THIS APP'S half of the packaged impersonation journeys.
 *
 * The scenarios and their steps ship inside `@12-apps/impersonation`; none of
 * them is copied here, and none of them knows what a harness page is. What is
 * host-specific is exactly what this file supplies: which URL the directory
 * lives at, where the "look as" picker is, how to get back to a state with no
 * session in force, and which of this app's own rows and sentences a scenario
 * may name.
 *
 * That is the integration a real consumer performs too — an admin app routes to
 * its own users screen where this routes to `#/impersonation`, and clears its
 * own session where this clears a cookie. The features do not change.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `defineImpersonationWorld` call below
 * lands in every worker before the first Given executes.
 */

/** The harness page that mounts the directory and the picker. */
const PAGE_URL = '#/impersonation';

/** Any other page in this app — the banner is in the shell, so it is on all of them. */
const OTHER_PAGE_URL = '#/rbac-admin';

async function openPage(page: Page): Promise<void> {
  await page.goto(PAGE_URL);
  await expect(page.getByTestId('impersonation-page')).toBeVisible();
}

/**
 * Pick one option out of a design-system `Select`.
 *
 * The click targets the COMBOBOX, never the wrapper the test id sits on: the
 * wrapper is never disabled, so a click on it "succeeds" while the control
 * underneath swallows it and the menu never opens.
 */
async function choose(page: Page, testId: string, optionName: string): Promise<void> {
  await page.getByTestId(testId).getByRole('combobox').click();
  await page.getByRole('option', { name: optionName }).click();
}

defineImpersonationWorld({
  /**
   * No session in force, and the seeded trail back to empty.
   *
   * Clearing the COOKIE is the load-bearing half and the reason this cannot be
   * `/__harness/reset` alone: a desk session is a cookie on the browser, so a
   * server reset would leave the previous scenario's session live in this
   * context — exactly the per-browser state that leaks into whatever runs next.
   */
  reset: async (page: Page) => {
    await page.context().clearCookies();
    const response = await page.request.post('/__harness/reset');
    expect(response.status()).toBe(204);
    await openPage(page);
  },

  openStartDialog: async (page, subject) => {
    await openPage(page);
    await page.getByTestId(`impersonate-${subject.id}`).click();
  },

  startRolePreview: async (page, roleName) => {
    await openPage(page);
    await choose(page, 'preview-role', roleName);
    await page.getByTestId('preview-role-start').click();
  },

  startMemberPreview: async (page, memberUserId) => {
    await openPage(page);
    // The picker is addressed by the row's LABEL, which is what a person reads;
    // the id below is what the world was asked for, and the two are paired in
    // `src/pages/impersonation.tsx`.
    const label = memberUserId === 'role-target' ? 'Role Target — staff' : memberUserId;
    await choose(page, 'preview-member', label);
    await page.getByTestId('preview-member-start').click();
  },

  openGuardedScreen: async (page: Page) => {
    await page.goto(OTHER_PAGE_URL);
    await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'rbac-admin');
  },

  /**
   * The facts the scenarios name out loud, all of them this app's own — the
   * roster in `harness/backend/src/rbac-host.ts`, the two system librarians in
   * `impersonation-host.ts`, and the sentences in
   * `src/impersonation/surface.ts`.
   *
   * The copy is repeated here rather than imported from the surface module for
   * one reason: it is what a PERSON sees, so a scenario that read it from the
   * same constant the screen renders would pass whatever that constant said.
   */
  fixtures: {
    target: { id: 'patron-1', email: 'lia@harness.dev', label: 'Lia Prado' },
    platformTarget: {
      id: 'system-2',
      email: 'system2@harness.dev',
      label: 'Robin Sistema',
    },
    tenant: { slug: 'harness', optionLabel: 'North Branch (/harness)' },
    previewRole: { name: 'CLERK', label: 'CLERK' },
    previewMember: {
      id: 'role-target',
      email: 'target@harness.dev',
      label: 'Role Target',
    },
    validReason: 'the borrower says their card will not scan at the gate',
    shortReason: 'card',
    copy: {
      tenantMissing: 'Choose the branch this session applies to.',
      reasonTooShort: 'at least 15 characters',
      platformTargetRefusal: 'A system librarian may not be opened from the desk',
      readOnly: 'Look only',
    },
  },
});
