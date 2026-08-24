import type { ResearchHttpMessages } from './http';
import type { ResearchDiagnosticsCopy } from './connectors/diagnostics-copy';
import type { ResearchBudgetCopy } from './notifications';

/**
 * The en-US packs — NAMED packs a host imports and passes BY HAND, so choosing
 * English is a line in the host's diff rather than a silent default. Nothing in
 * this package reads these itself.
 *
 * Vendor nouns survive translation: `VTEX`, `SearchApi`, `License Manager`,
 * "application key" and the HTTP status codes are what an operator will find in
 * somebody else's dashboard, and a translated vendor label sends them hunting
 * for a control that does not exist under that name.
 */

/** Every sentence the HTTP surface can answer with — pass to `messages`. */
export const EN_US_RESEARCH_MESSAGES: ResearchHttpMessages = {
  credentialRefused: (reason) => `Credential refused by the provider: ${reason}`,
  sourceUrlRejected: (violation) => `Source URL rejected: ${violation}`,
  keylessSource: 'This price source does not use an application key.',
  incompleteCredentialFields: (fields) => `Fill in every key field: ${fields.join(', ')}.`,
  invalidQuote: 'Invalid quote.',
};

/** The budget alert's phrasing and CTA — pass to `createResearchBudgetBlueprint`. */
export const EN_US_RESEARCH_BUDGET_COPY: ResearchBudgetCopy = {
  title: (payload) =>
    payload.scope === 'TENANT_DAY'
      ? 'Daily paid-search quota used up'
      : 'Monthly paid-search budget used up',
  body: (payload) => {
    const tail =
      'Searches keep working with the free sources; ' +
      'paid search returns automatically next period.';
    return payload.scope === 'TENANT_DAY'
      ? `This store hit its daily quota of ${payload.capUnits} paid search(es) ` +
          `(${payload.sourceType}) on ${payload.period}. ${tail}`
      : `The platform hit its monthly budget of ${payload.capUnits} paid search(es) ` +
          `(${payload.sourceType}) in ${payload.period}. ${tail}`;
  },
  // A ROUTE, not a sentence — it is the host's own path and does not translate.
  link: (payload) => `/admin/${payload.tenantSlug}/research`,
};

/**
 * The label segments this package's permission ids read in, for an en-US
 * host's role editor — compose beside `PRODUCT_RESEARCH_PERMISSIONS`, whose own
 * declaration deliberately carries no words.
 */
export const EN_US_RESEARCH_PERMISSION_LABELS = {
  domains: { research: 'Price research' },
  actions: { read: 'View', write: 'Edit' },
} as const;

/**
 * Every sentence the CONNECTORS put in front of a store owner when a price
 * source fails — pass to `ConnectorContext.diagnostics`.
 *
 * Each one names WHAT failed and, where there is one, the check to make. The
 * HTTP status stays in the sentence on purpose: it is the one part an operator
 * can quote to the store or the provider whose system actually refused.
 */
