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

/**
 * `GET /team/:userId` — the member detail behind the profile screen. A
 * PROJECTION of the roster record rather than the record: no `active`/`status`,
 * and the two timestamps as ISO strings (`memberSince` always, `lastLoginAt`
 * null until a first sign-in is recorded).
 */
export interface MemberDetailWire {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  customRoles: string[];
  memberSince: string;
  lastLoginAt: string | null;
}

/**
 * What `POST /team` answers.
 *
 * `granted` means the address already had an account and the membership exists
 * NOW; `invited` means it does not, and the grant is deferred to the person's
 * signup. The roster refreshes into a new row for the first and does not for
 * the second, which is why the screen has to tell them apart rather than
 * reporting "done" either way.
 */
export interface InviteResultWire {
  status: 'granted' | 'invited';
}

export interface RbacApiClient {
  myPermissions(): Promise<string[]>;
  /**
   * @param search The owned query params, already serialized (`q=x&page=2`).
   *
   * A STRING rather than an object because the URL is the query on a
   * server-driven grid: the screen forwards what the address bar holds, and a
   * shape here would have to enumerate every param the grid can emit — which
   * is the drift the origin host's two hand-kept `OWNED_PARAMS` lists were.
   */
  listRoles(search: string): Promise<{ data: RoleListRowWire[]; pagination: PaginationWire }>;
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
  /** @param search As {@link RbacApiClient.listRoles}'s. */
  listTeam(search: string): Promise<{ data: TeamMemberWire[]; pagination: PaginationWire }>;
  teamContext(): Promise<TeamContextWire>;
  /** The member behind the profile screen. Rejects (404) for a non-member id. */
  getMember(userId: string): Promise<MemberDetailWire>;
  /** Grant or defer access for an e-mail address (`POST /team`). */
  inviteMember(email: string): Promise<RbacResult<InviteResultWire>>;
  /** Burn a pending accountless invite. Idempotent — a stale id is a no-op. */
  cancelInvite(inviteId: string): Promise<RbacResult<{ status: string }>>;
  setMemberRole(userId: string, role: string): Promise<RbacResult<{ status: string }>>;
  grantMemberRole(userId: string, role: string): Promise<RbacResult<{ status: string }>>;
  revokeMemberRole(userId: string, role: string): Promise<RbacResult<{ status: string }>>;
  setMemberActive(userId: string, active: boolean): Promise<RbacResult<{ status: string }>>;
  removeMember(userId: string): Promise<RbacResult<{ status: string }>>;
}

const seg = encodeURIComponent;

/** A serialized param string as a URL suffix — `''` stays `''`, never `'?'`. */
function suffix(search: string): string {
  const trimmed = search.replace(/^\?/, '');
  return trimmed ? `?${trimmed}` : '';
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
    listRoles: (search) =>
      transport.get<{ data: RoleListRowWire[]; pagination: PaginationWire }>(
        `${base}/roles${suffix(search)}`,
      ),
    createRole: (input) => transport.send(`${base}/roles`, 'POST', input),
    updateRole: (id, input) => transport.send(`${base}/roles/${seg(id)}`, 'PATCH', input),
    deleteRole: (id) => transport.send(`${base}/roles/${seg(id)}`, 'DELETE'),
    overrideTemplate: (name, input) =>
      transport.send(`${base}/roles/templates/${seg(name)}`, 'PUT', input),
    resetTemplate: (name) =>
      transport.send(`${base}/roles/templates/${seg(name)}`, 'DELETE'),
    listTeam: (search) =>
      transport.get<{ data: TeamMemberWire[]; pagination: PaginationWire }>(
        `${base}/team${suffix(search)}`,
      ),
    async teamContext() {
      const payload = await transport.get<{ data: TeamContextWire }>(`${base}/team/context`);
      return payload.data;
    },
    async getMember(userId) {
      const payload = await transport.get<{ data: MemberDetailWire }>(
        `${base}/team/${seg(userId)}`,
      );
      return payload.data;
    },
    inviteMember: (email) => transport.send(`${base}/team`, 'POST', { email }),
    cancelInvite: (inviteId) =>
      transport.send(`${base}/team/invites/${seg(inviteId)}`, 'DELETE'),
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
