import type { RbacResult, RbacTransport } from './transport';

/**
 * The typed wire calls the screens make (12-13) — the REST twins of the
 * `/server` descriptors, built from an `apiBase` (the host's admin mount,
 * e.g. `/api/admin/minha-loja`). Paths here and in `routes-*.ts` are ONE
 * contract; changing either alone is a drift bug.
 */

export interface RoleWire {
  id: string;
  name: string;
  description: string | null;
  permissions: readonly string[] | '*';
}

export interface RoleListRowWire extends RoleWire {
  kind: string;
  locked: boolean;
}

export interface PaginationWire {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
}

export interface TeamMemberWire {
  userId: string;
  role: string;
  email: string;
  name: string | null;
  image: string | null;
  active: boolean;
  status: 'ENABLED' | 'DISABLED';
}

export interface TeamContextWire {
  customRolesByMember: { userId: string; roles: string[] }[];
  assignableRoles: string[];
  pendingInvites: { id: string; email: string; role: string }[];
  invitesEnabled: boolean;
}

export interface RbacApiClient {
  myPermissions(): Promise<string[]>;
  listRoles(query: {
    q?: string;
    page?: number;
  }): Promise<{ data: RoleListRowWire[]; pagination: PaginationWire }>;
  createRole(input: {
    name: string;
    description: string | null;
    permissions: string[];
  }): Promise<RbacResult<RoleWire>>;
  updateRole(
    id: string,
    input: { name: string; description: string | null; permissions: string[] },
  ): Promise<RbacResult<RoleWire>>;
  deleteRole(id: string): Promise<RbacResult<{ status: 'deleted' }>>;
  overrideTemplate(
    name: string,
    input: { description: string | null; permissions: string[] },
  ): Promise<RbacResult<RoleWire>>;
  resetTemplate(name: string): Promise<RbacResult<{ status: 'reset' }>>;
  listTeam(query: {
    q?: string;
    page?: number;
  }): Promise<{ data: TeamMemberWire[]; pagination: PaginationWire }>;
  teamContext(): Promise<TeamContextWire>;
  setMemberRole(userId: string, role: string): Promise<RbacResult<{ status: string }>>;
  grantMemberRole(userId: string, role: string): Promise<RbacResult<{ status: string }>>;
  revokeMemberRole(userId: string, role: string): Promise<RbacResult<{ status: string }>>;
  setMemberActive(userId: string, active: boolean): Promise<RbacResult<{ status: string }>>;
  removeMember(userId: string): Promise<RbacResult<{ status: string }>>;
}

const seg = encodeURIComponent;

function listQuery(query: { q?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const raw = params.toString();
  return raw ? `?${raw}` : '';
}

export function createRbacApiClient(
  apiBase: string,
  transport: RbacTransport,
): RbacApiClient {
  const base = apiBase.replace(/\/$/, '');
  return {
    async myPermissions() {
      const payload = await transport.get<{ data: { permissions: string[] } }>(
        `${base}/permissions`,
      );
      return payload.data.permissions;
    },
    listRoles: (query) =>
      transport.get<{ data: RoleListRowWire[]; pagination: PaginationWire }>(
        `${base}/roles${listQuery(query)}`,
      ),
    createRole: (input) => transport.send(`${base}/roles`, 'POST', input),
    updateRole: (id, input) => transport.send(`${base}/roles/${seg(id)}`, 'PATCH', input),
    deleteRole: (id) => transport.send(`${base}/roles/${seg(id)}`, 'DELETE'),
    overrideTemplate: (name, input) =>
      transport.send(`${base}/roles/templates/${seg(name)}`, 'PUT', input),
    resetTemplate: (name) =>
      transport.send(`${base}/roles/templates/${seg(name)}`, 'DELETE'),
    listTeam: (query) =>
      transport.get<{ data: TeamMemberWire[]; pagination: PaginationWire }>(
        `${base}/team${listQuery(query)}`,
      ),
    async teamContext() {
      const payload = await transport.get<{ data: TeamContextWire }>(`${base}/team/context`);
      return payload.data;
    },
    setMemberRole: (userId, role) =>
      transport.send(`${base}/team/${seg(userId)}`, 'PATCH', { role }),
    grantMemberRole: (userId, role) =>
      transport.send(`${base}/team/${seg(userId)}/roles`, 'POST', { role }),
    revokeMemberRole: (userId, role) =>
      transport.send(`${base}/team/${seg(userId)}/roles/${seg(role)}`, 'DELETE'),
    setMemberActive: (userId, active) =>
      transport.send(`${base}/team/${seg(userId)}/status`, 'PATCH', { active }),
    removeMember: (userId) => transport.send(`${base}/team/${seg(userId)}`, 'DELETE'),
  };
}
