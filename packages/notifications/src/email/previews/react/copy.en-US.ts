import type { EmailPreviewScreenCopy } from './copy';

/** US English — the twin that makes {@link PT_BR_EMAIL_PREVIEW_COPY} a choice. */
export const EN_US_EMAIL_PREVIEW_COPY: EmailPreviewScreenCopy = {
  title: 'Email previews',
  description: 'Every email this system sends, grouped by the package that owns it. Nothing is sent from here.',
  searchLabel: 'Filter',
  searchPlaceholder: 'subject, event or package',
  noMatches: 'No message matches the filter.',
  pickOne: 'Pick a message from the list to see its preview.',
  tabHtml: 'HTML',
  tabText: 'Text',
  tabSource: 'Source',
  widthDesktop: 'Desktop',
  widthMobile: 'Mobile',
  subjectLabel: 'Subject',
  frameTitle: 'Email preview',
  coverageTitle: 'Incomplete coverage',
  missingSamples: (keys) => `No sample data, so no preview: ${keys}.`,
  orphanSamples: (keys) => `A sample exists but nothing produces this message any more: ${keys}.`,
  loading: 'Loading...',
  loadError: 'The previews could not be loaded.',
  retry: 'Try again',
};
