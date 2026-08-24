import type { LifecycleMessages } from './context';

/**
 * The en-US pack — a NAMED export a host passes by hand, never a default. The
 * filename is what exempts this file from the copy-portability gate.
 *
 * Every one of these answers a request that found nothing, and they stay
 * DISTINCT rather than collapsing into one "not found": which of a version, a
 * draft, a bin entry and a request is missing is what tells an operator whether
 * someone else finished the job or whether they are looking at a stale tab.
 */
export const EN_US_LIFECYCLE_MESSAGES: LifecycleMessages = {
  entityNotFound: 'That item no longer exists — it may have been deleted.',
  versionNotFound: 'That version no longer exists.',
  entryNotFound: 'That item is no longer in the recycle bin.',
  draftNotFound: 'That draft no longer exists.',
  requestNotFound: 'That request no longer exists.',
  requestAlreadyDecided: 'That request has already been decided.',
  featureDisabled: 'This feature is not enabled for this store.',
  notAuthorized: 'You do not have permission to approve changes.',
  routeNotAllowed: 'You do not have permission to manage this store.',
  operationFailed: 'That action could not be completed.',
  unknownEntityType: 'This kind of item is not enabled for the lifecycle.',
  invalidBody: 'Invalid data.',
  unauthenticated: 'Not authenticated.',
};
