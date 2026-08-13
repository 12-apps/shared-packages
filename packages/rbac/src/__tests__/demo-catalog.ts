/**
 * THE DEMO HOST — a fixture, not this package's data.
 *
 * The mechanism suites need SOME application to exercise: an engine with no
 * catalog decides nothing, and a roles screen with no permissions renders an
 * empty picker. Until 12-13's follow-up that application was Future Pay's real
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
 * The role names and ids are deliberately the ones the suites already assert
 * on, so the port of these tests changed their fixtures and not their claims.
 * The real Future Pay matrix — 61 ids, eight roles — lives in the host now.
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
    'products:approve': { kind: 'class', separateFrom: ['products:write'] },
    'purchasing:approve': { kind: 'class', separateFrom: ['purchasing:write'] },
  },
  labels: { actions: { approve: 'Aprovar' } },
});

/** The demo application's own domain. */
const DEMO_DOMAIN = definePermissionContribution({
  source: 'demo-host',
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
    // The other owner marker beside `roles:manage`: it moves money.
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
  { name: 'OWNER', permissions: '*', description: 'Full access within a tenant.' },
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
      'purchasing:approve',
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
    description: 'Administers a tenant; everything except owner-only actions.',
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
    description: 'Runs day-to-day operations for a single site.',
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
    description: 'Takes and serves orders on assigned tables.',
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
    description: 'Works the kitchen station queue.',
  },
  {
    name: 'FINANCIAL',
    permissions: ['reports:sales:read', 'orders:refund', 'payouts:manage'],
    description: 'Financial oversight, refunds and payouts.',
  },
  {
    name: 'BUYER',
    permissions: ['products:read:all', 'ingredients:read', 'stock:read', 'purchasing:write'],
    description: 'Manages purchasing and supplier relationships.',
  },
  {
    name: 'SUPERADMIN',
    permissions: '*',
    description: 'Platform-wide access; assigned at GLOBAL scope.',
  },
];

/** The demo host's whole catalog — one object, what the factories take. */
export const DEMO_CATALOG = DEMO_PERMISSIONS.withRoles({
  roles: DEMO_ROLES,
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
