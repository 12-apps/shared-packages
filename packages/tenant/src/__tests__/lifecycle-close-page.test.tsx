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
  it('shows the three cards in order, framed as eligible, every word from the pack', () => {
    page(hostState());
    const cards = ['close-pending', 'close-data', 'close-act'].map((id) => screen.getByTestId(id));
    expect(cards[0]?.compareDocumentPosition(cards[1] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(cards[1]?.compareDocumentPosition(cards[2] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('host-frame').dataset.eligible).toBe('true');
    expect(screen.getByText('«h.pendingNone»')).toBeTruthy();
    expect(screen.getByTestId('close-ward-open').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('close-missing')).toBeNull();
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
    expect(document.activeElement).toBe(preparing);
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
  function openDialog(host = hostState()) {
    const utils = page(host);
    const opener = screen.getByTestId('close-ward-open');
    opener.focus();
    fireEvent.click(opener);
    return { ...utils, opener };
  }
  const confirmButton = () => screen.getByRole('button', { name: '«h.closeAction»' });

  it('opens with the pack words, the undo note first, and focus on the way back (K-D1…K-D3)', async () => {
    openDialog();
    const dialog = await screen.findByTestId('close-ward-dialog');
    expect(dialog.textContent).toContain('«h.dialogTitle»');
    expect(dialog.textContent).toContain(`«h.dialogBody(${NAME})»`);
    expect(screen.getByTestId('close-ward-undo').textContent).toBe('«h.dialogUndo»');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('«h.cancel»'));
    expect(wordsNotFromPack(dialog.textContent ?? '', [NAME])).toBe('');
  });

  it('lights the confirm only with a reason, the name as the server compares it and the PIN (K-D5, K-D7)', async () => {
    const off = () => confirmButton().hasAttribute('disabled') || confirmButton().getAttribute('aria-disabled') === 'true';
    openDialog(hostState());
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
    openDialog(hostState({ pin: pin({ ready: false }) }));
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
    expect(off()).toBe(true);
  });

  it('confirms the PIN first, sends the trimmed reason and the typed name, and closes (K-D7)', async () => {
    const host = hostState();
    openDialog(host);
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
    openDialog(host);
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
    fireEvent.click(confirmButton());
    expect((await screen.findByTestId('close-ward-error')).textContent).toContain('still busy');
  });

  it('sends nothing when the PIN is refused', async () => {
    const host = hostState({ pin: pin({ confirm: vi.fn(async () => false) }) });
    openDialog(host);
    await screen.findByTestId('close-ward-dialog');
    fireEvent.change(field('close-ward-reason'), { target: { value: 'moving' } });
    fireEvent.change(field('close-ward-name'), { target: { value: NAME } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(host.pin.confirm).toHaveBeenCalledTimes(1));
    expect(host.closeRun).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to its opener (K-D8)', async () => {
    const { opener } = openDialog();
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

  it('focuses the closing heading when the page saw the tenant open first (K-P10)', () => {
    const host = hostState();
    const { rerender, screens } = page(host);
    host.view = query(CLOSING);
    rerender(<screens.ClosePage slug="north" copy={copy} />);
    expect(document.activeElement).toBe(screen.getByTestId('close-closing-heading'));
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

  it('says a failed reopen in place', async () => {
    page(hostState({ view: query(CLOSING), reopenRun: vi.fn(async () => Promise.reject(new Error('nope'))) }));
    fireEvent.click(screen.getByTestId('close-reopen'));
    expect((await screen.findByTestId('close-reopen-error')).textContent).toContain('nope');
  });

  it('neither open nor closing: the not-closable notice; after a reopen to a hold, its title says so with focus (K-P9)', () => {
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
    expect(document.activeElement?.contains(notice)).toBe(true);
  });

  it('closed: the one notice, nothing else (K-P11)', () => {
    page(hostState({ view: query(view({ status: 'SHUT' })) }));
    expect(screen.getByTestId('close-closed').textContent).toContain('«h.closedTitle»');
    expect(screen.queryByTestId('close-data')).toBeNull();
    expect(screen.queryByTestId('close-reopen')).toBeNull();
    expectOnlyPackWords();
  });
});

describe('the closing banner (K-B)', () => {
  const closingState = query({ status: 'WINDING_DOWN', requestedAt: '2026-11-26T12:00:00Z', purgeAt: '2026-12-26T12:00:00Z' });

  function banner(host: HostState) {
    const screens = createClosingScreens(closingConfig(host));
    return render(<screens.ClosingBanner slug="north" copy={copy} />);
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

  it('asks only for a holder, and draws nothing for an open tenant (K-B1)', () => {
    const host = hostState({ holds: false });
    banner(host);
    expect(host.stateEnabled).toEqual([false]);
    expect(screen.queryByTestId('closing-banner')).toBeNull();
  });

  it('hides on the close page itself (K-B2)', () => {
    banner(hostState({ state: closingState, pathname: '/north/settings/wind-down/' }));
    expect(screen.queryByTestId('closing-banner')).toBeNull();
  });
});

describe('the refusals (K-R)', () => {
  it('reads the host codes on a 403 only', () => {
    const screens = createClosingScreens(closingConfig(hostState()));
    expect(screens.closingRefusalOf(answered(403, 'x', { code: 'WARD_SHUT' }))).toBe('closed');
    expect(screens.closingRefusalOf(answered(403, 'x', { code: 'WARD_WINDING_DOWN' }))).toBe('closing');
    expect(screens.closingRefusalOf(answered(403, 'x', { code: 'WARD_READ_ONLY' }))).toBe('readOnly');
    expect(screens.closingRefusalOf(answered(409, 'x', { code: 'WARD_SHUT' }))).toBeNull();
    expect(screens.closingRefusalOf(answered(403, 'x', { code: 'OTHER' }))).toBeNull();
    expect(screens.closingRefusalOf(new Error('offline'))).toBeNull();
  });

  it('raises one read-only toast with the way to the close page under the host paths (K-R2)', () => {
    const toast = vi.fn();
    const screens = createClosingScreens(closingConfig(hostState(), toast));
    window.history.pushState({}, '', '/console/north/wards');
    screens.interceptReadOnly(answered(403, 'read only now', { code: 'WARD_READ_ONLY' }), { seeClosing: '«h.seeClosing»' });
    screens.interceptReadOnly(answered(403, 'other', { code: 'WARD_SHUT' }), { seeClosing: '«h.seeClosing»' });
    expect(toast).toHaveBeenCalledTimes(1);
    const [message, options] = toast.mock.calls[0] as [string, { id: string; testId: string; actions: { label: string }[] }];
    expect(message).toBe('read only now');
    expect(options).toMatchObject({ id: 'ward-read-only', severity: 'warning', testId: 'ward-read-only-toast', duration: 8000 });
    expect(options.actions[0]?.label).toBe('«h.seeClosing»');
    expect(screens.closePagePath('north')).toBe('/console/north/settings/wind-down');
  });

  it("watches the app's own writes once, reading a clone (K-R2)", async () => {
    const toast = vi.fn();
    const screens = createClosingScreens(closingConfig(hostState(), toast));
    const body = JSON.stringify({ code: 'WARD_READ_ONLY', error: 'read only now' });
    const fetchMock = vi.fn(async () => {
      const response = new Response(body, { status: 403 });
      Object.defineProperty(response, 'url', { value: 'http://x/api/console/north/beds' });
      return response;
    });
    window.fetch = fetchMock as unknown as typeof window.fetch;
    screens.watchReadOnlyWrites(() => ({ seeClosing: '«h.seeClosing»' }));
    screens.watchReadOnlyWrites(() => ({ seeClosing: '«h.seeClosing»' }));
    const response = await act(async () => window.fetch('/api/console/north/beds', { method: 'POST' }));
    expect(await response.json()).toEqual({ code: 'WARD_READ_ONLY', error: 'read only now' });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    await window.fetch('/api/console/north/beds');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('sends a member to the one other tenant, the picker, or signs out (K-R3)', () => {
    const screens = createClosingScreens(closingConfig(hostState()));
    expect(screens.switchTarget(['south'])).toBe('/console/south');
    expect(screens.switchTarget(['south', 'east'])).toBe('/console/');
    expect(screens.switchTarget([])).toBeNull();
    const onSignOut = vi.fn();
    render(<screens.TenantGoneScreen refusal="closed" otherSlugs={[]} onSignOut={onSignOut} copy={copy} />);
    expect(screen.getByTestId('ward-gone-screen').textContent).toContain('«h.refusedClosedTitle»');
    fireEvent.click(screen.getByRole('button', { name: '«h.signOut»' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expectOnlyPackWords();
    cleanup();
    render(<screens.TenantGoneScreen refusal="closing" otherSlugs={['south']} onSignOut={onSignOut} copy={copy} />);
    expect(screen.getByTestId('ward-gone-screen').textContent).toContain('«h.refusedClosingBody»');
    expect(screen.getByRole('button', { name: '«h.switchTenant»' })).toBeTruthy();
  });
});
