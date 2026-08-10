import { unknownEntityError } from './errors';
import { operatorsFor } from './filters';
import type { EntityDef, FieldCatalog } from './types';

/** Identity helper that gives hosts type inference when declaring a catalog. */
export function defineCatalog<T extends FieldCatalog>(catalog: T): T {
  return catalog;
}

/** Serializable field listing for builder UIs and the MCP `listReportFields` tool. */
export interface CatalogFieldListing {
  entities: Array<{
    entity: string;
    label: string;
    description?: string;
    fields: Array<{
      field: string;
      label: string;
      type: string;
      role: 'dimension' | 'measure';
      /**
       * Present on a DIMENSION whose order the catalog had to DECLARE
       * (FUT-755) — an encoded ordinal such as an hour-of-day. Absent means
       * the type rule decides (`date`/`number`/`money` ordered,
       * `string`/`boolean` not). It is what lets the builder offer a line or
       * an area for this field's axis.
       */
      ordered?: boolean;
      aggregations?: readonly string[];
      /** Declared render format (`duration`, `percent`…), when the field has one. */
      format?: string;
      description?: string;
      /**
       * The field's closed set of values, labelled (FUT-391). Present means a
       * filter on this field is PICKED, not typed — the builder offers "Pago"
       * and stores `PAID`.
       */
      values?: readonly { value: string; label: string }[];
      /**
       * The operators this field accepts, ALREADY RESOLVED from the catalog's
       * declaration, the closed-set rule and the field type. Resolved here so a
       * client never re-derives the defaults and drifts from the server's
       * answer — the whole point of a server-owned catalog.
       */
      ops: readonly string[];
      /**
       * Present on an IDENTITY dimension (FUT-454): grouping by this field
       * requires every measure to declare `minSample` of at least this value,
       * or the spec is rejected at compile time.
       */
      minGroupSample?: number;
      /**
       * Present on an IDENTITY-SENSITIVE measure (FUT-454): the figure is
       * withheld for any row whose eligible sample is below this value,
       * whatever the spec asked for and however the row came to be small.
       */
      identityMinSample?: number;
    }>;
  }>;
}

export function listCatalogFields(catalog: FieldCatalog): CatalogFieldListing {
  return {
    entities: Object.entries(catalog.entities).map(([entity, def]) => ({
      entity,
      label: def.label,
      description: def.description,
      fields: Object.entries(def.fields).map(([field, fieldDef]) => ({
        field,
        label: fieldDef.label,
        type: fieldDef.type,
        role: fieldDef.role,
        ordered: fieldDef.ordered,
        aggregations: fieldDef.aggregations,
        format: fieldDef.format,
        description: fieldDef.description,
        values: fieldDef.values,
        ops: operatorsFor(fieldDef),
        minGroupSample: fieldDef.minGroupSample,
        identityMinSample: fieldDef.identityMinSample,
      })),
    })),
  };
}

/** Internal render-side entity lookup (compile already validated the spec). */
export function requireEntityForRender(catalog: FieldCatalog, entity: string): EntityDef {
  const def = catalog.entities[entity];
  if (!def) throw unknownEntityError(entity, Object.keys(catalog.entities));
  return def;
}
