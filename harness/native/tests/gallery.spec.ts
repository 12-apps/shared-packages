import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * WHAT THE BROWSER PAINTED, IN NUMBERS.
 *
 * These read computed styles and boxes off the react-native-web render of the
 * PUBLISHED native build and compare them with the same tables the web MUI
 * build derives its rem from (`Button.metrics.ts`, `Text.metrics.ts`, the
 * spacing unit). Same number on both sides is the pixel-alignment claim, made
 * against a real bundle rather than a jsdom.
 */
const BUTTON_SIZES = {
  xs: { paddingVertical: 2, paddingHorizontal: 8, fontSize: 12 },
  sm: { paddingVertical: 6, paddingHorizontal: 12, fontSize: 14 },
  md: { paddingVertical: 8, paddingHorizontal: 16, fontSize: 16 },
  lg: { paddingVertical: 10, paddingHorizontal: 20, fontSize: 18 },
  xl: { paddingVertical: 12, paddingHorizontal: 24, fontSize: 20 },
} as const;

const TEXT_SIZES = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20 } as const;

const PRIMARY = 'rgb(99, 102, 241)';

const px = async (locator: Locator, property: string): Promise<number> =>
  Number.parseFloat(await locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property));

async function openGallery(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('gallery')).toBeVisible();
}

