import { expect, type Page } from '@playwright/test';

import {
  BLOCK_RENDER_TIMEOUT_MS,
  NEW_BLOCK,
  openEditorOfPublishedReport,
  openPublishedReport,
  openReportId,
  reportsList,
  templateId,
} from '../helpers/surface.js';
import { reportsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * The report AUTHOR's journeys: composing a report from a template, and the
 * working copy that keeps an edit safe without showing it to anybody
 * (FUT-755).
 *
 * Nothing here is stubbed. The host's reports surface talks to the host's real
 * server, so a name that survives a brand-new browser session survives it
 * because the SERVER kept it — which is the only version of that claim worth
 * making, and the one an in-page fake cannot make at all.
 *
 * The steps are written in the third person with an unbound pronoun — "she",
 * "he", "they" — so a scenario reads as prose about the author it named. The
 * pronoun carries no meaning to the matcher; it is alternation in the pattern.
 */

/** Pronoun alternation, so one definition serves every scenario's author. */
const THEY = '(?:she|he|they)';

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

/**
 * Back to the seeded documents, and onto the list.
 *
 * Every feature opens with this, because these journeys WRITE — one publishes a
 * new report, another parks a working copy against a published one — and a
 * suite whose second run starts from the first run's leftovers passes exactly
 * once.
 */
Given("the reports area is open on the store's saved reports", async ({ page }) => {
  await reportsWorld().reset(page);
  await reportsWorld().openReports(page);
  await expect(reportsList(page)).toBeVisible();
});

Given(
  new RegExp(`^${THEY} is reading the report published to (?:her|his|their) team$`),
  async ({ page }) => {
    await openPublishedReport(page);
  },
);

// ---------------------------------------------------------------------------
// When — composing a report
// ---------------------------------------------------------------------------

/** The list's own way in to a blank report. */
async function startNewReport(page: Page): Promise<void> {
  await page.getByTestId('reports-new').click();
  await expect(page.getByTestId('page-report-editor')).toBeVisible();
}

/** One template out of the picker, waited on until its block exists. */
async function pickTemplate(page: Page, title: string, position = 1): Promise<void> {
  await page.getByTestId(`block-template-picker-${templateId(title)}`).click();
  await expect(page.getByTestId(`report-block-bloco-${position}`)).toBeVisible({
    timeout: BLOCK_RENDER_TIMEOUT_MS,
  });
}

When(new RegExp(`^${THEY} starts a new report$`), async ({ page }) => {
  await startNewReport(page);
});

// The template TITLES come from the host's fixtures, not from the feature: a
// picker's entries are the host's product, and a scenario that named one would
// only run in the store that has it.
When(new RegExp(`^${THEY} picks the first block template$`), async ({ page }) => {
  await pickTemplate(page, reportsWorld().fixtures.blockTemplates.first);
});

When(new RegExp(`^${THEY} adds a second block template beside it$`), async ({ page }) => {
  await page.getByTestId('report-editor-add-block').click();
  await pickTemplate(page, reportsWorld().fixtures.blockTemplates.second, 2);
});

When(new RegExp(`^${THEY} calls it "(.+)"$`), async ({ page }, name: string) => {
  await page.getByTestId('report-editor-name').fill(name);
});

/**
 * The deliberate act: two choices in *Ajustes*, then Salvar.
 *
 * Publishing is not a toggle on the canvas, and driving it the long way round
 * is the point — a report goes live only by opening its settings and choosing
 * both a status and an audience, which is what makes it something nobody does
 * by accident while typing into an autosaving editor.
 */
When(new RegExp(`^${THEY} publishes it to the whole team$`), async ({ page, journey }) => {
  await page.getByTestId('report-editor-settings').click();
  await page.getByTestId('report-settings-status-published').click();
  await page.getByTestId('report-settings-visibility-tenant').click();
  await page.getByTestId('report-settings-done').click();
  await page.getByTestId('report-editor-save').click();
  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: BLOCK_RENDER_TIMEOUT_MS });
  // The saved report's own id, read off the address bar the surface just wrote
  // — so the Then that goes looking for its card names the row exactly rather
  // than hunting for one whose text happens to match.
  journey.opened(openReportId(page));
});

When(new RegExp(`^${THEY} goes back to the list$`), async ({ page }) => {
  await page.getByTestId('report-back').click();
  await expect(reportsList(page)).toBeVisible();
});

// ---------------------------------------------------------------------------
// When — the parked edit
// ---------------------------------------------------------------------------

When(new RegExp(`^${THEY} opens the published team report to edit it$`), async ({ page }) => {
  await openEditorOfPublishedReport(page);
});

When(new RegExp(`^${THEY} renames it to "(.+)"$`), async ({ page, journey }, name: string) => {
  await journey.screen(page).getByTestId('report-editor-name').fill(name);
});

/**
 * A brand-new browser session — no cookies, no storage, nothing this scenario
 * has already loaded — pointed back at the same report's editor.
 *
 * The host builds the session, because it decides what one IS: a fresh context
 * here, a second sign-in in an app behind a login. Everything after this reads
 * `journey.screen(...)`, so the rest of the scenario carries on talking about
 * "the editor" without knowing a second browser exists.
 */
