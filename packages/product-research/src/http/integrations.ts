import type { ResearchApiConfig, ResearchRoute } from './types';
import { resolveResearchCopy } from './types';
import { ok, recordOf, refuse, credentialsOf } from './shared';

/**
 * The paid-connector integrations: at most ONE per tenant per type, running
 * on the tenant's own key. `mounted` says whether THIS server has the
 * connector registered — an unmounted type is still configurable (the key is
 * stored, visibly unverified) and starts participating the moment the
 * connector lands.
 */
export function integrationRoutes(config: ResearchApiConfig): ResearchRoute[] {
  const { store, checks, credentials: codec, connectors } = config;
  const now = config.now ?? ((): Date => new Date());
  const withMounted = (integration: Record<string, unknown>): Record<string, unknown> => ({
    ...integration,
    mounted: connectors.isMounted(String(integration['type'] ?? '')),
  });
  return [
    {
      method: 'GET',
      path: '/research/integrations',
      permission: 'research:read',
      async handle({ actor }) {
        const integrations = await store.integrations.list(actor.clientId);
        return ok(integrations.map(withMounted));
      },
    },
    {
      method: 'PUT',
      path: '/research/integrations/:type',
      permission: 'research:write',
      // Create-or-replace: the singleton invariant means a second save swaps
      // the key, never adds a row. The key is verified through the probe
      // seam; no probe (or an unreachable provider) stores it visibly
      // UNVERIFIED — never a blocked save.
      async handle({ actor, params, body, locale }) {
        // Resolved per request, never at mount: these routes are built once
        // and the language changes per caller.
        const messages = resolveResearchCopy(config.messages, locale);
        const record = recordOf(body);
        const submitted = credentialsOf(record);
        const type = params['type'] ?? '';
        const check = await checks.integrationCredentials(type, submitted);
        if (check !== null && !check.ok) {
          return refuse(422, messages.credentialRefused(check.error));
        }
        const integration = await store.integrations.save(actor.clientId, type, {
          credentialsEncrypted: codec.encode(submitted),
          credentialHint: codec.hint(submitted),
          credentialStatus: check === null ? 'UNVERIFIED' : 'VERIFIED',
          checkedAt: now(),
          enabled: record['enabled'] !== false,
        });
        return ok(withMounted(integration));
      },
    },
    {
      method: 'PATCH',
      path: '/research/integrations/:type',
      permission: 'research:write',
      async handle({ actor, params, body }) {
        const integration = await store.integrations.setEnabled(
          actor.clientId,
          params['type'] ?? '',
          recordOf(body)['enabled'] === true,
        );
        return ok(withMounted(integration));
      },
    },
    {
      method: 'DELETE',
      path: '/research/integrations/:type',
      permission: 'research:write',
      async handle({ actor, params }) {
        await store.integrations.remove(actor.clientId, params['type'] ?? '');
        return ok({ deleted: true });
      },
    },
  ];
}
