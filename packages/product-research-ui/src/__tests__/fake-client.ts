/**
 * Hand-written client fake (the payments-frontend doctrine — no msw): every
 * method rejects loudly unless a test overrides it, so a component reaching
 * for data a test did not script fails with a readable message.
 */
import type { ResearchApiClient } from '../client';

export { offer, requestView, runView } from '../fixtures';

export function fakeClient(overrides: Partial<ResearchApiClient> = {}): ResearchApiClient {
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`unexpected ${name} call in test`));
  return {
    startResearch: unexpected('startResearch'),
    getRequest: unexpected('getRequest'),
    getRun: unexpected('getRun'),
    listRequests: unexpected('listRequests'),
    listSources: () => Promise.resolve([]),
    ...overrides,
  };
}
