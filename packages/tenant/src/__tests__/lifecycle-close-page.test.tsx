// @vitest-environment jsdom
/**
 * The owner's closing screens, rendered from a hospital host's pack, codes and
 * widgets: each state of the close page, its dialog, the banner, the gone
 * screen and the refusal readers behave as the screens they were extracted
 * from (keep list K-P, K-D, K-B, K-R), and every word on screen is the pack's.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClosingScreens } from '../lifecycle/react';
import {
  BLOCKERS,
  HOSPITAL_PACK as copy,
  NAME,
  answered,
  closingConfig,
  hostState,
  pin,
  query,
  view,
  wordsNotFromPack,
  type HostState,
  focusOn,
} from './lifecycle-react-fixtures';

afterEach(cleanup);

const CLOSING = view({ status: 'WINDING_DOWN', requestedAt: '2026-11-26T12:00:00Z', purgeAt: '2026-12-26T12:00:00Z' });

function page(host: HostState, toast = vi.fn()) {
  const screens = createClosingScreens(closingConfig(host, toast));
  const utils = render(<screens.ClosePage slug="north" copy={copy} />);
  return { ...utils, screens, toast };
}

/** The typing element behind a test id (the id sits on the field itself or on its wrapper). */
function field(testId: string): HTMLInputElement | HTMLTextAreaElement {
  const node = screen.getByTestId(testId);
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node;
  const inner = node.querySelector('textarea, input');
  if (inner === null) throw new Error(`no field under ${testId}`);
  return inner as HTMLInputElement | HTMLTextAreaElement;
}

function expectOnlyPackWords(values: readonly string[] = []): void {
  expect(wordsNotFromPack(document.body.textContent ?? '', values)).toBe('');
}

