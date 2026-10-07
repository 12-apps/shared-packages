import { expect, test } from '@playwright/test';

/**
 * `@12-apps/routing` — the route map, mounted through the wiring consumer's
 * web half from the packed tarball.
 *
 * The drawing rules are unit-tested inside the package against a fake
 * MapLibre. What only a consumer can show is that the tarball's surface,
 * built with the host's words, colours and worker URL, mounts in a real
 * bundle and loads its optional peer lazily: the map region renders, and it
 * settles either on the drawn run or — with no basemap reachable — on the
 * package's own error state. Never on a blank page.
 */
test('the mounted surface renders the map region in the host words', async ({ page }) => {
  await page.goto('#/route-map');

  await expect(page.getByTestId('page-route-map')).toBeVisible();
  const map = page.getByTestId('route-map');
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute('aria-label', 'Map');
  // Drawn, or refused in the package's words — both are the surface answering.
  await expect(
    map.getByRole('button', { name: 'Alex, on the way' }).or(map.getByRole('button', { name: 'Try again' })),
  ).toBeVisible({ timeout: 30_000 });
});
