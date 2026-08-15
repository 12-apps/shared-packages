/**
 * THE DEMO HOST — a fixture, not this package's data.
 *
 * The mechanism suites need SOME application to exercise: an engine with no
 * catalog decides nothing, and a roles screen with no permissions renders an
 * empty picker. Until 12-13's follow-up that application was the origin host's real
 * catalog, imported from `../templates` — which is exactly what made the
 * package look like it owned it.
 *
 * So this is a made-up host, assembled the way a real one is: THREE
 * contributions, composed here and nowhere else.
 *
 *   1. `RBAC_PERMISSIONS`  — this package's own three ids, imported.
 *   2. `DEMO_LIFECYCLE`    — a stand-in for a second package that owns an
 *                            approval surface over the host's entities. It
 *                            pairs against ids it does not declare, which is
 *                            the cross-source SoD case.
 *   3. `DEMO_DOMAIN`       — the host's own domain, with its own pt-BR words.
 *
 * IT IS A LIBRARY, and deliberately not a restaurant. The first version of
 * this file kept the origin host's own role names and ids — OWNER/ADMIN/MANAGER/
 * WAITER/CHEF over Produtos/Estoque/Cozinha — on the reasoning that reusing
 * them let the ported suites keep their assertions. What that actually did was
 * hide a class of bug: every package-side default left in the server config
 * (`ownerRoles: ['OWNER']`, `customerRole: 'CUSTOMER'`, `adminRoles: ['OWNER',
 * 'ADMIN']`) happened to be RIGHT for this fixture, so a suite covering them
 * proved only that one application agrees with itself. A host whose owner is
 * called `DIRECTOR` is the host those defaults break, and it is now the host
 * every one of these suites runs as.
 */
import { composePermissions } from '../core/compose';
import { definePermissionContribution, type PermissionOf } from '../core/contribution';
import type { RoleDef } from '../core/types';
import { RBAC_PERMISSIONS } from '../permissions';

/** A second PACKAGE's contribution: approvals over the host's entities. */
const DEMO_LIFECYCLE = definePermissionContribution({
  source: '@demo/lifecycle',
  permissions: {
    // Declared HERE, paired against ids declared in the domain contribution
    // below — a counterpart is resolved against the whole composed catalog,
    // not against one source's own map.
    'titles:approve': { kind: 'class', separateFrom: ['titles:write'] },
    'acquisitions:approve': { kind: 'class', separateFrom: ['acquisitions:write'] },
  },
  labels: { actions: { approve: 'Aprovar' } },
});

/** The demo application's own domain. */
const DEMO_DOMAIN = definePermissionContribution({
  source: 'demo-host',
  permissions: {
    'titles:read:all': { kind: 'class' },
    'titles:write': { kind: 'class' },
    'authors:read': { kind: 'class' },
    'copies:read': { kind: 'class' },
    'copies:move': { kind: 'class' },
    'loans:read:all': { kind: 'class' },
    'loans:read:assigned': { kind: 'instance' },
    'loans:create': { kind: 'class' },
    'loans:void': { kind: 'class' },
    'loans:waive': { kind: 'class' },
    'acquisitions:write': { kind: 'class' },
    'repairs:read:bench': { kind: 'instance' },
    'repairs:update': { kind: 'class' },
    'shift:manage:own': { kind: 'class' },
    'shift:read:all': { kind: 'class' },
    'shift:end:any': { kind: 'class' },
    'reports:circulation:read': { kind: 'class' },
    'desk:open': { kind: 'class' },
    // The other owner marker beside `roles:manage`: it moves money.
    'budget:manage': { kind: 'class', ownerMarker: true },
    'config:read': { kind: 'class' },
    'config:read:operational': { kind: 'class' },
    'config:write': { kind: 'class' },
  },
  labels: {
    domains: {
      titles: 'Títulos',
      authors: 'Autores',
      copies: 'Exemplares',
      loans: 'Empréstimos',
      acquisitions: 'Aquisições',
      repairs: 'Restauro',
      shift: 'Turnos',
      reports: 'Relatórios',
      desk: 'Balcão',
      budget: 'Orçamento',
      config: 'Configurações',
    },
    actions: {
      read: 'Ver',
      write: 'Editar',
      create: 'Criar',
      move: 'Movimentar',
      void: 'Cancelar',
      waive: 'Perdoar',
      update: 'Atualizar',
      manage: 'Gerenciar',
      open: 'Abrir',
      end: 'Encerrar',
    },
    nouns: { circulation: 'circulação' },
    scopes: {
      all: 'todos',
      any: 'qualquer',
      own: 'próprios',
      assigned: 'atribuídos',
      bench: 'bancada',
      operational: 'operacional',
    },
  },
});