export const EN_US_RESEARCH_DIAGNOSTICS: ResearchDiagnosticsCopy = {
  manualImport: {
    unreadablePrice: (raw) => `price not recognised: "${raw}"`,
    invalidEan: (raw) => `invalid EAN ignored: "${raw}" (row imported with no barcode)`,
    invalidValidUntil: (raw) => `invalid expiry ignored: "${raw}" (the default expiry was used)`,
    emptyFile: 'file has no data rows',
    missingRequiredColumns:
      'required columns not found (product and price) — supply the column mapping',
    unimportableRow: (path, message) =>
      `row could not be imported: ${path === '' ? 'row' : path} — ${message === '' ? 'invalid' : message}`,
  },
  fetch: {
    invalidUrl: '(invalid address)',
    refused: (status) => `the store refused our access (HTTP ${status} — bot or IP block)`,
    notFound: 'that address does not exist at the store (HTTP 404) — check the URL',
    rateLimited: () => 'the store rate-limited us (HTTP 429 — too many queries)',
    serverError: (status) =>
      `the store has an internal error (HTTP ${status}) — this may be temporary`,
    rejected: (status) => `the store refused the query (HTTP ${status})`,
    dnsUnresolved: "the store's domain was not found (DNS) — check the source address",
    dnsTransient: "the DNS lookup for the store's domain failed — this may be temporary",
    credentialsStripped:
      'the store redirects to another address and the application key cannot travel with it — ' +
      'set the final store address on the source (usually the "www" one)',
    transport: 'connection to the store failed (network, DNS or TLS)',
    transportCoded: (code) => `connection to the store failed (network, DNS or TLS: ${code})`,
    notJson: (status) =>
      `the store answered (HTTP ${status}) but not in JSON — probably an error or block page`,
    timeout: 'the store did not answer within the time limit',
    deadline: 'the search of this source used its whole time budget before this query',
  },
  sourceConfig: {
    invalid: (sourceLabel) =>
      `The ${sourceLabel} source configuration is invalid — review the source fields`,
    invalidFields: (sourceLabel, fields) =>
      `The ${sourceLabel} source configuration is invalid — review: ${fields.join(', ')}`,
  },
  searchApi: {
    timedOut: (budget) => `no answer within the ${budget} time limit`,
    keyRefused: (status) =>
      `key refused by the provider (HTTP ${status}) — check the integration key`,
    rateLimited: "the provider's query limit was reached (HTTP 429)",
    endpointNotFound: 'provider endpoint not found (HTTP 404)',
    providerError: (status) => `provider internal error (HTTP ${status}) — this may be temporary`,
    rejected: (status) => `the provider refused the query (HTTP ${status})`,
    notJson: (status) =>
      `the HTTP ${status} response was not JSON — probably a provider error page`,
    // Whether a PAID credit was consumed is the half an operator needs: it is
    // the difference between retrying freely and retrying at a cost.
    creditMaybeSpent: '(the paid credit may have been consumed)',
    creditNotSpent: '(no paid credit was consumed)',
    timedOutMaybeSpent: (budget) =>
      `no answer within the ${budget} time limit (the paid credit may have been consumed)`,
    deadlineNotSpent:
      'the search of this source used its whole time budget before this query ' +
      '(no paid credit was consumed)',
    transport: 'connection to the provider failed (network, DNS or TLS)',
    transportCoded: (code) => `connection to the provider failed (network, DNS or TLS: ${code})`,
    prefixed: (engine, reason) => `SearchApi ${engine}: ${reason}`,
    keyMissing: (engine) =>
      `SearchApi ${engine}: no API key configured — connect the price-search ` +
      'integration with the key from your SearchApi.io account',
    payloadShape: (engine) =>
      `SearchApi ${engine}: the provider answered in an unexpected format — ` +
      'no offers could be read',
    vendorRefusedSilently: (engine) =>
      `SearchApi ${engine}: the provider refused the query without giving a reason`,
    vendorError: (engine, vendorError) =>
      `SearchApi ${engine}: the provider refused the query — provider response: "${vendorError}"`,
  },
  vtex: {
    // The tier names are VTEX's own API surfaces; only the surrounding words
    // are translated.
    tiers: {
      catalog: 'VTEX catalog search',
      regions: 'VTEX regions lookup',
      'intelligent-search': 'VTEX intelligent search',
      simulation: 'VTEX delivery simulation',
    },
    tierFailed: (tier, reason) => `${tier} failed: ${reason}.`,
    keyDoubt:
      " The source's application key may also no longer be valid — " +
      'check the key under Price sources.',
    endpoint: (url) => `Address: ${url}`,
  },
  vtexValidate: {
    urlMissing:
      'The store URL is missing or invalid. Give the full address, ' +
      'such as https://www.example.com.',
    urlHasCredentials:
      'The store URL cannot contain a username and password (the part before the "@"). ' +
      'Give the public address only.',
    retryHint: 'Try again in a few minutes.',
    apexHint: (hostname) => ` If the store uses "www", try https://www.${hostname}.`,
    unreachable: (reason, apexHint) =>
      'The store did not answer (down, blocking us, or the wrong address): ' +
      `${reason}. Check the URL and try again.${apexHint}`,
    timedOut: (retryHint, apexHint) =>
      `The store did not answer within the time limit. ${retryHint}${apexHint}`,
    unverifiable: (reason, retryHint) => `Could not validate the store now: ${reason}. ${retryHint}`,
    notVtex: (status, apexHint) =>
      `The address answered${status === undefined ? '' : ` (HTTP ${status})`}, but does not look like ` +
      `a VTEX store (unexpected response from the catalog API). Check the store URL.${apexHint}`,
    keyRejected:
      'The store refused the application key given — the same query without a key was accepted. ' +
      "Check the key and token generated in the store's own admin, and the role permissions " +
      'in License Manager.',
    redirectsAway: (apexHint) =>
      'The store redirects to another address and the application key cannot travel with it. ' +
      `Set the final store address here.${apexHint}`,
  },
  budget: {
    ceilingReached:
      'The query to this source used its whole time budget and was stopped before it ' +
      'finished. No offers arrived in time. Try again; if it repeats, the store is ' +
      'answering too slowly for this search.',
  },
};
