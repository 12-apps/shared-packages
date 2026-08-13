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
 *                               It pairs `products:approve` against an id it
 *                               does not declare, which only resolves because
 *                               composition validates against the whole set.
 *   3. `HARNESS_DOMAIN`       — this demo application's own domain, with its
 *                               own pt-BR words. A locale's copy for a
 *                               restaurant is the host's to ship, not a
 *                               generic authorization package's.
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
    'products:approve': { kind: 'class', separateFrom: ['products:write'] },
  },
  labels: { actions: { approve: 'Aprovar' } },
});

/** The demo application's own domain. */
export const HARNESS_DOMAIN = definePermissionContribution({
  source: 'harness',
  permissions: {
    'products:read:all': { kind: 'class' },
    'products:write': { kind: 'class' },
    'ingredients:read': { kind: 'class' },
    'stock:read': { kind: 'class' },
    'stock:move': { kind: 'class' },
    'orders:read:all': { kind: 'class' },
    'orders:read:assigned': { kind: 'instance' },
    'orders:create': { kind: 'class' },
    'orders:void': { kind: 'class' },
    'orders:refund': { kind: 'class' },
    'purchasing:write': { kind: 'class' },
    'kitchen:read:station': { kind: 'instance' },
    'kitchen:update': { kind: 'class' },
    'shift:manage:own': { kind: 'class' },
    'shift:read:all': { kind: 'class' },
    'shift:end:any': { kind: 'class' },
    'reports:sales:read': { kind: 'class' },
    'till:open': { kind: 'class' },
    // The owner marker beside `roles:manage`: this one moves money.
    'payouts:manage': { kind: 'class', ownerMarker: true },
    'config:read': { kind: 'class' },
    'config:read:operational': { kind: 'class' },
    'config:write': { kind: 'class' },
  },
  labels: {
    domains: {
      products: 'Produtos',
      ingredients: 'Insumos',
      stock: 'Estoque',
      orders: 'Pedidos',
      purchasing: 'Compras',
      kitchen: 'Cozinha',
      shift: 'Turnos',
      reports: 'Relatórios',
      till: 'Caixa',
      payouts: 'Repasses',
      config: 'Configurações',
    },
    actions: {
      read: 'Ver',
      write: 'Editar',
      create: 'Criar',
      move: 'Movimentar',
      void: 'Cancelar',
      refund: 'Reembolsar',
      update: 'Atualizar',
      manage: 'Gerenciar',
      open: 'Abrir',
      end: 'Encerrar',
    },
    nouns: { sales: 'vendas' },
    scopes: {
      all: 'todos',
      any: 'qualquer',
      own: 'próprios',
      assigned: 'atribuídos',
      station: 'estação',
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
  { name: 'OWNER', permissions: '*', description: 'Acesso total ao tenant.' },
  {
    name: 'ADMIN',
    permissions: [
      'products:read:all',
      'products:write',
      'products:approve',
      'ingredients:read',
      'stock:read',
      'stock:move',
      'orders:read:all',
      'orders:create',
      'orders:void',
      'orders:refund',
      'purchasing:write',
      'kitchen:update',
      'reports:sales:read',
      'till:open',
      'payouts:manage',
      'config:read',
      'config:write',
      'team:read',
      'team:manage',
      'roles:manage',
    ],
    description: 'Administra o tenant; tudo exceto ações do proprietário.',
  },
  {
    name: 'MANAGER',
    permissions: [
      'products:read:all',
      'products:write',
      'ingredients:read',
      'stock:read',
      'stock:move',
      'orders:read:all',
      'orders:create',
      'orders:void',
      'purchasing:write',
      'kitchen:read:station',
      'kitchen:update',
      'shift:read:all',
      'shift:end:any',
      'reports:sales:read',
      'till:open',
      'team:read',
      'config:read:operational',
    ],
    description: 'Toca a operação do dia a dia de uma loja.',
  },
  {
    name: 'WAITER',
    permissions: [
      'products:read:all',
      'ingredients:read',
      'orders:read:assigned',
      'orders:create',
      'shift:manage:own',
      'config:read:operational',
    ],
    description: 'Atende e serve os pedidos das mesas atribuídas.',
  },
  {
    name: 'CHEF',
    permissions: [
      'products:read:all',
      'ingredients:read',
      'stock:read',
      'kitchen:read:station',
      'kitchen:update',
      'shift:manage:own',
      'config:read:operational',
    ],
    description: 'Trabalha a fila da estação da cozinha.',
  },
  {
    name: 'FINANCIAL',
    permissions: ['reports:sales:read', 'orders:refund', 'payouts:manage'],
    description: 'Supervisão financeira, reembolsos e repasses.',
  },
  {
    name: 'BUYER',
    permissions: ['products:read:all', 'ingredients:read', 'stock:read', 'purchasing:write'],
    description: 'Cuida das compras e dos fornecedores.',
  },
  {
    name: 'SUPERADMIN',
    permissions: '*',
    description: 'Acesso de plataforma; atribuído no escopo GLOBAL.',
  },
];

/** The whole catalog — the ONE object `rbacRouter` and `createWebRbac` take. */
export const HARNESS_CATALOG = HARNESS_PERMISSIONS.withRoles({
  roles: HARNESS_ROLES,
  ownerRoles: ['OWNER', 'SUPERADMIN'],
  leafOnlyRoles: ['MANAGER', 'WAITER', 'CHEF'],
  platformOnlyRoles: ['SUPERADMIN'],
  roleLabels: {
    OWNER: 'Proprietário',
    ADMIN: 'Administrador',
    MANAGER: 'Gerente',
    WAITER: 'Garçom',
    CHEF: 'Cozinheiro',
    FINANCIAL: 'Financeiro',
    BUYER: 'Comprador',
    SUPERADMIN: 'Superadmin',
  },
});
