import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/entity-lifecycle` mounted the way a host mounts it (12-17): one
 * call to `createWebEntityLifecycle({ apiBase })` for the packaged Lixeira +
 * Aprovações page, and the packaged `VersionHistoryDialog` / `DraftBanner`
 * dropped into the host's own demo editor — driving the published package's
 * GENERATED endpoints over a real Postgres through the Vite proxy, as the
 * seeded OWNER.
 *
 * The cases are the port of the origin host's `recycle-bin.e2e.ts` (the delete →
 * Lixeira → restore round trip, the FUT-546 type-to-confirm purge) and
 * `approvals.e2e.ts` (the status chips, the decision flows), plus the
 * history-dialog and draft-banner flows their admin suites covered — with
 * the same test ids, which is what proves the ids survived the move.
 */

test.beforeEach(async ({ request }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked reset would restore a
     database nothing under test is reading (same rationale as
     rbac-admin.spec.ts beside this file). */
  const response = await request.post('/__harness/reset');
  expect(response.status()).toBe(204);
});

async function openPage(page: Page): Promise<void> {
  await page.goto('#/lifecycle-admin');
  await expect(page.getByTestId('demo-items')).toBeVisible();
}

/**
 * The packaged screens fetch on MOUNT (exactly like the origin host pages,
 * which an operator reaches by navigating). This page mounts them beside the
 * host's list, so a spec that mutates on one side re-loads the document where
 * the origin host spec navigated between pages.
 */
async function reloadPage(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId('demo-items')).toBeVisible();
}

async function openBin(page: Page): Promise<void> {
  await page.getByTestId('lifecycle-tab-recycle-bin').click();
}

test.describe('Lixeira (port of recycle-bin.e2e.ts)', () => {
  test('renders the bin (list or empty state), never a crash page', async ({ page }) => {
    await openPage(page);
    await openBin(page);
    await expect(
      page.getByTestId('recycle-bin-list').or(page.getByTestId('recycle-bin-empty')),
    ).toBeVisible();
  });

  test('an item deleted from the list comes back from the Lixeira', async ({ page }) => {
    await openPage(page);

    // Delete the seeded item from the host's own list…
    await page.getByTestId('demo-item-delete-prod-agua').click();
    await expect(page.getByTestId('demo-outcome')).toContainText('lixeira');
    await expect(page.getByTestId('demo-item-prod-agua')).toHaveCount(0);

    // …find it in the packaged bin, with the KIND chip, and restore it.
    await reloadPage(page);
    await openBin(page);
    const entry = page
      .locator('[data-testid^="recycle-bin-entry-"]')
      .filter({ hasText: 'Água com gás' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Produto');
    await entry.locator('[data-testid^="recycle-bin-restore-"]').click();
    await expect(entry).toHaveCount(0);

    // Back on the host list after a reload — the restore crossed the socket.
    await reloadPage(page);
    await expect(page.getByTestId('demo-item-prod-agua')).toBeVisible();
  });

  test('purging permanently is gated by typing the entry name (FUT-546)', async ({ page }) => {
    await openPage(page);
    await page.getByTestId('demo-item-delete-prod-suco').click();
    await expect(page.getByTestId('demo-outcome')).toContainText('lixeira');

    await reloadPage(page);
    await openBin(page);
    const entry = page
      .locator('[data-testid^="recycle-bin-entry-"]')
      .filter({ hasText: 'Suco de laranja' });
    await expect(entry).toBeVisible();
    await entry.locator('[data-testid^="recycle-bin-purge-"]').click();

    const confirm = page.getByTestId('recycle-bin-purge-confirm');
    await expect(confirm.getByTestId('recycle-bin-purge-confirm-description')).toContainText(
      'não pode ser desfeita',
    );
    // The confirm is disabled until the operator types the entry's own name.
    const confirmButton = confirm.getByTestId('recycle-bin-purge-confirm-confirm-button');
    await expect(confirmButton).toBeDisabled();
    await confirm
      .getByTestId('recycle-bin-purge-confirm-type-to-confirm')
      .fill('Suco de laranja');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(entry).toHaveCount(0);
    // Purged means GONE: a reload shows neither the item nor the bin entry.
    await reloadPage(page);
    await expect(page.getByTestId('demo-item-prod-suco')).toHaveCount(0);
    await openBin(page);
    await expect(page.getByTestId('recycle-bin-empty')).toBeVisible();
  });

  test('a second collection shows its own kind chip in the same bin', async ({ page, request }) => {
    // The supplier is deleted through the host's OTHER collection route —
    // the bin page must dispatch by the entry's own entity type.
    /* eslint-disable-next-line test-flakiness/no-unmocked-network --
       the unmocked network IS the subject: the delete must land in the same
       database the bin page reads (see the reset above). */
    const deleted = await request.delete('/api/admin/harness/demo-suppliers/sup-distribuidora');
    expect(deleted.status()).toBe(200);

    await openPage(page);
    await openBin(page);
    const entry = page
      .locator('[data-testid^="recycle-bin-entry-"]')
      .filter({ hasText: 'Distribuidora Aurora' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Fornecedor');
  });
});

test.describe('Histórico de versões (the packaged dialog in a host editor)', () => {
  test('edits record versions; restoring an old one brings the content back', async ({ page }) => {
    await openPage(page);

    // Two edits through the host form = v1 (adoption snapshot) + v2 (delta).
    await page.getByTestId('demo-item-edit-prod-agua').click();
    await page.getByTestId('demo-item-name').fill('Água com gás 500ml');
    await page.getByTestId('demo-item-save').click();
    await expect(page.getByTestId('demo-outcome')).toContainText('Item salvo.');

    await page.getByTestId('demo-item-edit-prod-agua').click();
    await page.getByTestId('demo-item-name').fill('Água com gás 1L');
    await page.getByTestId('demo-item-save').click();
    await expect(page.getByTestId('demo-outcome')).toContainText('Item salvo.');
    await expect(page.getByTestId('demo-item-prod-agua')).toContainText('Água com gás 1L');

    // The dialog lists newest first and marks the current version.
    await page.getByTestId('demo-item-history-prod-agua').click();
    await expect(page.getByTestId('version-history-dialog')).toBeVisible();
    await expect(page.getByTestId('version-row-2')).toContainText('Versão atual');
    await expect(page.getByTestId('version-row-1')).toBeVisible();

    // Restore v1 behind the confirm; the notice reports it and the list
    // refreshes to the restored content.
    await page.getByTestId('version-restore-1').click();
    await page.getByTestId('version-restore-confirm-confirm-button').click();
    await expect(page.getByTestId('version-history-notice')).toContainText('v1 restaurada');
    await expect(page.getByTestId('version-row-3')).toContainText('Versão atual');

    await page.getByTestId('version-history-dialog-close').click();
    await expect(page.getByTestId('demo-item-prod-agua')).toContainText('Água com gás 500ml');
  });
});

test.describe('Rascunhos (the packaged banner in a host editor)', () => {
  test('saving a draft leaves the live item alone until Publicar', async ({ page }) => {
    await openPage(page);

    await page.getByTestId('demo-item-edit-prod-agua').click();
    await page.getByTestId('demo-item-name').fill('Água tônica');
    await page.getByTestId('demo-item-save-draft').click();

    // The banner appears; the live row is untouched.
    await expect(page.getByTestId('draft-banner')).toBeVisible();
    await expect(page.getByTestId('demo-item-prod-agua')).toContainText('Água com gás');

    await page.getByTestId('draft-publish').click();
    await expect(page.getByTestId('demo-outcome')).toContainText('Rascunho publicado.');
    await expect(page.getByTestId('demo-item-prod-agua')).toContainText('Água tônica');
  });

  test('descartar keeps the live item and removes the banner', async ({ page }) => {
    await openPage(page);

    await page.getByTestId('demo-item-edit-prod-agua').click();
    await page.getByTestId('demo-item-name').fill('Água descartada');
    await page.getByTestId('demo-item-save-draft').click();
    await expect(page.getByTestId('draft-banner')).toBeVisible();

    await page.getByTestId('draft-discard').click();
    await expect(page.getByTestId('draft-banner')).toHaveCount(0);
    await page.getByTestId('demo-item-close').click();
    await expect(page.getByTestId('demo-item-prod-agua')).toContainText('Água com gás');
  });
});

test.describe('Aprovações (port of approvals.e2e.ts)', () => {
  async function openApprovals(page: Page): Promise<void> {
    await openPage(page);
    await page.getByTestId('lifecycle-tab-approvals').click();
    await expect(page.getByTestId('approvals-status-filter')).toBeVisible();
  }

  test('renders the inbox shell with Pendentes as the landing filter', async ({ page }) => {
    await openApprovals(page);
    await expect(page.getByTestId('approvals-filter-PENDING')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('approvals-filter-APPROVED')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('picking a status chip moves the selection and reloads that list', async ({ page }) => {
    await openApprovals(page);

    const pending = page.getByTestId('approvals-filter-PENDING');
    const approved = page.getByTestId('approvals-filter-APPROVED');
    const rejected = page.getByTestId('approvals-filter-REJECTED');

    await approved.click();
    await expect(approved).toHaveAttribute('aria-selected', 'true');
    await expect(pending).toHaveAttribute('aria-selected', 'false');
    // The click drives the QUERY, not just the chip styling — the per-status
    // empty copy would still read "pendente" if `status` had not moved.
    await expect(page.getByTestId('approvals-empty')).toContainText(
      'Nenhuma solicitação aprovada.',
    );

    await rejected.click();
    await expect(rejected).toHaveAttribute('aria-selected', 'true');
    await expect(approved).toHaveAttribute('aria-selected', 'false');
  });

  test("an editor's parked write is approved from the inbox and applies", async ({
    page,
    request,
  }) => {
    // The park comes from the EDITOR's vantage (the actor header the host
    // seam reads); the page then decides it as the default OWNER.
    /* eslint-disable-next-line test-flakiness/no-unmocked-network --
       the park must come from the EDITOR's vantage against the real mount;
       a mocked 202 would leave nothing for the inbox to decide. */
    const parked = await request.put('/api/admin/harness/catalog-items/prod-agua', {
      headers: { 'x-lifecycle-user': 'editor-1' },
      data: { name: 'Água do editor', priceCents: 999 },
    });
    expect(parked.status()).toBe(202);

    await openApprovals(page);
    const card = page
      .locator('[data-testid^="approval-request-"]')
      .filter({ hasText: 'Água do editor' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Alteração');
    await expect(card).toContainText('Eduardo Editor');

    await card.locator('[data-testid^="approval-approve-"]').click();
    await expect(card).toHaveCount(0);

    // The parked write is now live on the host's own list.
    await reloadPage(page);
    await expect(page.getByTestId('demo-item-prod-agua')).toContainText('Água do editor');
  });

  test('rejecting with a note keeps the record and files the decision', async ({
    page,
    request,
  }) => {
    /* eslint-disable-next-line test-flakiness/no-unmocked-network -- see the
       approve case above: the park must cross the real mount as the editor. */
    const parked = await request.put('/api/admin/harness/catalog-items/prod-agua', {
      headers: { 'x-lifecycle-user': 'editor-1' },
      data: { name: 'Água rejeitada', priceCents: 1 },
    });
    expect(parked.status()).toBe(202);

    await openApprovals(page);
    const card = page
      .locator('[data-testid^="approval-request-"]')
      .filter({ hasText: 'Água rejeitada' });
    await card.getByRole('button', { name: 'Rejeitar' }).click();

    const dialog = page.getByTestId('approval-reject-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('approval-reject-note').fill('preço errado');
    await dialog.getByTestId('approval-reject-confirm').click();
    await expect(card).toHaveCount(0);

    // The decided list carries the note; the live item never changed.
    await page.getByTestId('approvals-filter-REJECTED').click();
    const rejected = page
      .locator('[data-testid^="approval-request-"]')
      .filter({ hasText: 'Água rejeitada' });
    await expect(rejected).toContainText('preço errado');

    await reloadPage(page);
    await expect(page.getByTestId('demo-item-prod-agua')).toContainText('Água com gás');
  });
});
