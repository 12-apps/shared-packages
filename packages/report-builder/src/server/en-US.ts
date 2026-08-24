import type { BlankBlockTemplateCopy } from './block-templates';
import type { ReportServerMessages } from './messages';

/**
 * The en-US pack for the API half — a NAMED constant a host passes by hand
 * (`messages: EN_US_REPORT_SERVER_MESSAGES`), never a default.
 */
export const EN_US_REPORT_SERVER_MESSAGES: ReportServerMessages = {
  unauthenticated: 'Not authenticated.',
  forbidden: 'Access denied.',
  notFound: 'Report not found.',
  invalidBody: 'Invalid body.',
  forbiddenCreate: 'You do not have permission to create reports.',
  forbiddenEdit: 'You do not have permission to edit reports.',
  forbiddenDelete: 'You do not have permission to delete reports.',
  duplicateName: 'A report with that name already exists.',
  // The `name:` prefix is the FIELD the error belongs to, not a word: the
  // surface splits on it to paint the offending input. Translating or dropping
  // it turns a field error into an anonymous banner.
  nameRequired: 'name: Give the report a name.',
  publishedOnlyKeepsDraft:
    'Only a published report keeps unpublished changes. Save the draft as usual.',
  noWorkingCopy: 'This report has no unpublished changes.',
  range: {
    datesRequired: 'Give the start and end dates of the period.',
    invalidDate: 'Invalid date.',
    endBeforeStart: 'The end date must be the same as or later than the start date.',
    tooLong: (maxDays) => `The period cannot exceed ${maxDays} days.`,
    // The format is the WIRE's: the endpoint parses YYYY-MM-DD whichever
    // language reports the failure.
    isoFormat: 'Use the format YYYY-MM-DD.',
    // `from` and `to` are the QUERY PARAMETER names, not words.
    customNeedsBothDates: 'Give both `from` and `to` for a custom period.',
  },
};

/** The en-US words for the blank block template and the group it sits in. */
export const EN_US_BLANK_BLOCK_TEMPLATE_COPY: BlankBlockTemplateCopy = {
  title: 'Blank block',
  description: 'Choose the data and the measures yourself',
  groupTitle: 'From scratch',
};
