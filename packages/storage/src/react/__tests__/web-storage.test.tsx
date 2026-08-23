// @vitest-environment jsdom
// fireEvent/render/waitFor from @testing-library/react — plain DOM asserts, no jest-dom.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PT_BR_WEB_STORAGE_MESSAGES } from '../pt-BR';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebStorage } from '../create-web-storage';

/**
 * The web half, rendered.
 *
 * `fetchImpl` is the only thing stubbed: what these cases are about is the REQUEST
 * that leaves and the state that follows it, so the request is captured and answered
 * rather than mocked away. The endpoint it goes to is the package's own path on the
 * app's own origin, which is the property the whole design rests on.
 */

const KEY = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/full.webp';

/**
 * The two labels `ImageField` now requires. Spread into every render below —
 * none of these cases is about the words, and a host that forgot them is a
 * typecheck failure rather than something a test has to catch.
 */
const LABELS = {
  label: PT_BR_WEB_STORAGE_MESSAGES({ limit: '8 MB' }).fieldLabel,
  removeLabel: PT_BR_WEB_STORAGE_MESSAGES({ limit: '8 MB' }).fieldRemove,
} as const;

interface Sent {
  url: string;
  method: string | undefined;
  contentType: string | undefined;
}

function stubFetch(answer: () => Response): { sent: Sent[]; fetchImpl: typeof fetch } {
  const sent: Sent[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url: String(input),
      method: init?.method,
      contentType: headers.get('content-type') ?? undefined,
    });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { sent, fetchImpl };
}

function accepted(): Response {
  return new Response(JSON.stringify({ data: { imageKey: KEY } }), { status: 200 });
}

/** jsdom has no object-URL support and no image decoder. */
function installBrowserGaps(): void {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  Reflect.deleteProperty(globalThis, 'createImageBitmap');
}

function pick(file: File): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const png = (): File => new File([new Uint8Array(64)], 'p.png', { type: 'image/png' });
const text = (testId: string): string => screen.getByTestId(testId).textContent ?? '';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWebStorage', () => {
  it('POSTs the raw file at OUR OWN origin and hands back the key', async () => {
    installBrowserGaps();
    const { sent, fetchImpl } = stubFetch(accepted);
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', fetchImpl });
    const changes: (string | null)[] = [];
    render(<storage.ImageField {...LABELS} onChange={(key) => changes.push(key)} />);

    pick(png());

    await waitFor(() => expect(changes).toEqual([KEY]));
    expect(sent).toEqual([
      // Relative, so it is the app's own origin by construction — never a bucket, and
      // therefore never subject to a CORS rule that lives in no deploy.
      { url: '/api/uploads/image', method: 'POST', contentType: 'image/png' },
    ]);
  });

  it('shows the preview the moment the file is PICKED, not when the upload lands', async () => {
    // An empty slot during the round-trip reads as "the click did nothing", which is
    // exactly how a swallowed storage 503 looked.
    installBrowserGaps();
    const { fetchImpl } = stubFetch(accepted);
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', fetchImpl });
    render(<storage.ImageField {...LABELS} onChange={() => undefined} />);

    pick(png());

    await waitFor(() =>
      expect(screen.getByTestId('storage-image-field-preview').getAttribute('src')).toBe(
        'blob:preview',
      ),
    );
  });

  it('withdraws the preview and states the reason when the upload is refused', async () => {
    installBrowserGaps();
    const { fetchImpl } = stubFetch(
      () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', fetchImpl });
    const changes: (string | null)[] = [];
    render(<storage.ImageField {...LABELS} onChange={(key) => changes.push(key)} />);

    pick(png());

    await waitFor(() => expect(text('storage-image-field-error')).toContain('permissão'));
    await waitFor(() => expect(screen.queryByTestId('storage-image-field-preview')).toBeNull());
    expect(changes).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    // States the OUTCOME only. This sentence used to assert one host's role model.
    for (const role of ['OWNER', 'ADMIN']) {
      expect(text('storage-image-field-error')).not.toContain(role);
    }
  });

  it('lets the host replace that refusal with its OWN role vocabulary', async () => {
    installBrowserGaps();
    const { fetchImpl } = stubFetch(
      () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    const storage = createWebStorage({
      apiBase: '/api',
      fetchImpl,
      messages: (context) => ({
        ...PT_BR_WEB_STORAGE_MESSAGES(context),
        forbidden: 'Peça a um gerente para enviar a foto.',
      }),
    });
    render(<storage.ImageField {...LABELS} onChange={() => undefined} />);

    pick(png());

    await waitFor(() => expect(text('storage-image-field-error')).toContain('Peça a um gerente'));
  });

  it("shows the mount's own ceiling when the server refuses, not its local default", async () => {
    // The mount is capped below this surface's default, so the only correct number on
    // screen is the one the server sent. Re-deriving it locally was the finding.
    installBrowserGaps();
    const { fetchImpl } = stubFetch(
      () =>
        new Response(JSON.stringify({ error: 'A imagem enviada é maior que o limite de 4 MB.' }), {
          status: 413,
        }),
    );
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', fetchImpl });
    render(<storage.ImageField {...LABELS} onChange={() => undefined} />);

    pick(png());

    await waitFor(() => expect(text('storage-image-field-error')).toContain('4 MB'));
    expect(text('storage-image-field-error')).not.toContain('8 MB');
  });

  it('refuses an oversize file before any request leaves the browser', async () => {
    installBrowserGaps();
    const { sent, fetchImpl } = stubFetch(accepted);
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', maxBytes: 1024, fetchImpl });
    render(<storage.ImageField {...LABELS} onChange={() => undefined} />);

    pick(new File([new Uint8Array(4096)], 'p.png', { type: 'image/png' }));

    await waitFor(() => expect(text('storage-image-field-error')).toContain('muito grande'));
    expect(sent).toEqual([]);
  });

  it('states the limit it was given, so the copy cannot claim a ceiling it is not applying', () => {
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', maxBytes: 2 * 1024 * 1024 });

    expect(storage.limits).toEqual({ maxBytes: 2 * 1024 * 1024, maxBytesLabel: '2 MB' });
  });

  it('renders a standalone page a host can mount to prove the wiring', async () => {
    installBrowserGaps();
    const { fetchImpl } = stubFetch(accepted);
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', fetchImpl });
    const Page = storage.page;
    render(<Page />);

    expect(text('storage-upload-page')).toContain('8 MB');

    pick(png());

    // The key on screen is the same string a form would fold into its save payload.
    await waitFor(() => expect(text('storage-image-field-key')).toBe(KEY));
  });

  it('clears the key and the error when the image is removed', async () => {
    installBrowserGaps();
    const { fetchImpl } = stubFetch(accepted);
    const storage = createWebStorage({ messages: PT_BR_WEB_STORAGE_MESSAGES, apiBase: '/api', fetchImpl });
    const changes: (string | null)[] = [];
    render(
      <storage.ImageField
        {...LABELS}
        value={KEY}
        previewUrl="https://cdn.test/a.webp"
        onChange={(key) => changes.push(key)}
      />,
    );

    fireEvent.click(screen.getByTestId('storage-image-field-remove'));

    await waitFor(() => expect(changes).toEqual([null]));
    await waitFor(() => expect(screen.queryByTestId('storage-image-field-preview')).toBeNull());
  });
});
