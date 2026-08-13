import { useEffect, useState, type ComponentType, type JSX, type ReactNode } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { RbacCatalog } from '../core/compose';
import { mergeLabelVocabulary, type RbacLabelVocabulary } from '../core/contribution';
import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';

import { createRbacApiClient, type RbacApiClient } from './api';
import { RbacProvider } from './context';
import { createRbacLabels, type RbacLabels } from './labels';
import { RolesScreen } from './roles-screen';
import { TeamScreen } from './team-screen';
import { httpRbacTransport, type RbacTransport } from './transport';

/**
 * The one thing this package exposes to a FRONTEND host (12-13).
 *
 * Everything the roles + team admin IS — the catalog grid, the permission
 * picker with its governance affordances, the roster, the unified role-edit
 * dialog, the wire calls between them — lives inside this package. The host
 * names where the API is mounted, and that is the whole wiring.
 *
 * The screens sit on the package's own `./react` context: the surface fetches
 * the caller's resolved permission set from `GET <apiBase>/permissions` and
 * mounts an `RbacProvider` around itself, so `useCan`/`<Can>` gate every
 * affordance the same way the endpoints gate every write.
 */

export interface RbacWebConfig<P extends string = string> {
  /** The admin mount the routes live under, e.g. `/api/admin/minha-loja`. */
  apiBase: string;
  /**
   * The host's composed catalog — registry, role templates, governance and the
   * merged labels, as ONE object. It used to be three optional fields
   * defaulting to a catalog this package shipped, which meant a host could
   * pass its own registry and silently keep somebody else's governance.
   */
  catalog: RbacCatalog<P>;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: RbacTransport;
  /** Label overrides layered over the catalog's own. */
  labels?: RbacLabelVocabulary;
  /** Gate permission ids, when the host's catalog spells them differently. */
  gatePermissions?: { manageRoles?: string; manageTeam?: string };
}

export interface WebRbac {
  /** The whole surface: Papéis + Equipe behind the package's own tabs. */
  page: ComponentType;
  /** The two screens individually, for hosts that route them themselves. */
  RolesScreen: ComponentType;
  TeamScreen: ComponentType;
}

/** The config, resolved once — what every bound component shares. */
interface SurfaceParts {
  api: RbacApiClient;
  permissions: PermissionRegistry<string>;
  governance: GovernanceCatalog;
  labels: RbacLabels;
  systemRoles: string[];
  ownerRoles: string[];
  manageRoles: string;
  manageTeam: string;
}

function surfaceParts(config: RbacWebConfig): SurfaceParts {
  const { permissions, governance, roleTemplates, labels } = config.catalog;
  // The assignable SYSTEM roles — every template except the owner tier,
  // which is never assignable from the roster.
  const systemRoles = roleTemplates
    .filter((role) => !governance.ownerRoles.includes(role.name))
    .map((role) => role.name);
  return {
    api: createRbacApiClient(config.apiBase, config.transport ?? httpRbacTransport()),
    permissions,
    governance,
    labels: createRbacLabels(mergeLabelVocabulary(labels, config.labels)),
    systemRoles,
    ownerRoles: [...governance.ownerRoles],
    manageRoles: config.gatePermissions?.manageRoles ?? 'roles:manage',
    manageTeam: config.gatePermissions?.manageTeam ?? 'team:manage',
  };
}

/** Fetches the caller's own set once and provides it to the screens. */
function WithPermissions({
  parts,
  children,
}: {
  parts: SurfaceParts;
  children: ReactNode;
}): JSX.Element {
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    parts.api
      .myPermissions()
      .then((list) => {
        if (!cancelled) setPermissions(list);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar suas permissões.');
      });
    return () => {
      cancelled = true;
    };
  }, [parts]);

  if (error) return <Text as="p">{error}</Text>;
  if (!permissions) return <Text as="p">Carregando…</Text>;
  return <RbacProvider permissions={permissions}>{children}</RbacProvider>;
}

function BoundRolesScreen({ parts }: { parts: SurfaceParts }): JSX.Element {
  return (
    <RolesScreen
      api={parts.api}
      permissions={parts.permissions}
      governance={parts.governance}
      labels={parts.labels}
      managePermission={parts.manageRoles}
    />
  );
}

function BoundTeamScreen({ parts }: { parts: SurfaceParts }): JSX.Element {
  return (
    <TeamScreen
      api={parts.api}
      labels={parts.labels}
      systemRoles={parts.systemRoles}
      ownerRoles={parts.ownerRoles}
      managePermission={parts.manageTeam}
    />
  );
}

type TabKey = 'roles' | 'team';

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'roles', label: 'Papéis' },
  { key: 'team', label: 'Equipe' },
];

function RbacAdminTabs({ parts }: { parts: SurfaceParts }): JSX.Element {
  const [tab, setTab] = useState<TabKey>('roles');
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} role="tablist">
        {TABS.map((entry) => (
          <Button
            key={entry.key}
            variant={tab === entry.key ? 'solid' : 'text'}
            role="tab"
            aria-selected={tab === entry.key}
            dataTestId={`rbac-tab-${entry.key}`}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
      </Stack>
      <Box>
        {tab === 'roles' ? <BoundRolesScreen parts={parts} /> : <BoundTeamScreen parts={parts} />}
      </Box>
    </Stack>
  );
}

export function createWebRbac<P extends string = string>(
  config: RbacWebConfig<P>,
): WebRbac {
  const parts = surfaceParts(config);
  return {
    page: () => (
      <WithPermissions parts={parts}>
        <RbacAdminTabs parts={parts} />
      </WithPermissions>
    ),
    RolesScreen: () => (
      <WithPermissions parts={parts}>
        <BoundRolesScreen parts={parts} />
      </WithPermissions>
    ),
    TeamScreen: () => (
      <WithPermissions parts={parts}>
        <BoundTeamScreen parts={parts} />
      </WithPermissions>
    ),
  };
}
