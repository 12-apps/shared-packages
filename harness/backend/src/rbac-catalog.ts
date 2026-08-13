/**
 * THE HARNESS'S OWN PERMISSION CATALOG — assembled here, by the host.
 *
 * This file is the consumer-side ergonomics of the contribution API, over the
 * published tarball rather than a source import: three owners, one
 * `composePermissions` call, one `withRoles`, and the single object both
 * factories take. Nothing here reaches into the package for an application
 * catalog, because the package no longer has one.
 *
 *   1. `RBAC_PERMISSIONS`     — the package's own three ids, imported from it.
 *   2. `HARNESS_LIFECYCLE`    — a stand-in for a SECOND package owning an
 *                               approval surface over this host's entities.
 *                               It pairs `titles:approve` against an id it
 *                               does not declare, which only resolves because
 *                               composition validates against the whole set.
 *   3. `HARNESS_DOMAIN`       — this demo application's own domain, with its
 *                               own pt-BR words. A locale's copy for a public
 *                               LIBRARY is the host's to ship, not a generic
 *                               authorization package's.
 *
 * The domain is a library on purpose, and the roles are DIRECTOR /
 * HEAD_LIBRARIAN / BRANCH_LEAD / CLERK on purpose. A harness whose role names
 * happened to match the package's old defaults (`ownerRoles: ['OWNER']`,
 * `adminRoles: ['OWNER', 'ADMIN']`, `customerRole: 'CUSTOMER'`) could not tell
 * "the host stated this" from "a default happened to fit" — which is how a
 * SUPERADMIN membership went unprotected by invariants this file's own
 * governance already claimed. Nothing here shares a word with the app the
 * package was extracted from, so every one of those knobs has to be stated
 * below or the mount does not compile.
 */
import {
  composePermissions,
  definePermissionContribution,
  RBAC_PERMISSIONS,
  type PermissionOf,
  type RoleDef,
} from '@12-apps/rbac';

/** A second package's contribution: approvals over this host's entities. */
export const HARNESS_LIFECYCLE = definePermissionContribution({
  source: '@harness/lifecycle',
  permissions: {
    'titles:approve': { kind: 'class', separateFrom: ['titles:write'] },
  },
  labels: { actions: { approve: 'Aprovar' } },
});

/** The demo application's own domain. */
export const HARNESS_DOMAIN = definePermissionContribution({
  source: 'harness',
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
    // The owner marker beside `roles:manage`: this one moves money.
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

/** Every id this host knows, from all three owners. */
export const HARNESS_PERMISSIONS = composePermissions(
  RBAC_PERMISSIONS,
  HARNESS_LIFECYCLE,
  HARNESS_DOMAIN,
);

/** The union the host's own guards are checked against. */
export type HarnessPermission = PermissionOf<typeof HARNESS_PERMISSIONS>;

/** The role matrix. Typed, so an off-catalog id here is a compile error. */
const HARNESS_ROLES: readonly RoleDef<HarnessPermission>[] = [
  { name: 'DIRECTOR', permissions: '*', description: 'Acesso total ao tenant.' },
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
    description: 'Administra o tenant; tudo exceto ações da direção.',
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
    description: 'Toca a operação do dia a dia de uma unidade.',
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
    description: 'Atende o balcão e cuida dos empréstimos atribuídos.',
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
    description: 'Trabalha a fila da bancada de restauro.',
  },
  {
    name: 'TREASURER',
    permissions: ['reports:circulation:read', 'loans:waive', 'budget:manage'],
    description: 'Supervisão financeira, perdões de multa e orçamento.',
  },
  {
    name: 'SELECTOR',
    permissions: ['titles:read:all', 'authors:read', 'copies:read', 'acquisitions:write'],
    description: 'Cuida das aquisições e dos fornecedores.',
  },
  {
    name: 'NETWORK_OPS',
    permissions: '*',
    description: 'Acesso de plataforma; atribuído no escopo GLOBAL.',
  },
];

/** The whole catalog — the ONE object `rbacRouter` and `createWebRbac` take. */
export const HARNESS_CATALOG = HARNESS_PERMISSIONS.withRoles({
  roles: HARNESS_ROLES,
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
