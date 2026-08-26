// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ImpersonationTenant } from '../core/types';
import { createWebImpersonation } from '../react/create-web-impersonation';
import {
  reviewDraft,
  toStartBody,
  writesAvailableFor,
  type DialogRules,
  type ImpersonationDraft,
} from '../react/dialog-form';
import type { ImpersonationDialogLabels, ImpersonationLabels } from '../react/labels';
import { ImpersonationHttpError, type ImpersonationTransport } from '../react/transport';

/**
 * The start dialog: the rules that decide whether a draft may be sent, and the
 * screen that carries them.
 *
 * The two things worth driving a rendered dialog for are the ones a rules test
 * cannot prove: that a refusal from the SERVER reaches the screen in the
 * server's own words with the dialog still open, and that a start behind no
 * banner does not happen at all.
 */

// The dialog tests wait on a dynamic import, and `dialogOnScreen` below spends
// up to 10s of that waiting. Vitest's DEFAULT test budget is 5s, so before this
// the inner wait was as long as the whole test — leaving nothing for mounting
// or asserting, and making the helper's promise ("a dialog that never renders
// still fails this, five seconds later") impossible to keep: the TEST expired
// first, with `Test timed out in 5000ms` and no word about the dialog. CI hit
// exactly that at 5057ms while this machine renders in ~1.6s.
//
// The outer budget must therefore exceed the inner wait, not equal it. Same
// mechanism as packages/discounts' migration suite, and only the patience
// changes — a dialog that never renders still fails, now with the assertion
// that says so.
vi.setConfig({ testTimeout: 20_000 });

const DIALOG_LABELS: ImpersonationDialogLabels = {
  title: ({ target }) => `Open a desk session for ${target}`,
  notice: {
    title: 'You will be working as this person',
    description: 'The session is logged against your name and closes by itself.',
  },
  tenantField: {
    label: 'Branch',
    placeholder: 'Choose the branch',
    helper: 'The session is limited to this branch.',
    error: 'Could not load the branches.',
  },
  appField: {
    label: 'Where',
    onStaff: 'This person works at this branch.',
    notOnStaff: 'This person does not work at this branch.',
  },
  reasonField: {
    label: 'Reason (required)',
    helper: ({ min }) => `At least ${min} characters. It is logged.`,
  },
  readOnlyNote: {
    writable: 'By default the session can only look.',
    alwaysReadOnly: 'The catalogue view can only ever look.',
  },
  writeOptIn: {
    label: 'Allow changes',
    description: 'By default the session can only look.',
    warningTitle: 'You will be changing real records',
    warningDescription: 'Everything you save is logged against your name.',
    reasonLabel: 'Why must you change something?',
    reasonHelper: ({ min }) => `At least ${min} characters.`,
  },
  blockers: {
    tenantMissing: 'Choose the branch this session applies to.',
    writesUnavailable: 'The catalogue view can never be opened with changes.',
    reasonTooShort: ({ min }) => `Describe the reason in at least ${min} characters.`,
    writeReasonTooShort: ({ min }) => `Justify the change in at least ${min} characters.`,
    reasonTooLong: ({ length, max }) => `The reason is ${length} characters; the limit is ${max}.`,
  },
  composeReason: ({ reason, writeReason }) => `${reason} — Changes allowed: ${writeReason}`,
  cancel: 'Cancel',
  confirm: 'Open the desk session',
  confirmPending: 'Opening…',
  errorTitle: 'Could not open the desk session',
  failure: {
    unauthenticated: 'Your sign-in expired. Sign in again.',
    forbidden: 'Desk sessions are for library staff.',
    notFound: 'Borrower or branch not found.',
    generic: 'Could not open it. Try again shortly.',
  },
};

const LABELS: ImpersonationLabels = {
  banner: {
    regionLabel: 'Desk session',
    actingAs: ({ subject }) => `At the desk as ${subject}`,
    previewingRole: ({ role }) => `Looking as a ${role}`,
    previewingMember: ({ subject }) => `Looking as ${subject}`,
    unknownSubject: 'someone',
    readOnly: 'Look only',
    remaining: ({ formatted }) => `Closes in ${formatted}`,
    expired: 'The desk session has closed',
    timeUp: 'Time is up',
    unconfirmed: 'Could not confirm the desk session',
    exitFailed: 'Could not close it. Try again.',
    exit: 'Close the desk session',
  },
  dialog: DIALOG_LABELS,
};

