/**
 * Every sentence this API answers with, as REQUIRED host config (FUT-760).
 *
 * The routes used to hold their own pt-BR — a 403's wording, the four ways a
 * period can be wrong, the name collision a save reports. That made the origin
 * host's Portuguese every adopter's silent default, and there was no field to
 * decline it with. `PT_BR_REPORT_SERVER_MESSAGES` is that exact wording, now
 * named at the mount.
 *
 * These reach a person: the builder shows a 400 beside the field that caused
 * it, so they are product copy, not developer strings.
 */

/** The refusals a period can earn, on the way in and on the way through. */
export interface ReportRangeMessages {
  /** `custom` arrived without both ends. */
  datesRequired: string;
  /** A date that does not parse. */
  invalidDate: string;
  /** The window closes before it opens. */
  endBeforeStart: string;
  /**
   * The window is longer than the server allows. Interpolated rather than
   * fixed so a host that raises the cap cannot end up naming the old number —
   * the commonest way this kind of copy goes stale.
   */
  tooLong(maxDays: number): string;
  /** A date field whose shape is wrong before it is even parsed. */
  isoFormat: string;
  /** `preset: 'custom'` with no `from`/`to` pair. */
  customNeedsBothDates: string;
}

export interface ReportServerMessages {
  /** 401 — the host resolved no actor for the request. */
  unauthenticated: string;
  /** 403 — an actor the host's own forbidden error refuses. */
  forbidden: string;
  /** 404 — no report under that id or key. */
  notFound: string;
  /** 400 — a body that failed schema validation with no field to blame. */
  invalidBody: string;
  /** 403 on the three authoring verbs, which a host may word separately. */
  forbiddenCreate: string;
  forbiddenEdit: string;
  forbiddenDelete: string;
  /** 409-shaped: the tenant already has a report under that name. */
  duplicateName: string;
  /** 400: a save arrived with a blank name. */
  nameRequired: string;
  /** 400: only a PUBLISHED report keeps unpublished changes. */
  publishedOnlyKeepsDraft: string;
  /** 404-shaped: nothing unpublished to read, discard or publish. */
  noWorkingCopy: string;
  range: ReportRangeMessages;
}