/** Every id the demo host knows, from all three sources. */
const DEMO_PERMISSIONS = composePermissions(
  RBAC_PERMISSIONS,
  DEMO_LIFECYCLE,
  DEMO_DOMAIN,
);

/** The demo host's permission union — the type its guards are checked against. */
export type DemoPermission = PermissionOf<typeof DEMO_PERMISSIONS>;

/** The demo host's role matrix. Typed, so an off-catalog id is a compile error. */
const DEMO_ROLES: readonly RoleDef<DemoPermission>[] = [
  { name: 'DIRECTOR', permissions: '*', description: 'Full access within a tenant.' },
  {
    name: 'HEAD_LIBRARIAN',
    permissions: [
      'titles:read:all',
      'titles:write',
      'titles:approve',
      'authors:read',
      'copies:read',
      'copies:move',
      'loans:read:all',
      'loans:create',
      'loans:void',
      'loans:waive',
      'acquisitions:write',
      'acquisitions:approve',
      'repairs:update',
      'reports:circulation:read',
      'desk:open',
      'budget:manage',
      'config:read',
      'config:write',
      'team:read',
      'team:manage',
      'roles:manage',
    ],
    description: 'Administers a tenant; everything except owner-only actions.',
  },
  {
    name: 'BRANCH_LEAD',
    permissions: [
      'titles:read:all',
      'titles:write',
      'authors:read',
      'copies:read',
      'copies:move',
      'loans:read:all',
      'loans:create',
      'loans:void',
      'acquisitions:write',
      'repairs:read:bench',
      'repairs:update',
      'shift:read:all',
      'shift:end:any',
      'reports:circulation:read',
      'desk:open',
      'team:read',
      'config:read:operational',
    ],
    description: 'Runs day-to-day operations for a single branch.',
  },
  {
    name: 'CLERK',
    permissions: [
      'titles:read:all',
      'authors:read',
      'loans:read:assigned',
      'loans:create',
      'shift:manage:own',
      'config:read:operational',
    ],
    description: 'Works the lending desk for the loans assigned to them.',
  },
  {
    name: 'CONSERVATOR',
    permissions: [
      'titles:read:all',
      'authors:read',
      'copies:read',
      'repairs:read:bench',
      'repairs:update',
      'shift:manage:own',
      'config:read:operational',
    ],
    description: 'Works the conservation bench queue.',
  },
  {
    name: 'TREASURER',
    permissions: ['reports:circulation:read', 'loans:waive', 'budget:manage'],
    description: 'Financial oversight, waived fines and the budget.',
  },
  {
    name: 'SELECTOR',
    permissions: ['titles:read:all', 'authors:read', 'copies:read', 'acquisitions:write'],
    description: 'Manages acquisitions and supplier relationships.',
  },
  {
    name: 'NETWORK_OPS',
    permissions: '*',
    description: 'Platform-wide access; assigned at GLOBAL scope.',
  },
];

/** The demo host's whole catalog — one object, what the factories take. */
export const DEMO_CATALOG = DEMO_PERMISSIONS.withRoles({
  roles: DEMO_ROLES,
  ownerRoles: ['DIRECTOR', 'NETWORK_OPS'],
  leafOnlyRoles: ['BRANCH_LEAD', 'CLERK', 'CONSERVATOR'],
  platformOnlyRoles: ['NETWORK_OPS'],
  roleLabels: {
    DIRECTOR: 'Direção',
    HEAD_LIBRARIAN: 'Bibliotecário-chefe',
    BRANCH_LEAD: 'Coordenação de unidade',
    CLERK: 'Atendente de balcão',
    CONSERVATOR: 'Restaurador',
    TREASURER: 'Tesouraria',
    SELECTOR: 'Seleção de acervo',
    NETWORK_OPS: 'Operação da rede',
  },
});