test.describe('the native build of @12-apps/ui, bundled by Metro, rendered through react-native-web', () => {
  test('renders every section', async ({ page }) => {
    await openGallery(page);
    for (const section of ['section-text', 'section-button', 'section-layout', 'section-icon']) {
      await expect(page.getByTestId(section)).toBeVisible();
    }
    await page.screenshot({ path: 'test-results/gallery.png', fullPage: true });
  });

  test('Text paints the body scale at the shared sizes', async ({ page }) => {
    await openGallery(page);
    for (const [size, fontSize] of Object.entries(TEXT_SIZES)) {
      const text = page.getByTestId(`text-size-${size}`);
      expect(await px(text, 'font-size')).toBe(fontSize);
    }
    expect(await px(page.getByTestId('text-caption'), 'font-size')).toBe(12);
    expect(await px(page.getByTestId('text-code'), 'font-size')).toBe(14);
    await expect(page.getByTestId('text-heading')).toHaveCSS('font-weight', '600');
    await expect(page.getByTestId('text-color-danger')).toHaveCSS('color', 'rgb(211, 47, 47)');
    await expect(page.getByTestId('text-heading')).toHaveRole('heading');
  });

  test('Button pads and types each size like the web', async ({ page }) => {
    await openGallery(page);
    for (const [size, metrics] of Object.entries(BUTTON_SIZES)) {
      const button = page.getByTestId(`button-size-${size}`);
      expect(await px(button, 'padding-top')).toBe(metrics.paddingVertical);
      expect(await px(button, 'padding-left')).toBe(metrics.paddingHorizontal);
      // The label node is the one carrying the size's own text.
      expect(await px(button.getByText(size, { exact: true }), 'font-size')).toBe(metrics.fontSize);
    }
    await expect(page.getByTestId('button-size-md')).toHaveCSS('border-top-left-radius', '8px');
  });

  test('Button variants paint from the palette', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('button-variant-solid')).toHaveCSS('background-color', PRIMARY);
    await expect(page.getByTestId('button-variant-outline')).toHaveCSS('border-top-color', PRIMARY);
    await expect(page.getByTestId('button-variant-outline')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByTestId('button-color-danger')).toHaveCSS('background-color', 'rgb(211, 47, 47)');
    await expect(page.getByTestId('button-color-neutral')).toHaveCSS('background-color', 'rgb(97, 97, 97)');
    await expect(page.getByTestId('button-disabled')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.12)');
    await expect(page.getByTestId('button-disabled')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('button-loading')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('button-loading-loading')).toBeVisible();
    await expect(page.getByTestId('button-icon-left-icon')).toBeVisible();
    await expect(page.getByTestId('button-pulse-pulse')).toBeAttached();
    await page.getByTestId('section-button').screenshot({ path: 'test-results/buttons.png' });
  });

  test('an icon-only Button is square', async ({ page }) => {
    await openGallery(page);
    const box = await page.getByTestId('button-icon-only').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(Math.round(box!.height));
    expect(await px(page.getByTestId('button-icon-only'), 'padding-top')).toBe(7);
  });

  test('Button presses reach the handler through onClick', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('button-counter')).toHaveRole('button');
    await page.getByTestId('button-counter').click();
    await page.getByTestId('button-counter').click();
    await expect(page.getByTestId('button-counter-value')).toHaveText('Cliques: 2');
    await page.getByTestId('button-disabled').click({ force: true });
    await expect(page.getByTestId('button-counter-value')).toHaveText('Cliques: 2');
  });

  test('Box and Stack lay out on the spacing scale', async ({ page }) => {
    await openGallery(page);
    const bordered = page.getByTestId('box-bordered');
    expect(await px(bordered, 'padding-top')).toBe(16);
    await expect(bordered).toHaveCSS('border-top-width', '1px');
    await expect(bordered).toHaveCSS('border-top-left-radius', '4px');

    const row = page.getByTestId('stack-row');
    await expect(row).toHaveCSS('flex-direction', 'row');
    expect(await px(row, 'gap')).toBe(16);
    const one = await page.getByTestId('stack-cell-1').boundingBox();
    const two = await page.getByTestId('stack-cell-2').boundingBox();
    expect(Math.round(two!.x - (one!.x + one!.width))).toBe(16);
    await expect(page.getByTestId('stack-cell-1')).toHaveCSS('background-color', PRIMARY);
    await expect(page.getByTestId('stack-divider')).toHaveCount(2);
  });

  test('Icon draws the generated glyph at the scale sizes', async ({ page }) => {
    await openGallery(page);
    for (const [size, expected] of [['xs', 16], ['sm', 20], ['md', 24], ['lg', 32], ['xl', 40]] as const) {
      const box = await page.getByTestId(`icon-size-${size}`).boundingBox();
      expect(Math.round(box!.width)).toBe(expected);
    }
    await expect(page.getByTestId('icon-color-danger').locator('path')).toHaveAttribute('fill', '#d32f2f');
    await expect(page.getByTestId('icon-labelled')).toHaveAttribute('aria-label', 'Atenção');
    await expect(page.getByTestId('icon-size-md')).toHaveAttribute('aria-hidden', 'true');
  });

  test('Heading draws the type scale, one step per level', async ({ page }) => {
    await openGallery(page);
    // The scale both renderers read (HEADING_SCALE, in rem -> px).
    for (const [level, fontSize] of [
      ['display', 48],
      ['h1', 32],
      ['h2', 28],
      ['h3', 24],
      ['h4', 20],
      ['h5', 18],
      ['h6', 16],
    ] as const) {
      expect(await px(page.getByTestId(`heading-${level}`), 'font-size')).toBe(fontSize);
    }
    // react-native-web turns role="heading" + aria-level into real h1…h6 elements.
    await expect(page.getByTestId('heading-h2')).toHaveRole('heading');
    await expect(page.getByTestId('heading-color-danger')).toHaveCSS('color', 'rgb(211, 47, 47)');
    await expect(page.getByTestId('heading-weight-light')).toHaveCSS('font-weight', '300');
    await page.getByTestId('section-heading').screenshot({ path: 'test-results/headings.png' });
  });

  test('Paragraph paints its four variants', async ({ page }) => {
    await openGallery(page);
    expect(await px(page.getByTestId('paragraph-default'), 'font-size')).toBe(16);
    expect(await px(page.getByTestId('paragraph-lead'), 'font-size')).toBe(18);
    expect(await px(page.getByTestId('paragraph-small'), 'font-size')).toBe(14);
    await expect(page.getByTestId('paragraph-muted')).toHaveCSS('color', 'rgba(0, 0, 0, 0.6)');
    await expect(page.getByTestId('paragraph-color-info')).toHaveCSS('color', 'rgb(2, 136, 209)');
  });

  test('Spacer reserves the spacing scale between marks', async ({ page }) => {
    await openGallery(page);
    const gapAfter = async (size: string): Promise<number> => {
      const mark = await page.getByTestId(`spacer-mark-${size}`).boundingBox();
      const spacer = await page.getByTestId(`spacer-${size}`).boundingBox();
      expect(spacer!.y).toBeGreaterThanOrEqual(mark!.y + mark!.height - 1);
      return Math.round(spacer!.height);
    };
    // 0.5, 1, 2, 3, 4 spacing units.
    expect(await gapAfter('xs')).toBe(4);
    expect(await gapAfter('sm')).toBe(8);
    expect(await gapAfter('md')).toBe(16);
    expect(await gapAfter('lg')).toBe(24);
    expect(await gapAfter('xl')).toBe(32);
    const horizontal = await page.getByTestId('spacer-horizontal').boundingBox();
    expect(Math.round(horizontal!.width)).toBe(24);
  });

  test('Container bounds its width and pads on the scale', async ({ page }) => {
    await openGallery(page);
    expect(await px(page.getByTestId('container-sm'), 'padding-top')).toBe(24);
    expect(await px(page.getByTestId('container-fluid'), 'padding-top')).toBe(32);
    const sm = await page.getByTestId('container-sm').boundingBox();
    const fluid = await page.getByTestId('container-fluid').boundingBox();
    // The viewport is 420px, narrower than sm's 600px cap, so both fill it.
    expect(Math.round(sm!.width)).toBe(Math.round(fluid!.width));
  });

  test('Alert paints a severity per variant and dismisses', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('alert-info')).toBeVisible();
    await expect(page.getByTestId('alert-danger')).toBeVisible();
    await expect(page.getByTestId('alert-info')).toContainText('Alerta info');
    await expect(page.getByTestId('alert-described')).toContainText('A descrição fica abaixo do título.');
    // The severity icon is the generated glyph; suppressed when showIcon is false.
    await expect(page.getByTestId('alert-info').locator('svg')).toHaveCount(1);
    await expect(page.getByTestId('alert-no-icon').locator('svg')).toHaveCount(0);
    await expect(page.getByTestId('alert-custom-icon').locator('svg')).toHaveCount(1);
    const before = await page.getByTestId('button-counter-value').textContent();
    await page.getByTestId('alert-closable-close').click();
    await expect(page.getByTestId('alert-closable')).toHaveCount(0);
    expect(await page.getByTestId('button-counter-value').textContent()).not.toBe(before);
    await page.getByTestId('section-alert').screenshot({ path: 'test-results/alerts.png' });
  });

  test('LoadingState spins, labels and lays out skeleton rows', async ({ page }) => {
    await openGallery(page);
    // SPINNER_SIZES, measured on the spinner itself: the root carries a 200px
    // minimum height, so measuring it would pass whatever the spinner drew.
    for (const [size, diameter] of [['xs', 16], ['sm', 24], ['md', 40], ['lg', 56], ['xl', 64]] as const) {
      const box = await page.getByTestId(`loading-${size}-spinner`).boundingBox();
      expect(Math.round(box!.width)).toBe(diameter);
    }
    await expect(page.getByTestId('loading-message')).toContainText('Carregando pedidos…');
    await expect(page.getByTestId('loading-skeleton')).toBeVisible();
    // The root is the live region; the spinner inside it is the progressbar.
    await expect(page.getByTestId('loading-md')).toHaveRole('status');
    await expect(page.getByTestId('loading-md-spinner')).toHaveRole('progressbar');
    await page.getByTestId('section-loading').screenshot({ path: 'test-results/loading-states.png' });
  });

  test('ErrorState reports and retries', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('error-plain')).toContainText('Não foi possível carregar o cardápio.');
    await expect(page.getByTestId('error-retry')).toContainText('Falha na conexão');
    const before = await page.getByTestId('button-counter-value').textContent();
    await page.getByTestId('error-retry').getByText('Tentar de novo').click();
    expect(await page.getByTestId('button-counter-value').textContent()).not.toBe(before);
    await expect(page.getByTestId('error-warning')).toBeVisible();
    await page.getByTestId('section-error').screenshot({ path: 'test-results/error-states.png' });
  });

  test('EmptyState offers its actions', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('empty-default')).toContainText('Nenhum pedido ainda');
    await expect(page.getByTestId('empty-minimal')).toContainText('Sem resultados');
    const before = await page.getByTestId('button-counter-value').textContent();
    await page.getByTestId('empty-actions').getByText('Cadastrar').click();
    expect(await page.getByTestId('button-counter-value').textContent()).not.toBe(before);
    await expect(page.getByTestId('empty-actions')).toContainText('Importar');
    await page.getByTestId('section-empty').screenshot({ path: 'test-results/empty-states.png' });
  });

  test('nothing from the web renderer reached the bundle', async ({ page }) => {
    await openGallery(page);
    // Emotion registers a <style data-emotion> tag on first paint; MUI cannot render without it.
    await expect(page.locator('style[data-emotion]')).toHaveCount(0);
    await expect(page.locator('.MuiButton-root')).toHaveCount(0);
  });
});
