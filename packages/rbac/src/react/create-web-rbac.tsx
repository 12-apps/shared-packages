import { useEffect, useMemo, useState, type ComponentType, type JSX, type ReactNode } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { labelsOf } from '../core/compose';
import { resolveRbacCopy } from '../core/copy';
import { mergeLabelVocabulary } from '../core/contribution';
import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';

import { createRbacApiClient, type RbacApiClient } from './api';
import { RbacProvider } from './context';
import type { RbacWebCopy } from './copy';
import { createRbacLabels, type RbacLabels } from './labels';
import { MemberScreen } from './member-screen';
import type { RoleSeedDefault } from './role-grid-config';
import { RolesScreen } from './roles-screen';
import { TeamScreen } from './team-screen';
import { httpRbacTransport } from './transport';
import type { RbacLocaleHook, RbacWebConfig } from './web-config';

export type { RbacWebConfig, RbacLocaleHook } from './web-config';

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



/** The "no locale wired" implementation: nobody said, on every render. */
const noLocale: RbacLocaleHook = () => undefined;

export interface WebRbac {
  /** The whole surface: Papéis + Equipe behind the package's own tabs. */
  page: ComponentType;
  /** The screens individually, for hosts that route them themselves. */
  RolesScreen: ComponentType;
  TeamScreen: ComponentType;
  /** One member's profile, at `/team/:userId` — the route the roster's rows open. */
  MemberScreen: ComponentType;
}

/** The config, resolved once — what every bound component shares. */
interface SurfaceParts {
  api: RbacApiClient;
  permissions: PermissionRegistry<string>;
  governance: GovernanceCatalog;
  /**
   * The labels for the CURRENT reader — a hook, not a table.
   *
   * The rest of this object is genuinely resolved-once config (a client bound
   * to a base URL, the registry, the governance catalog). The words are not,
   * and putting them here as a value is exactly how they came to be frozen:
   * `surfaceParts` runs inside the host's `useMemo`, so a table built here is
   * the language that was in force when the tenant was last switched.
   */
  useLabels: () => RbacLabels;
  copy: RbacWebCopy;
  systemRoles: string[];
  ownerRoles: string[];
  manageRoles: string;
  manageTeam: string;
  /** Undefined when the host named no read gate — see the config field. */
  readRoles: string | undefined;
  seeds: ReadonlyMap<string, RoleSeedDefault>;
  config: RbacWebConfig;
}

function surfaceParts(config: RbacWebConfig): SurfaceParts {
  const { copy } = config;
  const { permissions, governance, roleTemplates } = config.catalog;
  const useLocale = config.useLocale ?? noLocale;

  /**
   * The three vocabularies, merged for whoever is reading this render.
   *
   * The merge order is unchanged and is the whole reason it is stated in one
   * place: the copy's words for THIS package's own segments sit UNDER the
   * catalog merge — the position its contribution's pt-BR labels used to hold —
   * so a host relabelling a shared segment in its own contribution still wins,
   * and explicit `labels` overrides still win over everything.
   *
   * Memoised on the tag, so a re-render that did not change language does the
   * same work it did before this axis existed: none. `createRbacLabels` returns
   * closures the grids and the picker hold, so a fresh object per render would
   * also invalidate every `useMemo` keyed on it downstream.
   */
  function useLabels(): RbacLabels {
    // Hooks may not be called conditionally, so the no-op stands in for an
    // absent seam rather than the call site branching on it.
    const locale = useLocale();
    return useMemo(
      () =>
        createRbacLabels(
          mergeLabelVocabulary(
            mergeLabelVocabulary(copy.permissionLabels, labelsOf(config.catalog, locale)),
            resolveRbacCopy(config.labels ?? {}, locale),
          ),
        ),
      [locale],
    );
  }

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
    useLabels,
    copy,
    systemRoles,
    ownerRoles: [...governance.ownerRoles],
    manageRoles: config.gatePermissions?.manageRoles ?? 'roles:manage',
    manageTeam: config.gatePermissions?.manageTeam ?? 'team:manage',
    readRoles: config.gatePermissions?.readRoles,
    seeds: config.roleSeeds ?? new Map(),
    config: config as RbacWebConfig,
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
  const labels = parts.useLabels();
  return (
    <RolesScreen
      api={parts.api}
      permissions={parts.permissions}
      governance={parts.governance}
      labels={labels}
      managePermission={parts.manageRoles}
      readPermission={parts.readRoles}
      tenantSlug={parts.config.tenantSlug}
      copy={parts.copy}
      seeds={parts.seeds}
      breadcrumb={parts.config.breadcrumbs?.roles}
      onOpenMembers={parts.config.navigate?.roleMembers}
      renderVersionHistory={parts.config.renderVersionHistory}
      bulkSlot={parts.config.rolesBulkSlot}
    />
  );
}

function BoundTeamScreen({ parts }: { parts: SurfaceParts }): JSX.Element {
  const labels = parts.useLabels();
  return (
    <TeamScreen
      api={parts.api}
      labels={labels}
      systemRoles={parts.systemRoles}
      ownerRoles={parts.ownerRoles}
      managePermission={parts.manageTeam}
      defaultInviteRole={parts.config.defaultInviteRole}
      copy={parts.copy}
      breadcrumb={parts.config.breadcrumbs?.team}
      onOpenMember={parts.config.navigate?.member}
      roleModel={parts.config.roleModel}
      extraColumns={parts.config.teamExtraColumns}
      rowActionIds={parts.config.teamRowActionIds}
    />
  );
}

function BoundMemberScreen({
  parts,
  formatters,
}: {
  parts: SurfaceParts;
  formatters: NonNullable<RbacWebConfig['formatters']>;
}): JSX.Element {
  const labels = parts.useLabels();
  return (
    <MemberScreen
      api={parts.api}
      labels={labels}
      copy={parts.copy}
      formatters={formatters}
      breadcrumb={parts.config.breadcrumbs?.member}
      renderExtra={parts.config.renderMemberExtra}
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
  const { formatters } = config;
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
    MemberScreen: () => (
      <WithPermissions parts={parts}>
        <BoundMemberScreen parts={parts} formatters={formatters} />
      </WithPermissions>
    ),
  };
}
