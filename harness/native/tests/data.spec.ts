import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * WHAT THE BROWSER PAINTED, IN NUMBERS — the data-display batch.
 *
 * Same claim as `gallery.spec.ts`: these read computed styles off the
 * react-native-web render of the PUBLISHED native build and compare them with
 * the very tables the web MUI build reads (`Chip.metrics.ts`,
 * `Avatar.metrics.ts`, `Badge.metrics.ts`, `Progress.metrics.ts`,
 * `Skeleton.metrics.ts`). A number that drifts on one renderer fails here.
 */

/** `chipMuiSize`: MUI gives a chip two heights, so xs/sm are small and md up are medium. */
const CHIP_HEIGHTS = { xs: 24, sm: 24, md: 32, lg: 32, xl: 32 } as const;

const AVATAR_SIZES = {
  xs: { box: 24, fontSize: 12 },
  sm: { box: 32, fontSize: 14 },
  md: { box: 40, fontSize: 16 },
  lg: { box: 48, fontSize: 18 },
  xl: { box: 64, fontSize: 24 },
  xxl: { box: 80, fontSize: 32 },
} as const;

const BADGE_SIZES = {
  xs: { minWidth: 14, height: 14, fontSize: 8 },
  sm: { minWidth: 16, height: 16, fontSize: 10 },
  md: { minWidth: 20, height: 20, fontSize: 12 },
  lg: { minWidth: 24, height: 24, fontSize: 14 },
  xl: { minWidth: 28, height: 28, fontSize: 16 },
} as const;

const PROGRESS_HEIGHTS = { xs: 2, sm: 4, md: 6, lg: 8, xl: 10 } as const;

const px = async (locator: Locator, property: string): Promise<number> =>
  Number.parseFloat(await locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property));

const boxHeight = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  return box?.height ?? -1;
};

async function openGallery(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('gallery')).toBeVisible();
}

test.describe('the data-display components of the native build', () => {
  test('renders every data section', async ({ page }) => {
    await openGallery(page);
    for (const section of ['section-chip', 'section-avatar', 'section-badge', 'section-progress', 'section-skeleton']) {
      await expect(page.getByTestId(section)).toBeVisible();
    }
    await page.getByTestId('section-chip').screenshot({ path: 'test-results/data-chip.png' });
    await page.getByTestId('section-avatar').screenshot({ path: 'test-results/data-avatar.png' });
    await page.getByTestId('section-badge').screenshot({ path: 'test-results/data-badge.png' });
    await page.getByTestId('section-progress').screenshot({ path: 'test-results/data-progress.png' });
    await page.getByTestId('section-skeleton').screenshot({ path: 'test-results/data-skeleton.png' });
  });

  test('Chip takes MUI’s two heights across the five-stop scale', async ({ page }) => {
    await openGallery(page);
    for (const [size, height] of Object.entries(CHIP_HEIGHTS)) {
      expect(await boxHeight(page.getByTestId(`chip-size-${size}`)), size).toBe(height);
    }
    // The outlined variant draws a 1px border and keeps the same box.
    await expect(page.getByTestId('chip-outlined-primary')).toHaveCSS('border-top-width', '1px');
    expect(await boxHeight(page.getByTestId('chip-outlined-primary'))).toBe(32);
  });

  test('Chip answers a press only when it is not disabled', async ({ page }) => {
    await openGallery(page);
    const counter = page.getByTestId('button-counter-value');
    const before = await counter.textContent();
    await page.getByTestId('chip-disabled').click({ force: true });
    await expect(counter).toHaveText(before ?? '');
    await page.getByTestId('chip-selectable').click();
    await expect(page.getByTestId('chip-selectable')).toContainText('Selecionado');
    await expect(counter).not.toHaveText(before ?? '');
  });

  test('Avatar boxes and types every stop, xxl included', async ({ page }) => {
    await openGallery(page);
    for (const [size, metrics] of Object.entries(AVATAR_SIZES)) {
      const avatar = page.getByTestId(`avatar-size-${size}`);
      const box = await avatar.boundingBox();
      expect(box?.width, size).toBe(metrics.box);
      expect(box?.height, size).toBe(metrics.box);
    }
    // Square is unrounded, circle is a half-box radius.
    expect(await px(page.getByTestId('avatar-square'), 'border-top-left-radius')).toBe(0);
    expect(await px(page.getByTestId('avatar-circle'), 'border-top-left-radius')).toBe(20);
    await expect(page.getByTestId('avatar-bordered')).toHaveCSS('border-top-width', '2px');
  });

  test('Badge sizes its pill from the shared table and clamps the count', async ({ page }) => {
    await openGallery(page);
    const contentFont = async (testId: string): Promise<number> =>
      page.getByTestId(testId).evaluate((el) =>
        Number.parseFloat(getComputedStyle(el.firstElementChild ?? el).fontSize),
      );
    for (const [size, metrics] of Object.entries(BADGE_SIZES)) {
      const pill = page.getByTestId(`badge-size-${size}-content-wrapper`);
      expect(await px(pill, 'min-width'), size).toBe(metrics.minWidth);
      expect(await px(pill, 'height'), size).toBe(metrics.height);
      // The slot is a View; the digits are the Text inside it, which is where
      // react-native-web writes the font (a View does not cascade one).
      expect(await contentFont(`badge-size-${size}-content`), size).toBe(metrics.fontSize);
    }
    await expect(page.getByTestId('badge-max-content')).toHaveText('99+');
    await expect(page.getByTestId('badge-zero-hidden-content-wrapper')).toBeHidden();
    await expect(page.getByTestId('badge-zero-shown-content')).toHaveText('0');
    await expect(page.getByTestId('badge-invisible-content-wrapper')).toBeHidden();
  });

  test('Progress draws each size’s bar height and reports its value', async ({ page }) => {
    await openGallery(page);
    for (const [size, height] of Object.entries(PROGRESS_HEIGHTS)) {
      expect(await boxHeight(page.getByTestId(`progress-size-${size}-linear`)), size).toBe(height);
    }
    await expect(page.getByTestId('progress-labelled-label')).toHaveText('35%');
    await expect(page.getByTestId('progress-custom-label-label')).toHaveText('Enviando…');
    // A determinate bar reports where it is; an indeterminate one reports nothing.
    const bar = page.getByTestId('progress-labelled-linear');
    await expect(bar).toHaveRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '35');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
    await expect(page.getByTestId('progress-indeterminate-linear')).not.toHaveAttribute('aria-valuenow', /.*/);
  });

  test('Skeleton takes each variant’s default box and repeats on count', async ({ page }) => {
    await openGallery(page);
    const circular = page.getByTestId('skeleton-variant-circular');
    const box = await circular.boundingBox();
    expect(box?.width).toBe(40);
    expect(box?.height).toBe(40);
    expect(await boxHeight(page.getByTestId('skeleton-variant-rectangular'))).toBe(40);
    expect(await px(page.getByTestId('skeleton-radius'), 'border-top-left-radius')).toBe(12);
    // `count` repeats the shape; the ids are suffixed by index.
    for (const index of [0, 1, 2]) {
      await expect(page.getByTestId(`skeleton-counted-${index}`)).toBeVisible();
    }
    await expect(page.getByTestId('skeleton-counted-3')).toHaveCount(0);
  });
});
