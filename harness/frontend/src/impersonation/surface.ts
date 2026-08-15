import { createWebImpersonation } from '@12-apps/impersonation/react';
import type { ImpersonationTenant } from '@12-apps/impersonation';

/**
 * The whole wiring a frontend host performs for `@12-apps/impersonation`.
 *
 * Everything the browser half IS — the bar, its countdown, the chrome offset,
 * the wake-up handling, the exit's ordering, the start handshake and the start
 * dialog — lives inside the package. This file says where the API is mounted,
 * hands over the host's own words, and says what to do when a session ends.
 *
 * ONE surface for the whole app, exported rather than created per component,
 * because the banner must be mounted ONCE in the chrome while the dialog is
 * opened from a page — and both halves have to be the same wiring or the start
 * handshake would be waiting on a banner bound to a different transport.
 *
 * There is no `transport`, deliberately: the package's default is a same-origin
 * credentialed fetch, Vite proxies `/api` to `harness/backend`, and so every
 * click below crosses a real socket into the package's own Hono mount — the
 * arrangement a real consumer has. The credentialed part is not incidental: the
 * whole mechanism is a cookie.
 */

/** Where the harness backend mounted the two halves (`impersonation-host.ts`). */
const PLATFORM_PATH = '/api/desk-session';
const tenantPath = (slug: string): string => `/api/admin/${slug}/desk-session`;

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

export const impersonation = createWebImpersonation({
  platformPath: PLATFORM_PATH,
  tenantPath,
  /**
   * What a host does when a session ends, however it ended.
   *
   * A real adopter drops its query cache here — the identity behind every cached
   * response just changed. The harness has no cache, so it records the fact
   * where a spec can read it, which is the same claim in a form a browser can
   * assert.
   */
  onEnd: () => {
    window.dispatchEvent(new CustomEvent('harness:impersonation-ended'));
  },
  onSessionChange: (session) => {
    document.documentElement.dataset.impersonating = String(session.impersonating);
    document.documentElement.dataset.impersonatedTenant = session.tenantSlug ?? '';
  },
  labels: {
    banner: {
      regionLabel: 'Desk session',
      actingAs: ({ subject, tenant }) =>
        tenant ? `At the desk as ${subject} (${tenant})` : `At the desk as ${subject}`,
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
    dialog: {
      title: ({ target }) => `Open a desk session for ${target}`,
      notice: {
        title: 'You will be working as this person',
        description:
          'The session lasts 30 minutes at most, applies to one branch only, and is logged against your name.',
      },
      tenantField: {
        label: 'Branch',
        placeholder: 'Choose the branch',
        helper: 'The session is limited to this branch.',
        error: 'Could not load the branches.',
      },
      appField: {
        label: 'Where',
        onStaff: 'This person works at this branch — the counter opens with their reach.',
        notOnStaff:
          'This person does not work at this branch. To see what they see, choose the catalogue.',
      },
      reasonField: {
        label: 'Reason (required)',
        helper: ({ min }) => `At least ${min} characters. It is written to the log.`,
      },
      readOnlyNote: {
        writable:
          'By default the session can only look. Loans and fines stay blocked either way.',
        alwaysReadOnly:
          'The catalogue view can only ever look: nothing can be changed and nothing can be borrowed in this person’s name.',
      },
      writeOptIn: {
        label: 'Allow changes',
        description: 'By default the session can only look.',
        warningTitle: 'You will be changing real records',
        warningDescription:
          'Everything you save changes the branch and is logged against your name. Loans and fines stay blocked in any case.',
        reasonLabel: 'Why must you change something?',
        reasonHelper: ({ min }) => `At least ${min} characters. It goes into the same log entry.`,
      },
      blockers: {
        tenantMissing: 'Choose the branch this session applies to.',
        writesUnavailable: 'The catalogue view can never be opened with changes.',
        reasonTooShort: ({ min }) =>
          `Describe the reason in at least ${min} characters — it is written to the log.`,
        writeReasonTooShort: ({ min }) =>
          `Justify allowing changes in at least ${min} characters.`,
        reasonTooLong: ({ length, max }) =>
          `The reason came to ${length} characters; the limit is ${max}.`,
      },
      composeReason: ({ reason, writeReason }) =>
        `${reason} — Changes allowed: ${writeReason}`,
      cancel: 'Cancel',
      confirm: 'Open the desk session',
      confirmPending: 'Opening…',
      errorTitle: 'Could not open the desk session',
      failure: {
        unauthenticated: 'Your sign-in expired. Sign in again and retry.',
        forbidden: 'Desk sessions are for library staff.',
        notFound: 'Borrower or branch not found.',
        generic: 'Could not open it. Try again shortly.',
      },
    },
  },
  dialog: {
    apps: [
      { value: 'counter', label: 'Staff counter' },
      { value: 'catalogue', label: 'Public catalogue' },
    ],
    // A borrower is never opened with changes: the money rule already refuses
    // every loan and fine, but a catalogue session with writes could still edit
    // that person's own record, and nobody helping a borrower needs that.
    writableApps: ['counter'],
    reasonLength: { min: 15, max: 280 },
    loadTenants: () => json<ImpersonationTenant[]>('/__harness/impersonation/branches'),
    loadStaff: (slug) => json<string[]>(`/__harness/impersonation/staff/${slug}`),
    landingUrl: ({ tenantSlug }) => `#/impersonation?branch=${tenantSlug}`,
  },
});
