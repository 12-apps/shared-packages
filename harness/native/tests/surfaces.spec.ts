import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * WHAT THE BROWSER PAINTED, IN NUMBERS — the surfaces batch.
 *
 * Read off the react-native-web render of the PUBLISHED native build and
 * compared with the tables the web MUI build reads (`Card.metrics.ts`,
 * `Dialog.metrics.ts`). The radius and max-width scales are spacing units and
 * absolute px respectively, so both renderers land on the same box.
 */

/** `CARD_RADIUS_UNITS` at the theme's 8px spacing unit. */
const CARD_RADII = { none: 0, sm: 4, md: 8, lg: 16, xl: 24 } as const;

/** `DIALOG_MAX_WIDTH`, in px, the same on both renderers. */
const DIALOG_MAX_WIDTHS = { xs: 400, sm: 600, md: 800, lg: 1000, xl: 1200 } as const;

const px = async (locator: Locator, property: string): Promise<number> =>
  Number.parseFloat(await locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property));

async function openGallery(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('gallery')).toBeVisible();
}

test.describe('the surface components of the native build', () => {
  test('renders both surface sections', async ({ page }) => {
    await openGallery(page);
    for (const section of ['section-card', 'section-dialog']) {
      await expect(page.getByTestId(section)).toBeVisible();
    }
    await page.getByTestId('section-card').screenshot({ path: 'test-results/surfaces-card.png' });
  });

  test('Card rounds on the shared unit scale and outlines at a hairline', async ({ page }) => {
    await openGallery(page);
    for (const [radius, value] of Object.entries(CARD_RADII)) {
      expect(await px(page.getByTestId(`card-radius-${radius}`), 'border-top-left-radius'), radius).toBe(value);
    }
    await expect(page.getByTestId('card-variant-outlined')).toHaveCSS('border-top-width', '1px');
  });

  test('Card lays out its header, content and actions', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('card-full-header-title')).toHaveText('Pedido #1042');
    await expect(page.getByTestId('card-full-header-subtitle')).toHaveText('Entregue às 19:32');
    await expect(page.getByTestId('card-full-content')).toContainText('Três itens');
    await expect(page.getByTestId('card-loading-loading')).toBeVisible();
  });

  test('an interactive Card answers a press and an expandable one toggles', async ({ page }) => {
    await openGallery(page);
    const counter = page.getByTestId('button-counter-value');
    const before = await counter.textContent();
    await page.getByTestId('card-interactive').click();
    await expect(counter).not.toHaveText(before ?? '');
    // `expandable`/`expanded`/`onExpandToggle` are accepted and IGNORED by both
    // renderers — the web destructures them into `_`-prefixed bindings too — so
    // the card stays shut on either side. Pinned so a web implementation that
    // lands later cannot quietly leave the native half behind.
    await expect(page.getByTestId('card-expandable-body')).toHaveText('Fechado');
    await page.getByTestId('card-expandable').click();
    await expect(page.getByTestId('card-expandable-body')).toHaveText('Fechado');
  });

  test('Dialog opens, names itself, and closes from its own button', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('dialog-default')).toHaveCount(0);
    await page.getByTestId('open-dialog-default').click();
    await expect(page.getByTestId('dialog-default')).toBeVisible();
    // The role sits on React Native's own `Modal`, not on the paper the test id
    // names — the web puts it on MUI's paper. Both announce one dialog.
    await expect(page.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    // The `-title` slot is the header row: the title and its subtitle both sit
    // inside it, on either renderer.
    await expect(page.getByTestId('dialog-default-title')).toContainText('Diálogo default');
    await expect(page.getByTestId('dialog-default-title')).toContainText('Uma pergunta');
    await page.getByTestId('dialog-default-cancel').click();
    await expect(page.getByTestId('dialog-default')).toHaveCount(0);
  });

  test('Dialog bounds its paper at each size', async ({ page }) => {
    await openGallery(page);
    for (const [size, maxWidth] of Object.entries(DIALOG_MAX_WIDTHS)) {
      await page.getByTestId(`open-dialog-size-${size}`).click();
      const paper = page.getByTestId(`dialog-size-${size}`);
      await expect(paper).toBeVisible();
      expect(await px(paper, 'max-width'), size).toBe(maxWidth);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(`dialog-size-${size}`)).toHaveCount(0);
    }
  });

  test('a persistent Dialog refuses the escape key', async ({ page }) => {
    await openGallery(page);
    await page.getByTestId('open-dialog-persistent').click();
    await expect(page.getByTestId('dialog-persistent')).toBeVisible();
    await page.keyboard.press('Escape');
    // Still there: `persistent` is the web's own refusal, kept on native.
    await expect(page.getByTestId('dialog-persistent')).toBeVisible();
  });
});
