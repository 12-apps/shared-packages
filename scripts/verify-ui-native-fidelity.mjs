import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(resolve(root, 'packages/ui/package.json'));
const { chromium } = require('playwright');
const [renderer, baseUrl] = process.argv.slice(2);
assert.ok(['web', 'native'].includes(renderer), 'renderer must be web or native');
assert.ok(baseUrl?.startsWith('http://127.0.0.1:'), 'serve the local Storybook first');
const output = resolve(root, 'verification/ui-native-fidelity', renderer);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const failures = [];
const boxes = async (locator) => {
  const box = await locator.boundingBox();
  assert.ok(box, 'expected a visible bounding box');
  return box;
};
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
    });
    const suffix = `${viewport.width}`;
    const shot = async (name) => page.screenshot({ path: resolve(output, `${name}-${suffix}.png`), fullPage: true });
    try {
      await page.goto(`${baseUrl}/iframe.html?id=feedback-progress--custom-circular-center&viewMode=story`, { waitUntil: 'networkidle' });
      await page.getByRole('progressbar', { name: 'Task progress' }).waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('progress-center').innerText().then((s) => s.includes('00:40')), true);
      const dial = await boxes(page.getByTestId('progress'));
      const center = await boxes(page.getByTestId('progress-center'));
      assert.ok(Math.abs(dial.x + dial.width / 2 - center.x - center.width / 2) < 1, 'center aligns horizontally');
      assert.ok(Math.abs(dial.y + dial.height / 2 - center.y - center.height / 2) < 1, 'center aligns vertically');
      await shot('circular-center');
      await page.goto(`${baseUrl}/iframe.html?id=overlays-dialog--bottom-sheet&viewMode=story`, { waitUntil: 'networkidle' });
      for (const close of ['Continue', 'Escape']) {
        await page.getByRole('button', { name: 'Open bottom sheet' }).click();
        await page.getByRole('dialog').waitFor({ state: 'visible' });
        const paper = page.getByTestId('dialog', { exact: true });
        await paper.waitFor({ state: 'visible' });
        // MUI's enter animation is a transform. Wait until its final geometry,
        // rather than taking a frame in the transition or sleeping a fixed time.
        await page.waitForFunction(({ height }) => {
          const node = document.querySelector('[data-testid="dialog"]');
          if (!node) return false;
          const box = node.getBoundingClientRect();
          return Math.abs(height - box.bottom - 16) < 1;
        }, viewport);
        const rect = await boxes(paper);
        assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width, 'paper fits horizontally');
        assert.ok(rect.y >= 0, 'paper fits vertically');
        for (const label of ['Save and end', 'Discard', 'Continue']) {
          const action = await boxes(page.getByRole('button', { name: label, exact: true }));
          assert.ok(action.y >= rect.y && action.y + action.height <= rect.y + rect.height, 'all actions remain inside paper');
        }
        await shot(close === 'Continue' ? 'bottom-sheet' : 'bottom-sheet-reopened');
        if (close === 'Escape') await page.keyboard.press('Escape');
        else await page.getByRole('button', { name: close, exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await shot(close === 'Continue' ? 'continued' : 'dismissed');
      }
      assert.deepEqual(errors, [], 'no runtime warning/error in the new states');
      results.push({ renderer, viewport, status: 'passed' });
    } catch (error) {
      await shot('failure');
      failures.push({ renderer, viewport, error: String(error), console: errors });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ sha: process.env.GITHUB_SHA, results, failures }, null, 2));
}
assert.deepEqual(failures, [], 'one or more renderer probes failed; inspect artifacts');
