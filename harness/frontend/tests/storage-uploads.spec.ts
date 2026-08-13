import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/storage` mounted the way a host mounts it (12-20): one call to
 * `createWebStorage({ apiBase })`, no transport seam, no component imported by
 * name — driving the published package's own Hono router, its own local-disk
 * driver and real files through the Vite proxy.
 *
 * The cases are the port of future-pay's admin upload specs: what the store owner
 * sees when a pick succeeds, and each of the four refusals they can act on. What
 * only THIS level can prove is the seam BETWEEN the two published halves — the
 * `{ data }` envelope the browser parses, the key shape it saves, and the object
 * that key resolves to actually loading in an `<img>`. Both halves' own suites
 * pass with a body each wrote itself; the seam is where they disagree.
 *
 * And the property the package exists for: every byte goes to OUR OWN ORIGIN. The
 * request log below is the proof — one POST, same-origin, no preflight, no bucket.
 */

/** A one-pixel PNG. Real bytes, so the server's magic-number check passes. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

test.beforeEach(async ({ request }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked reset would restore a database
     nothing under test is reading (same rationale as report-builder.spec.ts). */
  const reset = await request.post('/__harness/reset');
  expect(reset.status()).toBe(204);
});

async function open(page: Page): Promise<void> {
  await page.goto('#/storage-uploads');
  await expect(page.getByTestId('storage-page')).toBeVisible();
}

/**
 * Put a file into the picker.
 *
 * `setInputFiles` on the hidden input the package renders — a real change event
 * with real bytes, which is the only way the browser half's own `File` handling
 * (the re-encode, the upfront refusals, the `Content-Type` it sends) is exercised.
 */
async function pick(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(file);
}

function png(name = 'produto.png'): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64') };
}

/**
 * A crop's key, derived from the uncropped one.
 *
 * The extension is not assumed: the browser re-encodes before sending whenever that
 * comes out smaller, so a 1×1 source may arrive as either PNG or WebP and the stored
 * object carries whichever it was. Hard-coding `full.png` here would make this suite
 * fail the day a codec got better at small images.
 */
function cropOf(key: string, name: string): string {
  return `${key.slice(0, key.lastIndexOf('/'))}/${name}.webp`;
}

test.describe('storing an image', () => {
  test('sends ONE same-origin POST and saves the key it answers', async ({ page }) => {
    await open(page);
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/uploads/')) requests.push(`${request.method()} ${request.url()}`);
    });

    await pick(page, png());

    const key = page.getByTestId('storage-saved-key');
    await expect(key).toBeVisible();
    // The SET shape, scoped to the tenant the BACKEND resolved — the browser never
    // chose it, and could not have.
    await expect(key).toHaveText(/^products\/harness-store\/[0-9a-f-]{36}\/full\.(png|webp)$/);

    const uploads = requests.filter((entry) => entry.includes('/uploads/image'));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain('POST');
    // Same origin as the page. A presigned bucket URL would be cross-origin here,
    // which is the whole failure this package exists to make unreachable.
    expect(uploads[0]).toContain(new URL(page.url()).origin);
  });

  test('the object that key names really loads', async ({ page }) => {
    // The full round trip: browser POST → the package's route → its local-disk
    // driver → a real file → the serve route → a decoded image in this tab.
    await open(page);

    await pick(page, png());
    await expect(page.getByTestId('storage-saved-key')).toBeVisible();

    const stored = page.getByTestId('storage-stored-object');
    await expect(stored).toBeVisible();
    await expect
      .poll(() => stored.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  });

  test('the crops the key promises exist beside it', async ({ page, request }) => {
    await open(page);

    await pick(page, png());
    const key = await page.getByTestId('storage-saved-key').innerText();

    for (const name of ['card-320', 'card-640', 'card-1280', 'thumb-128', 'thumb-256']) {
      /* eslint-disable-next-line test-flakiness/no-unmocked-network --
         the object store IS the subject. */
      const response = await request.get(`/api/uploads/local/${cropOf(key, name)}`);
      expect(response.status(), name).toBe(200);
    }
  });

  test('shows the preview the moment the file is picked', async ({ page }) => {
    // An empty slot during the round-trip reads as "the click did nothing", which is
    // exactly how a swallowed storage failure looked.
    await open(page);

    await pick(page, png());

    await expect(page.getByTestId('storage-image-field-preview')).toBeVisible();
  });

  test('clears the key when the image is removed', async ({ page }) => {
    await open(page);
    await pick(page, png());
    await expect(page.getByTestId('storage-saved-key')).toBeVisible();

    await page.getByTestId('storage-image-field-remove').click();

    await expect(page.getByTestId('storage-saved-key')).toHaveCount(0);
  });
});

test.describe('the refusals a store owner can act on', () => {
  test('names the size AND the limit for a file that is too big', async ({ page }) => {
    // Refused in the browser, so no request leaves at all — and the sentence carries
    // the number the mount actually enforces rather than one typed into the SPA.
    await open(page);
    await expect(page.getByTestId('storage-limit')).toHaveText('Limite: 1 MB');

    await pick(page, {
      name: 'enorme.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024, 1),
    });

    const error = page.getByTestId('storage-image-field-error');
    await expect(error).toContainText('muito grande');
    await expect(error).toContainText('1 MB');
    await expect(page.getByTestId('storage-saved-key')).toHaveCount(0);
  });

  test('names the rejected type rather than saying only "unsupported"', async ({ page }) => {
    await open(page);

    await pick(page, {
      name: 'nota.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    });

    await expect(page.getByTestId('storage-image-field-error')).toContainText('application/pdf');
  });

  test('catches a zero-byte pick before it is uploaded and refused', async ({ page }) => {
    await open(page);

    await pick(page, { name: 'vazio.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });

    await expect(page.getByTestId('storage-image-field-error')).toContainText('vazio');
  });

  test("repeats the SERVER's own sentence about bytes that are not the declared format", async ({
    page,
  }) => {
    // The only refusal here that has to cross the wire: the magic-number check runs
    // on the server, and its pt-BR sentence is surfaced verbatim rather than
    // re-worded, so the two upload entrances cannot tell one owner two different
    // things about one file.
    await open(page);

    await pick(page, {
      name: 'mentira.png',
      mimeType: 'image/png',
      buffer: Buffer.from('GIF89a not really a png'),
    });

    await expect(page.getByTestId('storage-image-field-error')).toContainText('não corresponde');
  });
});
