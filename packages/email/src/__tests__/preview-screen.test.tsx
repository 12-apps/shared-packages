import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EN_US_EMAIL_PREVIEW_COPY } from '../react/copy.en-US';
import { createEmailPreviewScreen } from '../react/preview-screen';

/**
 * The screen's contract.
 *
 * Three properties earn a test, and none of them is "it renders":
 *
 * 1. **The list groups by owner.** That grouping IS the answer to "which parts
 *    of this system send mail", so a regression in it is a regression in what
 *    the screen is for.
 * 2. **Nothing is fetched until a message is picked, and the HTML lands in a
 *    SANDBOXED frame.** A preview that could navigate an operator to a sample
 *    verification link would be a hole in a staff surface.
 * 3. **The coverage gap is shown rather than swallowed.** A screen that hid it
 *    would look exactly like a complete catalogue.
 */

const API = '/api/platform/email-previews';

const INDEX = {
  locale: 'en-US',
  locales: ['pt-BR', 'en-US'],
  items: [
    { id: 'auth:verification', key: 'verification', family: 'account access', owner: '@acme/auth', subject: 'Confirm your email' },
    { id: 'order.paid', key: 'order.paid', family: 'notifications', owner: 'apps/web', subject: 'Payment confirmed' },
  ],
  coverage: { missing: ['stock.low'], orphan: [] },
};

const DETAIL = {
  ...INDEX.items[0],
  locale: 'en-US',
  html: '<!DOCTYPE html><html><body><h1>Confirm your email</h1></body></html>',
  text: 'Confirm your email\n\nHello Ana,\n',
};

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes(`${API}/`) ? DETAIL : INDEX;
    return Promise.resolve(
      new Response(JSON.stringify({ data: body }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const { page: Page } = createEmailPreviewScreen({ apiBase: API, copy: EN_US_EMAIL_PREVIEW_COPY });

beforeEach(() => {
  window.history.replaceState({}, '', '/console');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the e-mail preview screen', () => {
  it('groups the catalogue by the package that owns each message', async () => {
    stubFetch();
    render(<Page />);

    expect(await screen.findByTestId('email-preview-owner-@acme/auth')).toBeDefined();
    expect(screen.getByTestId('email-preview-owner-apps/web')).toBeDefined();
    expect(screen.getByTestId('email-preview-row-auth:verification').textContent).toContain(
      'Confirm your email',
    );
  });

  it('shows the coverage gap the surface reports, naming what is missing', async () => {
    stubFetch();
    render(<Page />);

    // "some are missing" is not actionable; this strip exists to be acted on.
    const notice = await screen.findByTestId('email-preview-coverage');
    expect(notice.textContent).toContain('stock.low');
  });

  it('fetches no document until a message is picked, then sandboxes it', async () => {
    const fetchMock = stubFetch();
    render(<Page />);

    await screen.findByTestId('email-preview-empty');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`${API}/`))).toBe(false);

    fireEvent.click(screen.getByTestId('email-preview-row-auth:verification'));

    const frame = await screen.findByTestId('email-preview-frame');
    // A click on a CTA inside a previewed mail must never navigate the operator.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(DETAIL.html);
  });

  it('puts the selection in the URL, so one mail is a shareable link', async () => {
    stubFetch();
    render(<Page />);

    fireEvent.click(await screen.findByTestId('email-preview-row-order.paid'));

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('id')).toBe('order.paid');
    });
  });

  it('shows the plain-text twin on its own tab', async () => {
    stubFetch();
    window.history.replaceState({}, '', '/console?id=auth:verification');
    render(<Page />);

    await screen.findByTestId('email-preview-frame');
    fireEvent.click(screen.getByTestId('email-preview-tabs-item-text'));

    // The half nobody looks at, which is how it drifts out of step with the HTML.
    expect((await screen.findByTestId('email-preview-text')).textContent).toContain(
      'Confirm your email',
    );
  });

  it('asks the surface for the language the operator picked', async () => {
    const fetchMock = stubFetch();
    render(<Page />);

    fireEvent.click(await screen.findByTestId('email-preview-locale-item-pt-BR'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('locale=pt-BR'))).toBe(true);
    });
  });

  it('surfaces a refusal instead of an empty screen', async () => {
    // A host's own gate answering 403 is the ordinary case here, and an
    // operator who sees nothing cannot tell that from a product with no mail.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Forbidden.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    render(<Page />);

    expect((await screen.findByTestId('email-preview-error')).textContent).toContain('Forbidden.');
  });
});