When(
  new RegExp(`^${THEY} comes back to the report in a brand-new session$`),
  async ({ browser, page, journey }) => {
    const fresh = await reportsWorld().openInNewSession(browser, page);
    journey.useSession(fresh);
    await openEditorOfPublishedReport(fresh);
  },
);

When(new RegExp(`^${THEY} leaves the editor$`), async ({ page }) => {
  await page.getByTestId('report-editor-back').click();
});

When(new RegExp(`^${THEY} confirms that ${THEY} does$`), async ({ page }) => {
  await page
    .getByTestId('report-editor-exit-confirm')
    .getByRole('button', { name: 'Sair sem publicar' })
    .click();
  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: BLOCK_RENDER_TIMEOUT_MS });
});

When(new RegExp(`^${THEY} opens the report and saves the parked changes$`), async ({ page }) => {
  await openEditorOfPublishedReport(page);
  await page.getByTestId('report-editor-save').click();
  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: BLOCK_RENDER_TIMEOUT_MS });
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the block draws its figures', async ({ page }) => {
  await expect(page.getByTestId(`report-block-${NEW_BLOCK}-render`)).toBeVisible({
    timeout: BLOCK_RENDER_TIMEOUT_MS,
  });
  // A spec the host's catalog cannot serve surfaces as the block's own error
  // alert, which from a distance looks exactly like a block still loading.
  await expect(page.getByTestId(`report-block-${NEW_BLOCK}-error`)).toHaveCount(0);
});

Then('the report holds two blocks, and both draw their figures', async ({ page }) => {
  await expect(page.locator('[data-report-block-id]')).toHaveCount(2);
  // Both RAN: a block whose spec the catalog cannot serve renders an error
  // alert where its rendering would be, and still counts as a block.
  await expect(page.locator('[data-report-block-id] [data-testid$="-render"]')).toHaveCount(2, {
    timeout: BLOCK_RENDER_TIMEOUT_MS,
  });
  await expect(page.locator('[data-report-block-id] [data-testid$="-error"]')).toHaveCount(0);
});

Then(new RegExp(`^the report is a draft only ${THEY} can see$`), async ({ page }) => {
  await expect(page.getByTestId('report-editor-status-chip')).toHaveText('Rascunho');
  await expect(page.getByTestId('report-editor-subtitle')).toContainText('só você');
});

Then('{string} is there for the team, no longer a draft', async ({ page, journey }, name: string) => {
  const card = reportsList(page).getByTestId(`reports-card-${journey.reportId}`);
  await expect(card).toContainText(name);
  await expect(card).toContainText('Toda a equipe');
  await expect(card).not.toContainText('Rascunho');
});

Then(
  '{string} is there for the team, described as two blocks',
  async ({ page, journey }, name: string) => {
    const card = reportsList(page).getByTestId(`reports-card-${journey.reportId}`);
    await expect(card).toContainText(name);
    await expect(card).toContainText('2 blocos');
  },
);

Then('the editor says the changes have not been published', async ({ page, journey }) => {
  // Autosave is debounced, so this is the assertion that WAITS for the round
  // trip: the strip appears only once the server is holding the parked copy.
  const strip = journey.screen(page).getByTestId('report-editor-unpublished');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('continua vendo a versão publicada');
});

Then('the editor still holds {string}', async ({ page, journey }, name: string) => {
  await expect(journey.screen(page).getByTestId('report-editor-name')).toHaveValue(name);
});

/**
 * The same promise, asked from the other side.
 *
 * Walking out of an editor holding a parked edit is the one moment where the
 * author might reasonably think the store can already see it, so the editor
 * says which is true before letting them go — and says it about the READERS,
 * not about whether the work is saved, because the work is.
 */
Then(
  new RegExp(`^${THEY} is asked whether ${THEY} means to go without publishing$`),
  async ({ page }) => {
    const asked = page.getByTestId('report-editor-exit-confirm');
    await expect(asked).toBeVisible();
    await expect(asked).toContainText('continua vendo a versão publicada');
  },
);

Then('the list warns that the report is carrying unpublished changes', async ({ page }) => {
  await expect(publishedCard(page)).toContainText('Alterações não publicadas');
});

Then('the list no longer warns about unpublished changes', async ({ page }) => {
  await expect(publishedCard(page)).not.toContainText('Alterações não publicadas');
});

Then('the report still reads as it was last published', async ({ page }) => {
  await expect(page.getByTestId('report-title')).toHaveText(
    reportsWorld().fixtures.publishedReport.name,
  );
});

Then('the report now reads {string}', async ({ page }, name: string) => {
  await expect(page.getByTestId('report-title')).toHaveText(name);
});

/** The seeded published report's own card, by the id the host named. */
function publishedCard(page: Page): ReturnType<Page['getByTestId']> {
  return reportsList(page).getByTestId(
    `reports-card-${reportsWorld().fixtures.publishedReport.id}`,
  );
}
