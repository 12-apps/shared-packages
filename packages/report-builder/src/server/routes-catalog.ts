import { listCatalogFields } from '../catalog';

import {
  entityPermissionMap,
  forbidden,
  mayQueryEntity,
  ok,
  type ReportBuilderServerConfig,
  type ReportRoute,
} from './context';
import { REPORT_ENTITY_STARTERS } from './starters';

/**
 * `GET /reports/fields` — the catalog the builder authors against, narrowed to
 * the entities this actor's permission tier may query.
 *
 * The narrowing belongs HERE and not in the host, even though the permissions
 * are the host's: this listing is what the compiler validates against, so a
 * catalog wider than the caller's reach hands the builder fields whose specs
 * the run endpoint will then refuse. One rule, applied in one place.
 */
export function catalogRoute(config: ReportBuilderServerConfig): ReportRoute {
  return {
    method: 'GET',
    path: '/reports/fields',
    handle({ actor }) {
      const listing = listCatalogFields(config.catalog);
      const permitted = entityPermissionMap(config);
      const entities = listing.entities
        .filter((entity) => mayQueryEntity(config, actor, entity.entity))
        // Each entity carries its known-good starter spec: the builder
        // prefills from it and MCP authors copy it instead of guessing field
        // names. Absent for a host catalog with no starter of its own.
        .map((entity) => {
          const starter = REPORT_ENTITY_STARTERS[entity.entity];
          return starter ? { ...entity, starter } : entity;
        });
      // Reaching no entity at all is not an empty catalog, it is a caller who
      // may not author reports: 403 rather than a builder that renders an
      // entity picker with nothing in it.
      const denied = entities.length === 0 && Object.keys(permitted).length > 0;
      return Promise.resolve(denied ? forbidden() : ok({ entities }));
    },
  };
}
