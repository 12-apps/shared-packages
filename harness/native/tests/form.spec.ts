import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * WHAT THE BROWSER PAINTED, IN NUMBERS — the form batch.
 *
 * Read off the react-native-web render of the PUBLISHED native build and
 * compared with the tables the web MUI build reads (`Input.metrics.ts`,
 * `Select.metrics.ts`, `Switch.metrics.ts`, `Checkbox.metrics.ts`).
 *
 * The interaction tests pin the CONTRACT as well as the paint: a native
 * `Switch` and `Checkbox` call `onChange(event, checked)` with
 * `event.target.checked`, and a native `Select` calls `onChange(event, option)`
 * with `event.target.value` — the shapes MUI hands a web screen, so a screen
 * written against the web keeps working when it is bundled by Metro.
 *
 * The test ids are the WEB's, exactly: only the `<input>` is named on both
 * renderers, so an `Input`'s label and helper are found by their text, while
 * `Switch` and `Checkbox` do name their container and helper.
 */
const SWITCH_SIZES = {
  xs: { width: 34, height: 18 },
  sm: { width: 42, height: 22 },
  md: { width: 50, height: 26 },
  lg: { width: 58, height: 30 },
  xl: { width: 66, height: 34 },
} as const;

const DANGER = 'rgb(211, 47, 47)';

const px = async (locator: Locator, property: string): Promise<number> =>
  Number.parseFloat(await locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property));

async function openGallery(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('gallery')).toBeVisible();
}

test.describe('the form components of the native build', () => {
  test('renders every form section', async ({ page }) => {
    await openGallery(page);
    for (const section of ['section-input', 'section-select', 'section-toggles']) {
      await expect(page.getByTestId(section)).toBeVisible();
    }
    await page.getByTestId('section-input').screenshot({ path: 'test-results/form-input.png' });
    await page.getByTestId('section-select').screenshot({ path: 'test-results/form-select.png' });
    await page.getByTestId('section-toggles').screenshot({ path: 'test-results/form-toggles.png' });
  });

  test('Input takes what is typed and shows its label and helper', async ({ page }) => {
    await openGallery(page);
    const field = page.getByTestId('input-basic');
    await field.fill('Thompson');
    await expect(page.getByTestId('input-basic-value')).toHaveText('Valor: Thompson');
    // Neither renderer names the helper line, so it is found by its words.
    const helper = page.getByTestId('section-input').getByText('Campo obrigatório');
    await expect(helper).toBeVisible();
    await expect(helper).toHaveCSS('color', DANGER);
    await expect(page.getByTestId('input-disabled')).toBeDisabled();
  });

  test('Input insets its value by the same total the web pads it', async ({ page }) => {
    await openGallery(page);
    // The web draws the outline on a sibling fieldset, so MUI's padding is the
    // whole inset. React Native has one box, so the border eats into it and the
    // padding gives that width back — border + padding is the web's number.
    const inset = async (testId: string): Promise<number> =>
      page.getByTestId(testId).evaluate((el) => {
        const own = Number.parseFloat(getComputedStyle(el).paddingTop);
        const field = el.parentElement;
        const edge = field ? Number.parseFloat(getComputedStyle(field).borderTopWidth) : 0;
        return own + edge;
      });
    // xs, lg and xl are the three stops the house overrides; md is MUI's own.
    expect(await inset('input-size-xs')).toBe(6);
    expect(await inset('input-size-lg')).toBe(16);
    expect(await inset('input-size-xl')).toBe(20);
    expect(await inset('input-size-md')).toBe(16.5);
    // And the padding alone is that inset less the resting 1px outline.
    expect(await px(page.getByTestId('input-size-xs'), 'padding-top')).toBe(5);
  });

  test('Select opens, picks, and reports through event.target.value', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('select-uf-value')).toHaveText('Escolhido: ');
    await page.getByTestId('select-uf-select').click();
    const option = page.getByTestId('select-uf-option-rj');
    await expect(option).toBeVisible();
    expect(await px(option, 'min-height')).toBe(48);
    await option.click();
    await expect(page.getByTestId('select-uf-value')).toHaveText('Escolhido: rj');
    await expect(page.getByTestId('select-uf-select')).toContainText('Rio de Janeiro');
  });

  test('Select refuses a disabled option and a disabled field', async ({ page }) => {
    await openGallery(page);
    await page.getByTestId('select-uf-select').click();
    const disabled = page.getByTestId('select-uf-option-mg');
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await disabled.click({ force: true });
    await expect(page.getByTestId('select-uf-value')).not.toHaveText('Escolhido: mg');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('select-disabled-select')).toHaveAttribute('aria-disabled', 'true');
  });

  test('Switch draws each size’s track and toggles through onChange(event, checked)', async ({ page }) => {
    await openGallery(page);
    // The pressable IS the track: its box is the geometry table's width and height.
    for (const [size, metrics] of Object.entries(SWITCH_SIZES)) {
      const track = page.getByTestId(`switch-size-${size}`);
      const box = await track.boundingBox();
      expect(box?.width, size).toBe(metrics.width);
      expect(box?.height, size).toBe(metrics.height);
    }
    await expect(page.getByTestId('switch-basic-value')).toHaveText('Ligado: não');
    await page.getByTestId('switch-basic').click();
    await expect(page.getByTestId('switch-basic-value')).toHaveText('Ligado: sim');
    await expect(page.getByTestId('switch-basic')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('switch-disabled')).toHaveAttribute('aria-disabled', 'true');
  });

  test('Checkbox ticks, goes indeterminate, and keeps MUI’s 9px hit padding', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId('checkbox-basic-value')).toHaveText('Aceito: não');
    await page.getByTestId('checkbox-basic').click();
    await expect(page.getByTestId('checkbox-basic-value')).toHaveText('Aceito: sim');
    await expect(page.getByTestId('checkbox-basic')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('checkbox-indeterminate')).toHaveAttribute('aria-checked', 'mixed');
    expect(await px(page.getByTestId('checkbox-basic'), 'padding-top')).toBe(9);
    await expect(page.getByTestId('checkbox-error-helper')).toHaveText('Obrigatório');
    await expect(page.getByTestId('checkbox-disabled')).toHaveAttribute('aria-disabled', 'true');
  });

  test('a disabled control never fires its handler', async ({ page }) => {
    await openGallery(page);
    const counter = page.getByTestId('button-counter-value');
    const before = await counter.textContent();
    await page.getByTestId('switch-disabled').click({ force: true });
    await expect(counter).toHaveText(before ?? '');
  });
});
