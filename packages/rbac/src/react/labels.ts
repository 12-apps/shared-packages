import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';

/**
 * pt-BR presentation helpers + catalog grouping for the role screens (12-13)
 * — ported from future-pay's `permission-labels.ts` + `role-labels.ts`. Pure,
 * no React. The label maps are DEFAULTS a host may extend through
 * `createWebRbac`; unknown segments fall back to their raw text so an added
 * permission still renders (just untranslated) rather than disappearing.
 */

/** pt-BR labels for the permission domains (the segment before the first `:`). */
const DOMAIN_LABELS: Record<string, string> = {
  products: 'Produtos',
  categories: 'Categorias',
  ingredients: 'Insumos',
  stock: 'Estoque',
  inventory: 'Inventário',
  suppliers: 'Fornecedores',
  purchasing: 'Compras',
  orders: 'Pedidos',
  kitchen: 'Cozinha',
  payments: 'Pagamentos',
  till: 'Caixa',
  tables: 'Mesas',
  reports: 'Relatórios',
  customers: 'Clientes',
  config: 'Configurações',
  team: 'Equipe',
  roles: 'Papéis',
  payouts: 'Repasses',
  shift: 'Turnos',
  user: 'Usuários',
};

const ACTION_LABELS: Record<string, string> = {
  read: 'Ver',
  write: 'Editar',
  edit: 'Editar',
  create: 'Criar',
  delete: 'Excluir',
  move: 'Movimentar',
  count: 'Contar',
  approve: 'Aprovar',
  void: 'Cancelar',
  refund: 'Reembolsar',
  assign: 'Atribuir',
  manage: 'Gerenciar',
  update: 'Atualizar',
  take: 'Receber',
  open: 'Abrir',
  close: 'Fechar',
  end: 'Encerrar',
  impersonate: 'Ver como',
};

const NOUN_LABELS: Record<string, string> = {
  sales: 'vendas',
  financial: 'financeiro',
  kitchen: 'cozinha',
};

const SCOPE_LABELS: Record<string, string> = {
  all: 'todos',
  any: 'qualquer',
  published: 'publicados',
  own: 'próprios',
  assigned: 'atribuídos',
  station: 'estação',
  operational: 'operacional',
  // A SCOPE rather than an action, so `user:impersonate:configure` renders
  // "Ver como (ativar/desativar)" — one row that reads as a narrower slice of
  // the row above it. As an action it would compose to "Ver como Configurar",
  // which names no recognisable thing.
  configure: 'ativar/desativar',
};

/** pt-BR labels for the seeded staff roles; custom roles show their own name. */
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  WAITER: 'Garçom',
  CHEF: 'Cozinheiro',
  FINANCIAL: 'Financeiro',
  BUYER: 'Comprador',
  CUSTOMER: 'Cliente',
  SUPERADMIN: 'Superadmin',
};

/** Host-extendable label overrides. */
export interface RbacLabelOverrides {
  domains?: Record<string, string>;
  roles?: Record<string, string>;
}

export interface RbacLabels {
  domainLabel(domain: string): string;
  /** A friendly label for a permission's action + scope (domain omitted). */
  permissionActionLabel(permission: string): string;
  /** The pt-BR label for a role name, or the raw name. */
  roleLabel(role: string): string;
}

export function createRbacLabels(overrides: RbacLabelOverrides = {}): RbacLabels {
  const domains = { ...DOMAIN_LABELS, ...overrides.domains };
  const roles = { ...ROLE_LABELS, ...overrides.roles };
  return {
    domainLabel: (domain) => domains[domain] ?? domain,
    permissionActionLabel(permission) {
      const [, ...rest] = permission.split(':');
      const actions: string[] = [];
      const nouns: string[] = [];
      const scopes: string[] = [];
      for (const segment of rest) {
        if (segment in ACTION_LABELS) actions.push(ACTION_LABELS[segment] as string);
        else if (segment in NOUN_LABELS) nouns.push(NOUN_LABELS[segment] as string);
        else if (segment in SCOPE_LABELS) scopes.push(SCOPE_LABELS[segment] as string);
        else actions.push(segment);
      }
      const base = [...actions, ...nouns].join(' ') || permission;
      return scopes.length > 0 ? `${base} (${scopes.join(', ')})` : base;
    },
    roleLabel: (role) => roles[role] ?? role,
  };
}

/** A domain bucket of the catalog — the permission picker's layout. */
export interface PermissionGroup {
  domain: string;
  permissions: string[];
}

const domainOf = (permission: string): string => permission.split(':')[0] ?? permission;

/** The catalog grouped by domain — computed from the HOST's registry. */
export function groupPermissions(
  permissions: Pick<PermissionRegistry<string>, 'list'>,
): PermissionGroup[] {
  const byDomain = new Map<string, string[]>();
  for (const permission of permissions.list) {
    const domain = domainOf(permission);
    const bucket = byDomain.get(domain) ?? [];
    bucket.push(permission);
    byDomain.set(domain, bucket);
  }
  return [...byDomain.entries()].map(([domain, list]) => ({ domain, permissions: list }));
}

/** The separation-of-duties counterpart of `permission`, if any. */
export function sodCounterpart(
  governance: Pick<GovernanceCatalog, 'sodPairs'>,
  permission: string,
): string | undefined {
  for (const [a, b] of governance.sodPairs) {
    if (a === permission) return b;
    if (b === permission) return a;
  }
  return undefined;
}
