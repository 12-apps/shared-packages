/**
 * What a HOST may need to know about PagBank, in one place (FUT-764).
 *
 * A file of its own rather than another block on the root barrel, which is at
 * its size cap: a barrel that has to be trimmed to accept a capability is one
 * that starts hiding capabilities to stay small. Every name is re-exported from
 * the root unchanged, so nothing an adopter imports moves.
 *
 * Both entries are the same argument. PagBank's published hostnames, and the
 * variable names that carry a PagBank credential, are the ADAPTER's facts: they
 * are identical for every deployment, and a host restating either is restating
 * the adapter's job. Each was written out a sixth time by the first adopting
 * host before it moved.
 */
export { pagbankApiBase } from './pagbank-api-base';
export {
  pagbankPlatformFallbackEnabled,
  readPagBankEnv,
  type PagBankEnv,
  type PagBankEnvSource,
} from './pagbank-env';