describe('the close page, open tenant (K-P5…K-P8)', () => {
  it('shows the three cards in order, framed as eligible, every word from the pack', async () => {
    page(hostState());
    const cards = ['close-pending', 'close-data', 'close-act'].map((id) => screen.getByTestId(id));
    expect(cards[0]?.compareDocumentPosition(cards[1] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(cards[1]?.compareDocumentPosition(cards[2] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('host-frame').dataset.eligible).toBe('true');
    expect(screen.getByText('«h.pendingNone»')).toBeTruthy();
    expect(screen.getByTestId('close-ward-open').hasAttribute('disabled')).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('close-missing')).toBeNull());
    expectOnlyPackWords();
  });

  it('lists each blocker with its shortcut under the tenant, and holds the close with the count (K-P6, K-P8)', () => {
    page(hostState({ view: query(view({ blockers: BLOCKERS })) }));
    expect(screen.getByTestId('close-blocker-admissions').textContent).toContain('«h.blocker(admissions|2)»');
    const go = screen.getByTestId('close-blocker-admissions-go');
    expect(go.getAttribute('href')).toBe('/north/wards/admissions');
    expect(go.textContent).toBe('«h.shortcut(admissions)»');
    expect(screen.getByTestId('close-ward-open').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('close-missing').textContent).toBe('«h.missing(2)»');
    expectOnlyPackWords();
  });

  it('asks for the export, then says it is preparing and moves focus there (K-P7)', async () => {
    const host = hostState();
    page(host);
    fireEvent.click(screen.getByTestId('close-data-export'));
    const preparing = await screen.findByTestId('close-data-preparing');
    expect(preparing.getAttribute('role')).toBe('status');
    await waitFor(() => expect(document.activeElement).toBe(preparing));
    expect(screen.getByTestId('close-data-export').hasAttribute('disabled')).toBe(true);
    expect(host.exportRun).toHaveBeenCalledTimes(1);
  });

  it("tells a refusal by the server's sentence and a failed connection by the pack's (K-P7)", async () => {
    const refused = hostState({ exportRun: vi.fn(async () => Promise.reject(answered(409, 'server says no'))) });
    page(refused);
    fireEvent.click(screen.getByTestId('close-data-export'));
    expect((await screen.findByTestId('close-data-failed')).textContent).toContain('server says no');
    cleanup();
    page(hostState({ exportRun: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) }));
    fireEvent.click(screen.getByTestId('close-data-export'));
    expect((await screen.findByTestId('close-data-failed')).textContent).toContain('«h.dataOffline»');
  });

  it('shows the loading state, then the error with a retry (K-P3)', () => {
    const host = hostState({ view: query<ReturnType<typeof view>>(undefined, { isPending: true }) });
    page(host);
    expect(screen.getByTestId('close-loading')).toBeTruthy();
    cleanup();
    const failed = hostState({ view: query<ReturnType<typeof view>>(undefined, { isError: true, error: new Error('down') }) });
    page(failed);
    expect(screen.getByText('«h.loadFailed»')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '«h.retry»' }));
    expect(failed.view.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the close dialog (K-D)', () => {
  async function openDialog(host = hostState()) {
    const utils = page(host);
    const opener = screen.getByTestId('close-ward-open');
    await focusOn(opener);
    fireEvent.click(opener);
    return { ...utils, opener };
  }
  const confirmButton = () => screen.getByRole('button', { name: '«h.closeAction»' });

  it('opens with the pack words, the undo note first, and focus on the way back (K-D1…K-D3)', async () => {
    await openDialog();
    const dialog = await screen.findByTestId('close-ward-dialog');
    expect(dialog.textContent).toContain('«h.dialogTitle»');
    expect(dialog.textContent).toContain(`«h.dialogBody(${NAME})»`);
    expect(screen.getByTestId('close-ward-undo').textContent).toBe('«h.dialogUndo»');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('«h.cancel»'));
    expect(wordsNotFromPack(dialog.textContent ?? '', [NAME])).toBe('');
  });

  it('lights the confirm only with a reason, the name as the server compares it and the PIN (K-D5, K-D7)', async () => {
    const off = () => confirmButton().hasAttribute('disabled') || confirmButton().getAttribute('aria-disabled') === 'true';
    await openDialog(hostState());
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: 'ab' } });
    fireEvent.change(field('close-ward-name'), { target: { value: '  hospital   SANTA clara ' } });
    expect(off()).toBe(true);
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    expect(off()).toBe(false);
    fireEvent.change(field('close-ward-name'), { target: { value: 'Other' } });
    expect(off()).toBe(true);
    expect(screen.getByText(`«h.nameMismatch» «h.nameHint(${NAME})»`)).toBeTruthy();
    cleanup();
    await openDialog(hostState({ pin: pin({ ready: false }) }));
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
    expect(off()).toBe(true);
  });

  it('confirms the PIN first, sends the trimmed reason and the typed name, and closes (K-D7)', async () => {
    const host = hostState();
    await openDialog(host);
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: '  moving  ' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(host.closeRun).toHaveBeenCalledWith({ reason: 'moving', typedName: NAME }));
    expect(host.pin.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('close-ward-dialog')).toBeNull());
  });

  it("keeps the dialog and says the server's refusal when the close is refused (K-D7)", async () => {
    const host = hostState({ closeRun: vi.fn(async () => Promise.reject(new Error('still busy'))) });
    await openDialog(host);
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
    fireEvent.click(confirmButton());
    expect((await screen.findByTestId('close-ward-error')).textContent).toContain('still busy');
  });

  it('sends nothing when the PIN is refused', async () => {
    const host = hostState({ pin: pin({ confirm: vi.fn(async () => false) }) });
    await openDialog(host);
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(host.pin.confirm).toHaveBeenCalledTimes(1));
    expect(host.closeRun).not.toHaveBeenCalled();
  });

  /** Fill the dialog so its confirm is lit. */
  function fill(): void {
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
  }

  /** Escape, the close button and the way back: each must leave the dialog up. */
  function tryEveryWayOut(dialog: HTMLElement): void {
    fireEvent.keyDown(dialog, { key: 'Escape' });
    const closeButton = screen.queryByRole('button', { name: '«h.closeLabel»' });
    if (closeButton !== null) fireEvent.click(closeButton);
    fireEvent.click(screen.getByRole('button', { name: '«h.cancel»' }));
  }

  it('cannot be closed while the close is with the server (K-D7)', async () => {
    const host = hostState({ closeRun: vi.fn(() => new Promise<unknown>(() => undefined)) });
    await openDialog(host);
    const dialog = await screen.findByTestId('close-ward-dialog');
    fill();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(host.closeRun).toHaveBeenCalledTimes(1));
    tryEveryWayOut(dialog);
    // Each way out answers synchronously (the dialog is unmounted in the same act), so a dialog still here stayed.
    expect(screen.getByTestId('close-ward-dialog')).toBeTruthy();
  });

  it('cannot be closed while the PIN is with the server (K-D7)', async () => {
    await openDialog(hostState({ pin: pin({ busy: true }) }));
    const dialog = await screen.findByTestId('close-ward-dialog');
    expect(screen.getByRole('button', { name: '«h.closeLabel»' })).toBeTruthy();
    tryEveryWayOut(dialog);
    // Each way out answers synchronously (the dialog is unmounted in the same act), so a dialog still here stayed.
    expect(screen.getByTestId('close-ward-dialog')).toBeTruthy();
  });

  it('closes on Escape and returns focus to its opener (K-D8)', async () => {
    const { opener } = await openDialog();
    const dialog = await screen.findByTestId('close-ward-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('close-ward-dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('the close page, other states (K-P9…K-P12)', () => {
  it('closing: since and until in the short day, the reopen, and the unnumbered data card (K-P10)', () => {
    page(hostState({ view: query(CLOSING) }));
    expect(screen.getByTestId('close-closing').textContent).toContain('«h.closingBody(D[2026-11-26]|D[2026-12-26])»');
    expect(screen.getByTestId('close-data').textContent).toContain('«h.dataTitlePlain»');
    expect(screen.getByTestId('host-frame').dataset.eligible).toBe('false');
    expectOnlyPackWords(['D[2026-11-26]', 'D[2026-12-26]']);
  });

  it('focuses the closing heading when the page saw the tenant open first (K-P10)', async () => {
    const host = hostState();
    const { rerender, screens } = page(host);
    host.view = query(CLOSING);
    rerender(<screens.ClosePage slug="north" copy={copy} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('close-closing-heading')));
  });

  it('reopens and says live again, or still suspended, by the answered status (K-P12)', async () => {
    const live = hostState({ view: query(CLOSING) });
    const { toast } = page(live);
    fireEvent.click(screen.getByTestId('close-reopen'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('«h.reopened»', { severity: 'success', testId: 'ward-reopened-toast' }));
    cleanup();
    const held = hostState({ view: query(CLOSING), reopenRun: vi.fn(async () => ({ status: 'ON_HOLD' })) });
    const second = page(held);
    fireEvent.click(screen.getByTestId('close-reopen'));
    await waitFor(() => expect(second.toast).toHaveBeenCalledWith('«h.reopenedSuspended»', expect.objectContaining({ severity: 'success' })));
  });

  it('after a reopen to the open tenant, focus goes to the first card, never to <body>', async () => {
    const host = hostState({ view: query(CLOSING) });
    const opened = page(host);
    await focusOn(screen.getByTestId('close-reopen'));
    host.view = query(view());
    opened.rerender(<opened.screens.ClosePage slug="north" copy={copy} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('close-pending')));
  });

  it('says a failed reopen in place', async () => {
    page(hostState({ view: query(CLOSING), reopenRun: vi.fn(async () => Promise.reject(new Error('nope'))) }));
    fireEvent.click(screen.getByTestId('close-reopen'));
    expect((await screen.findByTestId('close-reopen-error')).textContent).toContain('nope');
  });

  it('neither open nor closing: the not-closable notice; after a reopen to a hold, its title says so with focus (K-P9)', async () => {
    page(hostState({ view: query(view({ status: 'ON_HOLD' })) }));
    expect(screen.getByTestId('close-not-closable').textContent).toContain('«h.notClosableTitle»');
    expect(screen.getByTestId('close-not-closable').textContent).toContain('«h.notClosableBody»');
    cleanup();
    const reopened = hostState({ view: query(CLOSING) });
    const next = page(reopened);
    reopened.view = query(view({ status: 'ON_HOLD' }));
    next.rerender(<next.screens.ClosePage slug="north" copy={copy} />);
    const notice = screen.getByTestId('close-not-closable');
    expect(notice.textContent).toContain('«h.reopenedSuspended»');
    await waitFor(() => expect(document.activeElement?.contains(notice)).toBe(true));
  });

  it('closed: the one notice, nothing else (K-P11)', async () => {
    page(hostState({ view: query(view({ status: 'SHUT' })) }));
    expect(screen.getByTestId('close-closed').textContent).toContain('«h.closedTitle»');
    await waitFor(() => expect(screen.queryByTestId('close-data')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('close-reopen')).toBeNull());
    expectOnlyPackWords();
  });
});

describe('the closing banner (K-B)', () => {
  const closingState = query({ status: 'WINDING_DOWN', requestedAt: '2026-11-26T12:00:00Z', purgeAt: '2026-12-26T12:00:00Z' });

  function banner(host: HostState, toast = vi.fn()) {
    const screens = createClosingScreens(closingConfig(host, toast));
    return { ...render(<screens.ClosingBanner slug="north" copy={copy} />), toast };
  }

  it('shows amber, with the dates, the read-only line and the reopen, to a holder (K-B1, K-B3)', () => {
    banner(hostState({ state: closingState }));
    const shown = screen.getByTestId('closing-banner');
    expect(shown.textContent).toContain('«h.bannerTitle»');
    expect(shown.textContent).toContain('«h.bannerBody(D[2026-11-26]|D[2026-12-26])»');
    expect(screen.getByTestId('closing-banner-read-only').textContent).toBe('«h.bannerReadOnly»');
    expect(screen.getByTestId('closing-banner-reopen').textContent).toBe('«h.reopen»');
    expectOnlyPackWords(['D[2026-11-26]', 'D[2026-12-26]']);
  });

  it('is the warning alert, never the error one (K-B3)', () => {
    banner(hostState({ state: closingState }));
    const alert = screen.getByRole('alert');
    expect(alert.className).toMatch(/Warning/u);
    expect(alert.className).not.toMatch(/Error/u);
  });

  it('reopens from its button and says so (K-B3, K-P12)', async () => {
    const host = hostState({ state: closingState, reopenRun: vi.fn(async () => ({ status: 'ON_HOLD' })) });
    const { toast } = banner(host);
    fireEvent.click(screen.getByTestId('closing-banner-reopen'));
    await waitFor(() => expect(host.reopenRun).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('«h.reopenedSuspended»', { severity: 'success', testId: 'ward-reopened-toast' }),
    );
  });

  it("says a failed reopen in its own line, as an alert, with the error's own message (K-B3)", async () => {
    const { toast } = banner(hostState({ state: closingState, reopenRun: vi.fn(async () => Promise.reject(new Error('reopen refused'))) }));
    fireEvent.click(screen.getByTestId('closing-banner-reopen'));
    const line = await screen.findByTestId('closing-banner-error');
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.textContent).toBe('reopen refused');
    expect(toast).not.toHaveBeenCalled();
  });

  it('asks only for a holder, and draws nothing for an open tenant (K-B1)', async () => {
    const host = hostState({ holds: false });
    banner(host);
    expect(host.stateEnabled).toEqual([false]);
    await waitFor(() => expect(screen.queryByTestId('closing-banner')).toBeNull());
  });

  it('hides on the close page itself (K-B2)', async () => {
    banner(hostState({ state: closingState, pathname: '/north/settings/wind-down/' }));
    await waitFor(() => expect(screen.queryByTestId('closing-banner')).toBeNull());
  });
});

describe('the refusals (K-R)', () => {
  afterEach(() => {
    // The watch patches the page's fetch once per page: give each case a fresh one.
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, '__tenantReadOnlyWatch');
  });

  it('reads the host codes on a 403 only', () => {
    const readers = createClosingScreens(closingConfig(hostState()));
    expect(readers.closingRefusalOf(answered(403, 'x', { code: 'WARD_SHUT' }))).toBe('closed');
    expect(readers.closingRefusalOf(answered(403, 'x', { code: 'WARD_WINDING_DOWN' }))).toBe('closing');
    expect(readers.closingRefusalOf(answered(403, 'x', { code: 'WARD_READ_ONLY' }))).toBe('readOnly');
    expect(readers.closingRefusalOf(answered(409, 'x', { code: 'WARD_SHUT' }))).toBeNull();
    expect(readers.closingRefusalOf(answered(403, 'x', { code: 'OTHER' }))).toBeNull();
    expect(readers.closingRefusalOf(new Error('offline'))).toBeNull();
  });

  it('raises one read-only toast with the way to the close page under the host paths (K-R2)', () => {
    const toast = vi.fn();
    const navigate = vi.fn();
    const readers = createClosingScreens(closingConfig(hostState(), toast, navigate));
    window.history.pushState({}, '', '/console/north/wards');
    readers.interceptReadOnly(answered(403, 'read only now', { code: 'WARD_READ_ONLY' }), { seeClosing: '«h.seeClosing»' });
    readers.interceptReadOnly(answered(403, 'other', { code: 'WARD_SHUT' }), { seeClosing: '«h.seeClosing»' });
    expect(toast).toHaveBeenCalledTimes(1);
    const [message, options] = toast.mock.calls[0] as [string, { actions: { label: string; onClick: () => void }[] }];
    expect(message).toBe('read only now');
    expect(options).toMatchObject({
      id: 'ward-read-only',
      severity: 'warning',
      testId: 'ward-read-only-toast',
      duration: 8000,
      dismissible: true,
      assertive: true,
    });
    expect(options.actions[0]?.label).toBe('«h.seeClosing»');
    options.actions[0]?.onClick();
    expect(navigate).toHaveBeenCalledWith('/console/north/settings/wind-down');
    expect(readers.closePagePath('north')).toBe('/console/north/settings/wind-down');
  });

  it("watches the app's own writes once, reading a clone (K-R2)", async () => {
    const toast = vi.fn();
    const readers = createClosingScreens(closingConfig(hostState(), toast));
    const body = JSON.stringify({ code: 'WARD_READ_ONLY', error: 'read only now' });
    const fetchMock = vi.fn(async () => {
      const response = new Response(body, { status: 403 });
      Object.defineProperty(response, 'url', { value: 'http://x/api/console/north/beds' });
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);
    readers.watchReadOnlyWrites(() => ({ seeClosing: '«h.seeClosing»' }));
    readers.watchReadOnlyWrites(() => ({ seeClosing: '«h.seeClosing»' }));
    const response = await act(async () => window.fetch('/api/console/north/beds', { method: 'POST' }));
    expect(await response.json()).toEqual({ code: 'WARD_READ_ONLY', error: 'read only now' });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    await window.fetch('/api/console/north/beds');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('sends a member to the one other tenant, the picker, or signs out (K-R3)', () => {
    const navigate = vi.fn();
    const readers = createClosingScreens(closingConfig(hostState(), vi.fn(), navigate));
    expect(readers.switchTarget(['south'])).toBe('/console/south');
    expect(readers.switchTarget(['south', 'east'])).toBe('/console/');
    expect(readers.switchTarget([])).toBeNull();
    const onSignOut = vi.fn();
    render(<readers.TenantGoneScreen refusal="closed" otherSlugs={[]} onSignOut={onSignOut} copy={copy} />);
    expect(screen.getByTestId('ward-gone-screen').textContent).toContain('«h.refusedClosedTitle»');
    fireEvent.click(screen.getByRole('button', { name: '«h.signOut»' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expectOnlyPackWords();
    cleanup();
    render(<readers.TenantGoneScreen refusal="closing" otherSlugs={['south']} onSignOut={onSignOut} copy={copy} />);
    expect(screen.getByTestId('ward-gone-screen').textContent).toContain('«h.refusedClosingBody»');
    fireEvent.click(screen.getByRole('button', { name: '«h.switchTenant»' }));
    expect(navigate).toHaveBeenCalledWith('/console/south');
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
