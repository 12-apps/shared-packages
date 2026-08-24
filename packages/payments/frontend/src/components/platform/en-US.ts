import type { PlatformHomologacaoCopy } from './copy';

/**
 * The en-US pack for the platform's homologação screens.
 *
 * A NAMED pack, which is how this repo ships a language: a host imports it and
 * passes it by hand.
 *
 * ## What is translated here, and what is not
 *
 * These screens are read by the platform OPERATOR filling PagBank's form, and
 * that is what the words are for — so the instructions, headings and statuses
 * are English here.
 *
 * What stays is everything the operator has to MATCH against PagBank's own
 * surfaces: `redirect_uri` is the parameter name in the API response, "SIP" and
 * "Pipefy" are the names of the systems they will open, `ACCESS_DENIED` is the
 * error string they are quoting in the ticket, and "homologação" is what
 * PagBank calls the process — an operator searching support for
 * "homologation" finds nothing.
 *
 * The ANSWERS the form is filled with are a different matter and are not here
 * at all: they live in `@12-apps/payments-backend`'s `PT_BR_HOMOLOGACAO_ANSWERS`
 * and stay Portuguese, because a PagBank reviewer reads them and several are
 * multiple-choice options on the form itself.
 */
export const EN_US_PLATFORM_HOMOLOGACAO_COPY: PlatformHomologacaoCopy = {
  outcome: {
    heading: 'Homologação status',
    statusLabel: 'Status',
    notSubmitted: 'Not submitted',
    protocolLabel: 'Protocol',
    protocolPlaceholder: 'Protocol (Pipefy card / ticket)',
    notesLabel: 'Notes',
    notesPlaceholder: "Notes (PagBank's reply, context…)",
    save: 'Record',
    saved: 'Record updated.',
    // The KEYS are the stored status values, not words.
    statuses: { SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected' },
    // Three fragments the screen concatenates into one line, so the first two
    // keep their trailing space and the last one ends the sentence.
    submittedAt: (when) => `Submitted ${when}. `,
    decidedAt: (when) => `Decided ${when}. `,
    recordedBy: (who) => `Recorded by ${who}.`,
  },
  guide: {
    heading: 'Homologação form — answers ready to paste',
    // Five fragments wrapping two links. Each keeps its own leading or
    // trailing space; a translation that made them whole sentences would break
    // the line the screen actually renders.
    ledeBeforeForm: 'Open the ',
    formLink: 'official homologação form',
    ledeBeforeSupport: ' and fill it in with the values below. In parallel, open a ticket on ',
    supportLink: 'SIP — PagBank integration support',
    ledeBeforeDocs:
      ' quoting the 403 ACCESS_DENIED: what you answer first decides whether the form covers Connect. Documentation: ',
    docsLink: 'requesting homologação',
    ledeAfterDocs: '.',
  },
  anexo: {
    heading: 'Evidence attachment',
    body:
      "The form asks for the requests and responses of the calls sent to PagBank's APIs. The file is generated from this platform's real calls, with the token redacted.",
    generate: 'Generate attachment',
    generateFailed: 'Could not generate the attachment.',
  },
  connect: {
    expectedRedirectHeading: 'The callback this deploy uses (the value that must be registered)',
    consultAgain: 'Look it up again',
    noApplication: 'No application configured in this environment.',
    // `redirect_uri` is the parameter name in PagBank's own response — an
    // operator compares the two strings character by character.
    redirectMatches: 'The registered redirect_uri matches the callback this deploy uses.',
    redirectDiffers:
      'The redirect_uri registered with PagBank differs from the callback this deploy uses.',
    redirectUnreported:
      "PagBank's response carried no redirect_uri, so it could not be compared with the callback.",
    fields: {
      name: 'Name (shown to the store owner)',
      site: 'Site',
      description: 'Description',
      logo: 'Logo',
      redirectUri: 'registered redirect_uri',
    },
    fieldEmpty: '—',
    redirectNotReported: 'not reported',
    resolvedFrom:
      "This environment's application is resolved strictly from these variables, with no fallback between environments:",
    showConfig: 'Show environment variables',
    hideConfig: 'Hide environment variables',
    extraKeys: 'Other fields returned',
  },
};
