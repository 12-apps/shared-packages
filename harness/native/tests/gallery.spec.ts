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
      expect(await px(button.locator('div, span').first(), 'font-size')).toBe(metrics.fontSize);
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
    await expect(page.getByTestId('icon-color-danger').locator('path').first()).toHaveAttribute('fill', '#d32f2f');
    await expect(page.getByTestId('icon-labelled')).toHaveAttribute('aria-label', 'Atenção');
    await expect(page.getByTestId('icon-size-md')).toHaveAttribute('aria-hidden', 'true');
  });

  test('nothing from the web renderer reached the bundle', async ({ page }) => {
    await openGallery(page);
    // Emotion registers a <style data-emotion> tag on first paint; MUI cannot render without it.
    await expect(page.locator('style[data-emotion]')).toHaveCount(0);
    await expect(page.locator('.MuiButton-root')).toHaveCount(0);
  });
});