const RULES: DialogRules = {
  writableApps: ['counter'],
  reasonLength: { min: 15, max: 60 },
  labels: DIALOG_LABELS,
};

const BRANCH: ImpersonationTenant = { id: 'branch-north', slug: 'north', name: 'North Branch' };
const BORROWER = { id: 'borrower', email: 'borrower@library.test', name: 'Ada' };

function draft(overrides: Partial<ImpersonationDraft> = {}): ImpersonationDraft {
  return {
    tenantId: BRANCH.id,
    targetApp: 'counter',
    reason: 'card reported not scanning',
    allowWrites: false,
    writeReason: '',
    ...overrides,
  };
}

describe('the draft rules — first unmet rule wins', () => {
  it('blocks on the tenant before it blocks on the reason', () => {
    expect(reviewDraft(draft({ tenantId: '', reason: '' }), RULES).blocker).toBe(
      DIALOG_LABELS.blockers.tenantMissing,
    );
  });

  it('blocks a reason shorter than the server would take', () => {
    expect(reviewDraft(draft({ reason: 'card' }), RULES).blocker).toBe(
      'Describe the reason in at least 15 characters.',
    );
  });

  it('refuses writes for an app the host never marked writable — even assembled by hand', () => {
    expect(writesAvailableFor('catalogue', RULES)).toBe(false);
    expect(
      reviewDraft(draft({ targetApp: 'catalogue', allowWrites: true }), RULES).blocker,
    ).toBe(DIALOG_LABELS.blockers.writesUnavailable);
    // …and the body that would be sent carries `false`, not the draft's `true`.
    expect(
      toStartBody(draft({ targetApp: 'catalogue', allowWrites: true }), 'borrower', 'x', RULES)
        .allowWrites,
    ).toBe(false);
  });

  it('demands a SEPARATE justification for the write opt-in', () => {
    expect(reviewDraft(draft({ allowWrites: true }), RULES).blocker).toBe(
      'Justify the change in at least 15 characters.',
    );
  });

  it('length-checks the JOINED string, because that is what the server validates', () => {
    const review = reviewDraft(
      draft({ allowWrites: true, writeReason: 'the record is stuck open' }),
      RULES,
    );
    expect(review.reason).toBe(
      'card reported not scanning — Changes allowed: the record is stuck open',
    );
    expect(review.blocker).toBe('The reason is 70 characters; the limit is 60.');
  });

  it('sends the reviewed string, not a freshly recomposed one', () => {
    const review = reviewDraft(draft(), RULES);
    expect(review.blocker).toBeNull();
    expect(toStartBody(draft(), 'borrower', review.reason, RULES)).toEqual({
      targetUserId: 'borrower',
      targetApp: 'counter',
      tenantId: BRANCH.id,
      reason: 'card reported not scanning',
      allowWrites: false,
    });
  });
});

/* ── the rendered dialog ─────────────────────────────────────────────────── */

interface MountOptions {
  /** What `POST` answers with, or the error it throws. */
  onStart?: () => unknown;
  /** Whether a banner is mounted in this document. */
  withBanner?: boolean;
}

function mountDialog(options: MountOptions = {}) {
  const requested: { path: string; method: string; body?: unknown }[] = [];
  const transport: ImpersonationTransport = {
    async request(path, init) {
      const method = init?.method ?? 'GET';
      requested.push({ path, method, body: init?.body });
      if (method === 'POST') return options.onStart?.() ?? { data: { active: true } };
      if (method === 'GET') return { data: { active: false } };
      return { data: { ended: true } };
    },
  };

  const surface = createWebImpersonation({
    platformPath: '/desk/session',
    tenantPath: (slug) => `/branches/${slug}/desk/session`,
    transport,
    labels: LABELS,
    dialog: {
      apps: [
        { value: 'counter', label: 'Counter' },
        { value: 'catalogue', label: 'Public catalogue' },
      ],
      writableApps: ['counter'],
      reasonLength: { min: 15, max: 400 },
      loadTenants: async () => [BRANCH],
      landingUrl: ({ tenantSlug }) => `/branches/${tenantSlug}`,
    },
  });

  const Dialog = surface.dialog;
  if (!Dialog) throw new Error('the dialog was configured, so it must exist');
  const Banner = surface.banner;
  const onClose = vi.fn();

  render(
    <>
      {options.withBanner === false ? null : <Banner />}
      <Dialog target={BORROWER} tenant={BRANCH} app="counter" onClose={onClose} />
    </>,
  );

  // Returned as a QUERY rather than as the array itself: a spec holding the
  // list would be holding mutable state across its own assertions.
  return { posted: () => requested.filter((call) => call.method === 'POST'), onClose };
}

