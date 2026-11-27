// @vitest-environment jsdom
/**
 * The platform's archive confirmation and card against the prototype contract
 * (FUT-5639, Part 1): each C, E, L and R line the package owns has a case
 * here, named by its id. The words are a hospital host's pack: none is the
 * package's (the T lines are the host's copy).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlatformArchive, type TenantClosingBlocker, type TenantQuery } from '../lifecycle/react';
import { HOSPITAL_PACK as copy, NAME, deferred, focusOn, pin, platformConfig, query, wordsNotFromPack } from './lifecycle-react-fixtures';

afterEach(cleanup);

const PURGE = '26/12/2026';
const SHORT = '26/12';
const ONE_BLOCKER: TenantClosingBlocker[] = [{ kind: 'admissions', count: 2 }];

interface PanelOptions {
  blockers?: TenantQuery<readonly TenantClosingBlocker[]>;
  onConfirm?: (reason: string) => Promise<void>;
  thePin?: ReturnType<typeof pin>;
}

function panel(options: PanelOptions = {}) {
  const toast = vi.fn();
  const onClose = vi.fn();
  const onConfirm = vi.fn(options.onConfirm ?? (async () => undefined));
  const thePin = options.thePin ?? pin();
  const archive = createPlatformArchive(platformConfig(toast));
  render(
    <archive.ArchivePanel
      open
      name={NAME}
      purgeDay={PURGE}
      purgeShortDay={SHORT}
      blockers={options.blockers ?? query<readonly TenantClosingBlocker[]>([])}
      pin={thePin}
      copy={copy}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { toast, onClose, onConfirm, pin: thePin };
}

const confirm = () => screen.getByTestId('archive-confirm');
const isOff = (node: HTMLElement) => node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';
const reasonField = () => {
  const node = screen.getByTestId('archive-reason');
  return (node instanceof HTMLTextAreaElement ? node : node.querySelector('textarea')) as HTMLTextAreaElement;
};

describe('the archive confirmation', () => {
  it('E5, T: nothing pending — every word from the pack, no count beside the actions', async () => {
    panel();
    expect(screen.getByTestId('archive-panel').getAttribute('aria-label')).toBe(`«h.platformArchiveTitle(${NAME})»`);
    expect(screen.getByTestId('archive-pending-none').textContent).toBe('«h.platformPendingNone»');
    await waitFor(() => expect(screen.queryByTestId('archive-missing')).toBeNull());
    expect(screen.getByTestId('archive-undo').textContent).toBe(`«h.platformUndo(${PURGE})»`);
    expect(screen.getByTestId('archive-fact-email').querySelector('b')?.textContent).toBe(SHORT);
    expect(screen.getByTestId('archive-fact-purge').querySelector('b')?.textContent).toBe(PURGE);
    expect(wordsNotFromPack(document.body.textContent ?? '', [NAME, PURGE, SHORT])).toBe('');
  });

  it('E4, R5: a blocker — read-only rows with the hint, the confirm held, the count beside it', async () => {
    panel({ blockers: query<readonly TenantClosingBlocker[]>(ONE_BLOCKER) });
    const row = screen.getByTestId('archive-blocker-admissions');
    expect(row.textContent).toBe('«h.blocker(admissions|2)»');
    await waitFor(() => expect(row.querySelector('a, button')).toBeNull());
    expect(screen.getByTestId('archive-pending-hint').textContent).toBe('«h.platformPendingHint»');
    fireEvent.change(reasonField(), { target: { value: 'asked by phone' } });
    expect(isOff(confirm())).toBe(true);
    expect(screen.getByTestId('archive-missing').textContent).toBe('«h.missing(1)»');
  });

  it('C5, C6, C7, R6: lit only with a reason of 3+ and the PIN; the reason is capped at 500', () => {
    panel({ thePin: pin({ ready: false }) });
    expect(screen.getByTestId('host-pin').dataset.mode).toBe('enter');
    expect(reasonField().getAttribute('maxlength')).toBe('500');
    fireEvent.change(reasonField(), { target: { value: 'asked' } });
    expect(isOff(confirm())).toBe(true);
    cleanup();
    panel();
    fireEvent.change(reasonField(), { target: { value: ' a ' } });
    expect(isOff(confirm())).toBe(true);
    fireEvent.change(reasonField(), { target: { value: 'asked by phone' } });
    expect(isOff(confirm())).toBe(false);
  });

  it('R8: asks no typed name', () => {
    panel();
    expect(screen.getAllByRole('textbox').filter((box) => box.dataset.testid !== 'host-pin')).toHaveLength(1);
  });

  it('C7, R10: confirms the PIN, sends the trimmed reason, then the toast and the close', async () => {
    const opened = panel();
    fireEvent.change(reasonField(), { target: { value: '  asked by phone  ' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(opened.onConfirm).toHaveBeenCalledWith('asked by phone'));
    expect(opened.pin.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(opened.onClose).toHaveBeenCalledTimes(1));
    expect(opened.toast).toHaveBeenCalledWith(`«h.platformArchivedToast(${NAME})»`, { severity: 'success', testId: 'archive-toast' });
  });

  it('C7: a refused PIN sends nothing', async () => {
    const opened = panel({ thePin: pin({ confirm: vi.fn(async () => false) }) });
    fireEvent.change(reasonField(), { target: { value: 'asked by phone' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(opened.pin.confirm).toHaveBeenCalledTimes(1));
    expect(opened.onConfirm).not.toHaveBeenCalled();
  });

  it("E13: a refusal stays inside the panel, with the server's sentence, and the panel stays open", async () => {
    const opened = panel({ onConfirm: async () => Promise.reject(new Error('blockers recounted')) });
    fireEvent.change(reasonField(), { target: { value: 'asked by phone' } });
    fireEvent.click(confirm());
    const error = await screen.findByTestId('archive-error');
    expect(error.textContent).toContain('blockers recounted');
    expect(screen.getByTestId('archive-panel-body').contains(error)).toBe(true);
    expect(opened.onClose).not.toHaveBeenCalled();
    expect(opened.toast).not.toHaveBeenCalled();
  });

  it('C3, C4, C10: the close button (named by the pack), the way back and the veil close it, sending nothing', () => {
    const opened = panel();
    const close = screen.getByTestId('archive-close');
    expect(close.getAttribute('aria-label')).toBe('«h.closeLabel»');
    fireEvent.click(close);
    fireEvent.click(screen.getByTestId('archive-back'));
    fireEvent.click(screen.getByTestId('host-veil'));
    expect(opened.onClose).toHaveBeenCalledTimes(3);
    expect(opened.onConfirm).not.toHaveBeenCalled();
  });

  it('E16: while the act is with the server, nothing closes it', async () => {
    const gate = deferred();
    const opened = panel({ onConfirm: () => gate.promise });
    fireEvent.change(reasonField(), { target: { value: 'asked by phone' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(opened.onConfirm).toHaveBeenCalledTimes(1));
    expect(isOff(screen.getByTestId('archive-close'))).toBe(true);
    expect(isOff(screen.getByTestId('archive-back'))).toBe(true);
    expect(confirm().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(screen.getByTestId('host-veil'));
    expect(opened.onClose).not.toHaveBeenCalled();
    gate.resolve();
    await waitFor(() => expect(opened.onClose).toHaveBeenCalledTimes(1));
  });

  it('E16: a PIN with the server holds it too', () => {
    const opened = panel({ thePin: pin({ busy: true }) });
    fireEvent.click(screen.getByTestId('host-veil'));
    expect(opened.onClose).not.toHaveBeenCalled();
    expect(isOff(screen.getByTestId('archive-back'))).toBe(true);
  });

  it('E14: blockers loading, then failed with the retry', () => {
    panel({ blockers: query<readonly TenantClosingBlocker[]>(undefined, { isPending: true }) });
    expect(screen.getByTestId('archive-pending-loading')).toBeTruthy();
    expect(isOff(confirm())).toBe(true);
    cleanup();
    const failed = query<readonly TenantClosingBlocker[]>(undefined, { isError: true, error: new Error('down') });
    panel({ blockers: failed });
    fireEvent.click(screen.getByRole('button', { name: '«h.retry»' }));
    expect(failed.refetch).toHaveBeenCalledTimes(1);
  });

  it('L5–L8, L10: title row, a body that is the only scroller, the actions pinned last — verb first, then the way back', () => {
    panel();
    const content = screen.getByTestId('archive-panel-content');
    const body = screen.getByTestId('archive-panel-body');
    const actions = screen.getByTestId('archive-actions');
    expect(content.lastElementChild).toBe(actions);
    expect(body.nextElementSibling).toBe(actions);
    const style = getComputedStyle(body);
    expect(style.overflowY).toBe('auto');
    expect(style.minHeight).toBe('0');
    expect(getComputedStyle(content).flexDirection).toBe('column');
    expect(body.contains(screen.getByTestId('host-pin'))).toBe(true);
    const buttons = Array.from(actions.querySelectorAll('button')).map((button) => button.dataset.testid);
    expect(buttons).toEqual(['archive-confirm', 'archive-back']);
  });

  it('R14: the confirmation is the only red; the way back is the inverted secondary', () => {
    panel();
    expect(confirm().className).toMatch(/colorError/u);
    expect(screen.getByTestId('archive-back').className).not.toMatch(/colorError/u);
    expect(screen.getByTestId('archive-back').dataset.variant).toBe('outline');
  });

  it('opens empty again after it closed', async () => {
    const archive = createPlatformArchive(platformConfig());
    const props = {
      name: NAME,
      purgeDay: PURGE,
      purgeShortDay: SHORT,
      blockers: query<readonly TenantClosingBlocker[]>([]),
      pin: pin(),
      copy,
      onConfirm: vi.fn(async () => undefined),
      onClose: vi.fn(),
    };
    const { rerender } = render(<archive.ArchivePanel open {...props} />);
    fireEvent.change(reasonField(), { target: { value: 'asked by phone' } });
    rerender(<archive.ArchivePanel open={false} {...props} />);
    await waitFor(() => expect(screen.queryByTestId('archive-panel')).toBeNull());
    rerender(<archive.ArchivePanel open {...props} />);
    expect(reasonField().value).toBe('');
  });
});

describe('the archive card', () => {
  function card(overrides: Partial<Parameters<ReturnType<typeof createPlatformArchive>['ArchiveCard']>[0]> = {}) {
    const archive = createPlatformArchive(platformConfig());
    const onArchive = vi.fn();
    const onRestore = vi.fn();
    const utils = render(
      <archive.ArchiveCard
        status="OPEN"
        copy={copy}
        blockers={query<readonly TenantClosingBlocker[]>([])}
        purgeDay={PURGE}
        archived={null}
        canArchive
        canRestore
        onArchive={onArchive}
        onRestore={onRestore}
        {...overrides}
      />,
    );
    return { ...utils, onArchive, onRestore };
  }

  it('E2, C2, R9, R14: open — pending, what happens, and the secondary entry that opens the confirmation', () => {
    const shown = card();
    expect(screen.getByTestId('archive-card').textContent).toContain('«h.platformCardTitle»');
    expect(screen.getByTestId('archive-pending-none')).toBeTruthy();
    expect(screen.getByText('«h.platformCardWhat»')).toBeTruthy();
    expect(screen.getByText(`«h.platformArchiveLead(${PURGE})»`)).toBeTruthy();
    const entry = screen.getByTestId('archive-open');
    expect(entry.dataset.variant).toBe('outline');
    expect(entry.className).not.toMatch(/colorError/u);
    fireEvent.click(entry);
    expect(shown.onArchive).toHaveBeenCalledTimes(1);
    expect(wordsNotFromPack(document.body.textContent ?? '', [PURGE])).toBe('');
  });

  it('E3, D2: open with a blocker — the same read-only rows, and the entry never disabled', () => {
    card({ blockers: query<readonly TenantClosingBlocker[]>(ONE_BLOCKER) });
    expect(screen.getByTestId('archive-blocker-admissions').textContent).toBe('«h.blocker(admissions|2)»');
    expect(isOff(screen.getByTestId('archive-open'))).toBe(false);
  });

  it('E9: a suspended tenant is offered the archive too (closableFrom)', () => {
    card({ status: 'ON_HOLD' });
    expect(screen.getByTestId('archive-open')).toBeTruthy();
  });

  it('E8, C9: archived — who, when (bold) and why, the deletion day (bold), and the restore', async () => {
    const shown = card({
      status: 'WINDING_DOWN',
      archived: { day: '26/11/2026', actor: 'Admin User', byPlatform: true, reason: 'asked by phone' },
    });
    const facts = screen.getByTestId('archive-archived');
    expect(facts.querySelector('b')?.textContent).toBe('26/11/2026');
    expect(facts.textContent).toContain('"actor":"Admin User"');
    expect(facts.textContent).toContain('"byPlatform":true');
    expect(screen.getByTestId('archive-purge').querySelector('b')?.textContent).toBe(PURGE);
    const restore = screen.getByTestId('archive-restore');
    expect(restore.textContent).toBe('«h.platformRestore»');
    fireEvent.click(restore);
    expect(shown.onRestore).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('archive-open')).toBeNull());
  });

  it('Q3: archived by the owner — no actor, not on their behalf', () => {
    card({ status: 'WINDING_DOWN', archived: { day: '26/11/2026', actor: null, byPlatform: false, reason: 'moving' } });
    expect(screen.getByTestId('archive-archived').textContent).toContain('"actor":null,"byPlatform":false');
  });

  it('E10: not approved yet, or purged — no card', async () => {
    card({ status: 'AWAITING_REVIEW' });
    await waitFor(() => expect(screen.queryByTestId('archive-card')).toBeNull());
    cleanup();
    card({ status: 'SHUT' });
    await waitFor(() => expect(screen.queryByTestId('archive-card')).toBeNull());
  });

  describe('B1: focus when the card turns over under the person', () => {
    const ARCHIVED = { day: '26/11/2026', actor: 'Admin User', byPlatform: true, reason: 'asked by phone' };

    function cardAt(status: string, extra: Record<string, unknown> = {}) {
      return (
        <archiveScreens.ArchiveCard
          status={status}
          copy={copy}
          blockers={query<readonly TenantClosingBlocker[]>([])}
          purgeDay={PURGE}
          archived={status === 'WINDING_DOWN' ? ARCHIVED : null}
          canArchive
          canRestore
          onArchive={vi.fn()}
          onRestore={vi.fn()}
          {...extra}
        />
      );
    }
    const archiveScreens = createPlatformArchive(platformConfig());

    const focused = (node: Element) => waitFor(() => expect(document.activeElement).toBe(node));

    it('takes no focus on its first render', async () => {
      render(cardAt('OPEN'));
      await focused(document.body);
    });

    it('archive → archived: focus goes to who archived it, not to <body>', async () => {
      const { rerender } = render(cardAt('OPEN'));
      await focusOn(screen.getByTestId('archive-open'));
      rerender(cardAt('WINDING_DOWN'));
      await focused(screen.getByTestId('archive-archived'));
    });

    it('restored → open without the archive permission: focus goes to the card itself', async () => {
      const { rerender } = render(cardAt('WINDING_DOWN'));
      await focusOn(screen.getByTestId('archive-restore'));
      rerender(cardAt('ON_HOLD', { canArchive: false }));
      await focused(screen.getByTestId('archive-card'));
    });

    describe('over the watch that follows the change', () => {
      // Only the watch's own clock (an interval) is faked: Testing Library and the button's ripple keep real timeouts.
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      });
      afterEach(async () => {
        // Run the watch out, inside act, before the real clock is back.
        await act(async () => {
          vi.runAllTimers();
        });
        vi.useRealTimers();
      });

      const withField = (status: string) => (
        <>
          {cardAt(status)}
          <input data-testid="field" />
        </>
      );
      async function advance(ms: number): Promise<void> {
        await act(async () => {
          vi.advanceTimersByTime(ms);
        });
      }

      it('archived → archive: an overlay still open keeps focus, and when it closes after the change focus comes here', async () => {
        const { rerender } = render(withField('WINDING_DOWN'));
        await focusOn(screen.getByTestId('field'));
        rerender(withField('OPEN'));
        await advance(100);
        // The overlay is still open: its field keeps focus.
        await focused(screen.getByTestId('field'));
        // Then it closes and drops focus to <body>; the watch sends it to the new entry.
        rerender(cardAt('OPEN'));
        await focused(document.body);
        await advance(50);
        await focused(screen.getByTestId('archive-open'));
      });

      it('a re-read the person did not cause never takes focus from the field they are typing in', async () => {
        const { rerender } = render(withField('OPEN'));
        await focusOn(screen.getByTestId('field'));
        rerender(withField('WINDING_DOWN'));
        await advance(1_200);
        await focused(screen.getByTestId('field'));
      });

      it('never takes a focus the person moved elsewhere after the change', async () => {
        const { rerender } = render(cardAt('OPEN'));
        rerender(withField('WINDING_DOWN'));
        await focusOn(screen.getByTestId('field'));
        await advance(1_200);
        await focused(screen.getByTestId('field'));
      });
    });
  });

  it('E11: without the permissions, the facts stay and the buttons go', async () => {
    card({ canArchive: false });
    expect(screen.getByTestId('archive-pending-none')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('archive-open')).toBeNull());
    cleanup();
    card({ status: 'WINDING_DOWN', canRestore: false, archived: { day: 'd', actor: 'a', byPlatform: true, reason: 'r' } });
    expect(screen.getByTestId('archive-purge')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('archive-restore')).toBeNull());
  });
});
