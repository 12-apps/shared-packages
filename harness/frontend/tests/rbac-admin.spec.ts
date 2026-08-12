import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * `@12-apps/rbac` mounted the way a host mounts it (12-13): one call to
 * `createWebRbac({ apiBase })`, no route table, no screen imported by name —
 * driving the published package's own Hono router over a real Postgres
 * through the Vite proxy, as the seeded OWNER.
 *
 * The cases are the port of future-pay's `roles.e2e.ts`, `team.e2e.ts` and
 * `team-roles.e2e.ts` (FUT-146): the same test ids, the same affordances, the
 * same restore discipline — plus the write path the future-pay specs left
 * read-only, which THIS harness may exercise because the reset below owns the
 * database.
 */

test.beforeEach(async ({ request }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked reset would restore a
     database nothing under test is reading (same rationale as
     report-builder.spec.ts beside this file). */
  const response = await request.post('/__harness/reset');
  expect(response.status()).toBe(204);
});

async function openRoles(page: Page): Promise<void> {
  await page.goto('#/rbac-admin');
  await expect(page.getByTestId('roles-grid')).toBeVisible();
}

async function openTeam(page: Page): Promise<void> {
  await page.goto('#/rbac-admin');
  await page.getByTestId('rbac-tab-team').click();
  await expect(page.getByTestId('team-grid')).toBeVisible();
}

test.describe('Roles admin (port of roles.e2e.ts)', () => {
  test('renders the roles catalog grid', async ({ page }) => {
    await openRoles(page);

    await expect(page.getByRole('heading', { name: 'Papéis' })).toBeVisible();
    // Seeded SYSTEM templates and the two seeded custom roles, side by side.
    await expect(page.getByTestId('roles-grid').getByText('Barista')).toBeVisible();
    await expect(page.getByTestId('roles-grid').getByText('Estoquista')).toBeVisible();
  });

  test('searching the catalog narrows it through the backend', async ({ page }) => {
    await openRoles(page);

    // The inline keyword box commits on Enter; the grid re-fetches from the
    // backend with `q=` (the future-pay spec proved the same via the URL — the
    // packaged screen owns its state, so the proof here is the narrowed grid).
    const searchBox = page.getByTestId('roles-search-all');
    await searchBox.fill('Barista');
    await searchBox.press('Enter');

    await expect(searchBox).toHaveValue('Barista');
    await expect(page.getByTestId('roles-grid').getByText('Barista')).toBeVisible();
    await expect(page.getByTestId('roles-grid').getByText('Estoquista')).toHaveCount(0);
  });

  test('composes a role in the "Novo papel" dialog and dismisses it with Cancelar', async ({
    page,
  }) => {
    await openRoles(page);

    await page.getByTestId('add-role-button').click();

    const dialog = page.getByTestId('role-dialog');
    await expect(dialog.getByTestId('role-form')).toBeVisible();
    // "Criar papel" only unlocks with a name AND at least one permission.
    await expect(dialog.getByTestId('role-submit')).toBeDisabled();

    const nameField = dialog.getByTestId('role-name');
    await nameField.fill('Papel E2E rascunho');
    await expect(nameField).toHaveValue('Papel E2E rascunho');
    await expect(dialog.getByTestId('role-submit')).toBeDisabled();

    // `stock:read` is a plain class permission — no owner-marker, no SoD
    // counterpart — so its checkbox is always togglable on a fresh form.
    const stockRead = dialog.getByTestId('perm-stock:read');
    await stockRead.click();
    await expect(stockRead.locator('input')).toBeChecked();
    await expect(dialog).toContainText('Permissões (1 selecionada)');
    await expect(dialog.getByTestId('role-submit')).toBeEnabled();

    await dialog.getByTestId('role-cancel').click();
    await expect(page.getByTestId('role-form')).toHaveCount(0);
  });

  test('creates a custom role through the real mount and lists it', async ({ page }) => {
    await openRoles(page);

    await page.getByTestId('add-role-button').click();
    const dialog = page.getByTestId('role-dialog');
    await dialog.getByTestId('role-name').fill('Papel do Harness');
    await dialog.getByTestId('perm-stock:read').click();
    await dialog.getByTestId('role-submit').click();

    // The write crossed the socket and came back through the list read.
    await expect(page.getByTestId('roles-grid').getByText('Papel do Harness')).toBeVisible();
  });
});

