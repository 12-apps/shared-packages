import { CREDENTIALS_KEY } from '../integrations';
import type { ResearchApiConfig, ResearchRoute } from './types';
import { ok, recordOf, refuse, credentialFieldsProblem, credentialsOf } from './shared';

/**
 * The price-source roster and the per-source application key. Writes follow
 * one ordering everywhere: the SSRF veto (where the WORKER will fetch on the
 * tenant's behalf), then the live connector probe, then the write — nothing
 * persists on a refusal, so a store merely down for a minute is never made
 * unaddable; the operator retries.
 */
type UrlProblem = (edited: Record<string, unknown> | undefined) => Promise<string | null>;

function urlProblemOf(config: ResearchApiConfig): UrlProblem {
  const { checks, messages } = config;
  return async (edited) => {
    const baseUrl = edited?.['baseUrl'];
    if (typeof baseUrl !== 'string') return null;
    const violation = await checks.publicUrlViolation(baseUrl);
    return violation === null ? null : messages.sourceUrlRejected(violation);
  };
}

/** The roster: list with mounted types, the gated create/edit, the soft archive. */
function rosterRoutes(config: ResearchApiConfig): ResearchRoute[] {
  const { store, checks, connectors } = config;
  const baseUrlProblem = urlProblemOf(config);
  return [
    {
      method: 'GET',
      path: '/research/sources',
      permission: 'research:read',
      // `meta.mountedTypes` is the registry AS MOUNTED by this host: a source
      // of any other type only ever runs SKIPPED, so the create dialog
      // derives its selectable options from here.
      async handle({ actor }) {
        const data = await store.sources.list(actor.clientId);
        return { status: 200, body: { data, meta: { mountedTypes: connectors.types() } } };
      },
    },
    {
      method: 'POST',
      path: '/research/sources',
      permission: 'research:write',
      async handle({ actor, body }) {
        const record = recordOf(body);
        const urlProblem = await baseUrlProblem(recordOf(record['config']));
        if (urlProblem !== null) return refuse(400, urlProblem);
        const check = await checks.sourceConfig(
          String(record['type'] ?? ''),
          recordOf(record['config']),
        );
        if (check !== null && !check.ok) return refuse(422, check.error);
        return ok(await store.sources.create(actor.clientId, body));
      },
    },
    {
      method: 'PATCH',
      path: '/research/sources/:sourceId',
      permission: 'research:write',
      // Renames and/or replaces the connector config, never the type — a
      // source's identity is its connector. An edited config re-proves both
      // gates; a rename (no config) touches no connector setting and skips
      // the probe. The stored row answers the 404 through `update`.
      async handle({ actor, params, body }) {
        const record = recordOf(body);
        const sourceId = params['sourceId'] ?? '';
        const edited = record['config'] === undefined ? undefined : recordOf(record['config']);
        if (edited !== undefined) {
          const urlProblem = await baseUrlProblem(edited);
          if (urlProblem !== null) return refuse(400, urlProblem);
          const type = await store.sources.typeOf(sourceId, actor.clientId);
          if (type !== null) {
            const check = await checks.sourceConfig(type, edited);
            if (check !== null && !check.ok) return refuse(422, check.error);
          }
        }
        return ok(await store.sources.update(sourceId, actor.clientId, body));
      },
    },
    {
      method: 'DELETE',
      path: '/research/sources/:sourceId',
      permission: 'research:write',
      // A SOFT archive: the source leaves the roster and stops joining new
      // runs; finished runs keep every offer it produced.
      async handle({ actor, params }) {
        const sourceId = params['sourceId'] ?? '';
        await store.sources.archive(sourceId, actor.clientId);
        return ok({ id: sourceId });
      },
    },
  ];
}

/** The application key of ONE named source — enters here, leaves as a hint. */
function credentialRoutes(config: ResearchApiConfig): ResearchRoute[] {
  const { store, checks, credentials: codec, messages, connectors } = config;
  const now = config.now ?? ((): Date => new Date());
  return [
    {
      method: 'PUT',
      path: '/research/sources/:sourceId/credentials',
      permission: 'research:write',
      // Probed against the stored connector settings plus the submitted key —
      // the exact request a run will make — and stored UNVERIFIED even on a
      // pass: the probe proves the store answers, never that it CHECKED the key.
      async handle({ actor, params, body }) {
        const sourceId = params['sourceId'] ?? '';
        const submitted = credentialsOf(recordOf(body));
        const target = await store.credentials.requireSource(sourceId, actor.clientId);
        const fieldProblem = credentialFieldsProblem(
          connectors.credentialFieldsFor(target.type),
          submitted,
          messages,
        );
        if (fieldProblem !== null) return refuse(422, fieldProblem);
        const check = await checks.sourceConfig(target.type, {
          ...target.config,
          [CREDENTIALS_KEY]: submitted,
        });
        if (check !== null && !check.ok) return refuse(422, check.error);
        const source = await store.credentials.save(sourceId, actor.clientId, {
          credentialsEncrypted: codec.encode(submitted),
          credentialHint: codec.hint(submitted),
          credentialStatus: 'UNVERIFIED',
          checkedAt: now(),
        });
        return ok(source);
      },
    },
    {
      method: 'DELETE',
      path: '/research/sources/:sourceId/credentials',
      permission: 'research:write',
      async handle({ actor, params }) {
        return ok(await store.credentials.remove(params['sourceId'] ?? '', actor.clientId));
      },
    },
  ];
}

export function sourceRoutes(config: ResearchApiConfig): ResearchRoute[] {
  return [...rosterRoutes(config), ...credentialRoutes(config)];
}