/**
 * Wait for the dialog to be ON SCREEN, allowing for the chunk it now arrives in.
 *
 * The dialog is loaded on demand, so this wait covers a dynamic import as well
 * as a render — and `waitFor`'s 1000ms default was tuned for the render alone.
 * Measured: the first case takes ~550ms here against ~256ms before the boundary,
 * which passes on a developer's machine and FAILED on a loaded CI runner at
 * 1206ms. A budget that depends on how busy the runner is belongs to nobody.
 *
 * The assertion is unchanged — only the patience. A dialog that never renders
 * still fails this, ten seconds later — which needs the file's `testTimeout`
 * above to be LARGER than this wait, or the test expires first and reports a
 * bare timeout instead of the assertion. CI was measured at 5057ms against the
 * default 5s test budget, i.e. the dialog arriving in roughly the time this
 * wait allowed and no time left to prove it.
 *
 * Warming the module in `beforeAll` was measured first and is NOT the fix here:
 * it moved nothing (549ms from a cold Vite cache, 543ms warmed), because what
 * this pays for is the Suspense round trip rather than a transform. It IS the
 * fix in `@12-apps/app-shell`, whose surface is a heavier transform — same
 * boundary, different cost, so a different remedy.
 */
async function dialogOnScreen(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('impersonation-dialog')).toBeTruthy(), {
    timeout: 10_000,
  });
}

describe('the rendered dialog', () => {
  it('will not send until the reason is long enough, and says which rule blocks', async () => {
    mountDialog();
    await dialogOnScreen();

    const confirm = screen.getByTestId('impersonation-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByTestId('impersonation-blocker').textContent).toBe(
      'Describe the reason in at least 15 characters.',
    );
    // The read-only default is stated before anything starts.
    expect(screen.getByTestId('impersonation-readonly-note').textContent).toBe(
      'By default the session can only look.',
    );
  });

  it("surfaces the SERVER's own refusal and leaves the dialog open", async () => {
    const refusal = new ImpersonationHttpError(403, {
      error: 'A system librarian may not be opened from the desk.',
    });
    const { posted, onClose } = mountDialog({
      onStart: () => {
        throw refusal;
      },
    });
    await dialogOnScreen();

    await act(async () => {
      fill(screen.getByTestId('impersonation-reason'), 'card reported not scanning');
    });
    await waitFor(() =>
      expect((screen.getByTestId('impersonation-confirm') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('impersonation-confirm'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('impersonation-error').textContent).toContain(
        'A system librarian may not be opened from the desk.',
      ),
    );
    expect(screen.getByTestId('impersonation-dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(posted()).toHaveLength(1);
  });

  it('DOES NOT START AT ALL when no banner is mounted in this document', async () => {
    const { posted, onClose } = mountDialog({ withBanner: false });
    await dialogOnScreen();

    await act(async () => {
      fill(screen.getByTestId('impersonation-reason'), 'card reported not scanning');
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('impersonation-confirm'));
    });

    await waitFor(() => expect(screen.getByTestId('impersonation-error')).toBeTruthy());
    // No request was made. "If the banner cannot render, the session must not
    // start" is a precondition, not a message.
    expect(posted()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Set a controlled input's value the way React sees it.
 *
 * Assigning `.value` bypasses React's own setter, so the component never
 * re-renders and the assertion below would be about the DOM rather than about
 * the form.
 */
function fill(field: HTMLElement, value: string): void {
  // The test id may sit on the control itself or on the wrapper around it,
  // depending on the design system's own markup — both are addressed.
  const input =
    field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
      ? field
      : field.querySelector('textarea, input');
  if (!(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)) {
    throw new Error('no editable control inside that field');
  }
  const prototype = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
