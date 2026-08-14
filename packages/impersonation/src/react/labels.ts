import type { ImpersonationBannerState, ImpersonationUser } from '../core/types';

/**
 * Every word this surface puts on a screen, as a REQUIRED config object.
 *
 * The package owns which sentence appears when — that branch is the mechanism,
 * and it is stated once here rather than re-derived by every host. What it does
 * NOT own is the sentences themselves: product copy is application-specific, its
 * language included, so a default would hand a second host another product's
 * voice, silently, in the one place a user reads.
 *
 * Each entry takes the parts it needs as a named bag rather than positional
 * arguments, so a host writing the string can see what it is interpolating and
 * an added part is a compile error rather than a silently dropped value.
 */

export interface ImpersonationBannerLabels {
  /** `aria-label` on the bar's landmark region. */
  regionLabel: string;
  /**
   * An operator session's headline. `tenant` is `null` when the server could not
   * resolve one.
   *
   * The verb matters and is why this is not one function with the two below: an
   * operator is ACTING AS a real person, with that person's own permissions and
   * their name on the screen. A preview is somebody looking at their own tenant
   * through a narrower lens. The difference is the one an operator has to feel
   * in the half-second they spend reading this bar.
   */
  actingAs(parts: { subject: string; tenant: string | null }): string;
  /** A role preview's headline. `role` is the raw role name the server minted. */
  previewingRole(parts: { role: string }): string;
  /** A member preview's headline. */
  previewingMember(parts: { subject: string }): string;
  /**
   * How to name a subject the server could not resolve at all — a deleted
   * account mid-session. The last resort, after the name and the e-mail.
   */
  unknownSubject: string;
  /** The chip stating the session may change nothing. */
  readOnly: string;
  /** The countdown chip. `formatted` is `mm:ss`, or `h:mm:ss` past an hour. */
  remaining(parts: { formatted: string }): string;
  /** The headline once the time box has closed. */
  expired: string;
  /** The countdown chip once the time box has closed. */
  timeUp: string;
  /** Shown when a session is held but the last read did not come back. */
  unconfirmed: string;
  /** Shown when pressing the exit failed. */
  exitFailed: string;
  /** The exit button. */
  exit: string;
}

export interface ImpersonationDialogLabels {
  /** The dialog's own title. */
  title(parts: { target: string }): string;
  /** The standing warning above the form. */
  notice: { title: string; description: string };
  tenantField: {
    label: string;
    placeholder: string;
    helper: string;
    /** Shown instead of `helper` when the tenant list could not be loaded. */
    error: string;
  };
  appField: {
    label: string;
    /** Said when the subject IS on this tenant's staff roster. */
    onStaff: string;
    /** Said when they are not — which is silence about any other membership. */
    notOnStaff: string;
  };
  reasonField: { label: string; helper(parts: { min: number }): string };
  /**
   * The read-only default, stated whether or not writes can be asked for.
   *
   * Said out loud even where there is no opt-in to explain: someone about to act
   * as another person should not have to infer from an absent control that
   * nothing they click can change anything.
   */
  readOnlyNote: { writable: string; alwaysReadOnly: string };
  writeOptIn: {
    label: string;
    description: string;
    warningTitle: string;
    warningDescription: string;
    reasonLabel: string;
    reasonHelper(parts: { min: number }): string;
  };
  /** The first unmet rule, shown under the disabled confirm button. */
  blockers: {
    tenantMissing: string;
    writesUnavailable: string;
    reasonTooShort(parts: { min: number }): string;
    writeReasonTooShort(parts: { min: number }): string;
    reasonTooLong(parts: { length: number; max: number }): string;
  };
  /**
   * The single justification string that reaches the trail.
   *
   * The endpoint takes ONE reason, and a write opt-in answers a different
   * question ("why must this be more than a look?"). Rather than send the second
   * justification nowhere, the host joins them — so the record reads as the
   * operator wrote it and a reviewer can see which half was which.
   */
  composeReason(parts: { reason: string; writeReason: string }): string;
  cancel: string;
  confirm: string;
  /** The confirm button while the start is in flight. */
  confirmPending: string;
  errorTitle: string;
  /**
   * What to say for a failed start when the server sent no sentence of its own.
   *
   * The server's message is always PREFERRED when there is one: it already
   * wrote the refusal in the operator's terms, and re-deriving those sentences
   * from a status code would mean two wordings of one rule, with the copy that
   * reaches the screen being the one that never saw the refusal. These are for
   * the answers that carry no body — a proxy 502, a 401 from the session
   * expiring mid-form, an offline fetch.
   */
  failure: {
    unauthenticated: string;
    forbidden: string;
    notFound: string;
    generic: string;
  };
}

export interface ImpersonationLabels {
  banner: ImpersonationBannerLabels;
  /** Required only when {@link ImpersonationWebConfig.dialog} is configured. */
  dialog?: ImpersonationDialogLabels;
}

/**
 * How to name the person being acted as.
 *
 * The e-mail is the fallback rather than a generic noun: an operator who cannot
 * tell WHICH account they are inside has a banner that meets the letter of the
 * requirement and none of its point.
 */
function subjectLabel(
  subject: ImpersonationUser | null | undefined,
  labels: Pick<ImpersonationBannerLabels, 'unknownSubject'>,
): string {
  if (!subject) return labels.unknownSubject;
  return subject.name?.trim() || subject.email || labels.unknownSubject;
}

/** The headline sentence: who this session is acting as. */
export function impersonationHeadline(
  state: ImpersonationBannerState,
  labels: ImpersonationBannerLabels,
): string {
  const subject = subjectLabel(state.subject, labels);
  if (state.kind === 'operator') {
    return labels.actingAs({ subject, tenant: state.tenant?.name ?? null });
  }
  if (state.previewRoleName) {
    return labels.previewingRole({ role: state.previewRoleName });
  }
  return labels.previewingMember({ subject });
}

/**
 * The tenant this session is confined to, for the kind whose headline does not
 * already name it.
 *
 * A preview always states it, because "previewing as WAITER" alone says nothing
 * about WHERE, and someone with several tenants can otherwise read the wrong
 * screen as the right one.
 */
export function tenantChip(state: ImpersonationBannerState): string | null {
  if (state.kind === 'operator' || !state.tenant) return null;
  return state.tenant.name;
}
