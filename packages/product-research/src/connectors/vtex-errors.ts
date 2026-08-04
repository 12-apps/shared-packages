import { describeFetchFailure, diagnosticUrl } from './fetch-reason';
import type { FetchFailure } from './types';

/**
 * The VTEX connector's failure copy (FUT-495). Kept beside the connector rather
 * than inside it for the same reason `vtex-validate.ts` is: the search file is
 * at its size budget, and this is a self-contained string concern.
 *
 * The tiers a VTEX search can fail on are NAMED, because they fail for
 * different reasons and need different fixes: the regions probe (a store that
 * exposes no regionalization), intelligent-search (a store without VTEX IO),
 * the delivery simulation (the only endpoint that answers whether a SKU reaches
 * a CEP, FUT-514), and the legacy catalog search (the one every store must
 * answer). Only the last one is fatal — the others fall back by design — so
 * their reasons go to the log while this one is what gets STORED and rendered.
 */
type VtexTier = 'catalog' | 'regions' | 'intelligent-search' | 'simulation';

const TIER_LABEL: Record<VtexTier, string> = {
  catalog: 'Busca no catálogo VTEX',
  regions: 'Consulta de regiões VTEX',
  'intelligent-search': 'Busca inteligente VTEX',
  simulation: 'Simulação de entrega VTEX',
};

/**
 * A 401/403 on a request that CARRIED the source's application key has a second
 * candidate explanation the unkeyed wording hides: a rotated, revoked or
 * wrongly-scoped key (FUT-520). `describeFetchFailure` reads those statuses as
 * "bloqueio de bot ou de IP", which for a keyed request sends the operator to
 * the store's edge for something they can fix in their own dialog. Appended as
 * a CLAUSE, and about the field — no credential value is ever echoed.
 */
const KEY_CLAUSE =
  ' A chave de aplicação da fonte também pode não ser mais válida — ' +
  'confira a chave em Fontes de preços.';

const AUTH_STATUSES = new Set([401, 403]);

/**
 * One tier's failure as a full sentence: what failed, why, and where. The
 * address keeps its path (that is the diagnostic part — it proves which
 * endpoint and which redirect target answered) and loses its query string,
 * which a source URL can use to carry a key.
 *
 * `keyed` says the request carried an application key; it only ever widens the
 * 401/403 arm, so an unkeyed source's copy is byte-identical to before.
 */
export const vtexFailureMessage = (
  tier: VtexTier,
  failure: FetchFailure,
  url: string,
  keyed = false,
): string => {
  const keyDoubt =
    keyed && failure.kind === 'http' && AUTH_STATUSES.has(failure.status) ? KEY_CLAUSE : '';
  return (
    `${TIER_LABEL[tier]} falhou: ${describeFetchFailure(failure)}. ` +
    `Endereço: ${diagnosticUrl(url)}${keyDoubt}`
  );
};
