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
import type { RbacWebCopy } from './copy';
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
 * names where the API is mounted and supplies every sentence the screens
 * render, and that is the whole wiring.
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
  /**
   * Every sentence the screens render — REQUIRED, the host's words.
   * pt-BR hosts pass `PT_BR_RBAC_WEB_COPY` from `./pt-BR` (re-exported at
   * `@12-apps/rbac/react`).
   */
  copy: RbacWebCopy;
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
  copy: RbacWebCopy;
  systemRoles: string[];
  ownerRoles: string[];
  manageRoles: string;
  manageTeam: string;
}

function surfaceParts(config: RbacWebConfig): SurfaceParts {
  const { copy } = config;
  const { permissions, governance, roleTemplates, labels } = config.catalog;
  // The assignable SYSTEM roles — every template except the owner tier,
  // which is never assignable from the roster.
  const systemRoles = roleTemplates
    .filter((role) => !governance.ownerRoles.includes(role.name))
    .map((role) => role.name);
  return {
    api: createRbacApiClient(
      config.apiBase,
      config.transport ?? httpRbacTransport(copy.operationFailed),
    ),
    permissions,
    governance,
    // The copy's words for this package's own segments sit UNDER the catalog
    // merge — the position its contribution's pt-BR labels used to hold — so
    // a host relabelling a shared segment in its own contribution still wins,
    // and explicit `labels` overrides still win over everything.
    labels: createRbacLabels(
      mergeLabelVocabulary(mergeLabelVocabulary(copy.permissionLabels, labels), config.labels),
    ),
    copy,
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
        if (!cancelled) setError(parts.copy.permissionsLoadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [parts]);

  if (error) return <Text as="p">{error}</Text>;
  if (!permissions) return <Text as="p">{parts.copy.loading}</Text>;
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
      copy={parts.copy.rolesList}
      tableCopy={parts.copy.rolesTable}
      formCopy={parts.copy.roleForm}
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
      copy={parts.copy.teamScreen}
      tableCopy={parts.copy.teamTable}
      dialogCopy={parts.copy.teamRoleDialog}
      menuCopy={parts.copy.teamRowMenu}
    />
  );
}

type TabKey = 'roles' | 'team';

/** The two tabs in display order — keys fixed, labels the host's. */
function tabsOf(copy: RbacWebCopy): readonly { key: TabKey; label: string }[] {
  return [
    { key: 'roles', label: copy.tabs.roles },
    { key: 'team', label: copy.tabs.team },
  ];
}

function RbacAdminTabs({ parts }: { parts: SurfaceParts }): JSX.Element {
  const [tab, setTab] = useState<TabKey>('roles');
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} role="tablist">
        {tabsOf(parts.copy).map((entry) => (
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