test.describe('Team admin (port of team.e2e.ts)', () => {
  test('renders the team roster grid', async ({ page }) => {
    await openTeam(page);

    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
    await expect(page.getByTestId('team-grid').getByText('Camila Barbosa')).toBeVisible();
  });

  test('searching the roster narrows it through the directory seam', async ({ page }) => {
    await openTeam(page);

    const searchBox = page.getByTestId('team-search-all');
    await searchBox.fill('Camila');
    await searchBox.press('Enter');

    await expect(searchBox).toHaveValue('Camila');
    // The backend `q` matches name OR e-mail via the host's directory port.
    await expect(page.getByTestId('team-grid').getByText('Camila Barbosa')).toBeVisible();
    await expect(page.getByTestId('team-grid').getByText('Bruno Carvalho')).toHaveCount(0);
  });
});

// System roles by their pt-BR checkbox labels — targeted by ACCESSIBLE NAME,
// not testid: a tenant custom role may share a system role's raw NAME, never
// its translated label (the future-pay spec's own rationale).
const SYSTEM_ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  WAITER: 'Garçom',
  CHEF: 'Cozinheiro',
  FINANCIAL: 'Financeiro',
  BUYER: 'Comprador',
};

/** Set exactly `role` as the single checked system role in the open dialog. */
async function checkOnlyRole(dialog: Locator, role: string): Promise<void> {
  for (const [name, label] of Object.entries(SYSTEM_ROLE_LABELS)) {
    const checkbox = dialog.getByRole('checkbox', { name: label, exact: true });
    if ((await checkbox.count()) === 0) continue;
    await checkbox.setChecked(name === role);
  }
}

/** Open the role-edit dialog for the target member from the roster kebab. */
async function openRoleDialog(page: Page): Promise<Locator> {
  await page.getByTestId('team-actions-role-target').click();
  await page.getByRole('menuitem', { name: 'Editar papéis' }).click();
  return page.getByTestId('role-edit-dialog');
}

test.describe('Team role assignment (port of team-roles.e2e.ts)', () => {
  test('owner reassigns a member base role from the roster', async ({ page }) => {
    await openTeam(page);
    const searchBox = page.getByTestId('team-search-all');
    await searchBox.fill('Role Target');
    await searchBox.press('Enter');
    await expect(page.getByTestId('team-grid').getByText('Role Target')).toBeVisible();
    const row = page.getByTestId('team-grid').locator('tr', { hasText: 'Role Target' });

    // CHEF (Cozinheiro) → MANAGER (Gerente): the roster row reflects the save.
    const dialog = await openRoleDialog(page);
    await expect(dialog).toBeVisible();
    await checkOnlyRole(dialog, 'MANAGER');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText('Gerente')).toBeVisible();

    // Restore CHEF so retries never see a drifted roster (the reset would fix
    // it anyway; the restore keeps the spec honest about its own writes).
    const restoreDialog = await openRoleDialog(page);
    await expect(restoreDialog).toBeVisible();
    await checkOnlyRole(restoreDialog, 'CHEF');
    await restoreDialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(restoreDialog).toHaveCount(0);
    await expect(row.getByText('Cozinheiro')).toBeVisible();
  });

  test('grants and revokes an additive custom role from the dialog', async ({ page }) => {
    await openTeam(page);
    const row = page.getByTestId('team-grid').locator('tr', { hasText: 'Role Target' });

    // Grant: base CHEF stays, Barista rides along as a chip.
    const dialog = await openRoleDialog(page);
    await dialog.getByTestId('role-opt-Barista').click();
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText('Barista')).toBeVisible();
    await expect(row.getByText('Cozinheiro')).toBeVisible();

    // Revoke: unchecking diffs back through the DELETE endpoint.
    const second = await openRoleDialog(page);
    await second.getByTestId('role-opt-Barista').click();
    await second.getByRole('button', { name: 'Salvar' }).click();
    await expect(second).toHaveCount(0);
    await expect(row.getByText('Barista')).toHaveCount(0);
  });

  test('the dialog blocks a save without exactly one system role', async ({ page }) => {
    await openTeam(page);
    const dialog = await openRoleDialog(page);
    // Unchecking the member's own base role leaves zero system roles.
    await checkOnlyRole(dialog, 'NONE');
    await expect(dialog.getByTestId('role-edit-invalid')).toBeVisible();
    await expect(dialog.getByTestId('role-edit-save')).toBeDisabled();
  });
});
