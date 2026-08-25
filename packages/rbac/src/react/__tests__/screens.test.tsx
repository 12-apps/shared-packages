// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_CATALOG } from '../../__tests__/demo-catalog';

import type { RbacApiClient } from '../api';
import { RbacProvider } from '../context';
import { createRbacLabels } from '../labels';
import { PT_BR_RBAC_WEB_COPY } from '../pt-BR';
import { RolesScreen } from '../roles-screen';
import { TeamScreen } from '../team-screen';

/**
 * The packaged screens' affordance gating and destructive-write discipline:
 * `useCan` HIDES what the actor may not do, every destructive act sits behind a
 * confirm step, and a refused write surfaces its user-safe error rather than
 * rendering nothing.
 *
 * Every assertion here is on a TEST ID or on copy read from the pack under
 * test — never on a hard-coded sentence. Copy is required config, so a literal
 * would pin this suite to one adopter's voice, which is precisely the coupling
 * the packaged e2e journeys were written to avoid.
 */

const PAGINATION = { total: 1, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false };
const COPY = PT_BR_RBAC_WEB_COPY;
const LABELS = createRbacLabels(DEMO_CATALOG.labels);
const SYSTEM_ROLES = ['HEAD_LIBRARIAN', 'BRANCH_LEAD', 'CLERK', 'CONSERVATOR'];

function apiStub(overrides: Partial<RbacApiClient> = {}): RbacApiClient {
  return {
    myPermissions: vi.fn(async () => []),
    listRoles: vi.fn(async () => ({
      data: [
        {
          id: 'r1',
          name: 'Voluntário',
          description: null,
          permissions: ['copies:read'] as readonly string[],
          kind: 'CUSTOM',
          locked: false,
        },
      ],
      pagination: PAGINATION,
    })),
    createRole: vi.fn(async () => ({
      ok: true as const,
      data: { id: 'r2', name: 'x', description: null, permissions: [] },
    })),
    updateRole: vi.fn(async () => ({
      ok: true as const,
      data: { id: 'r1', name: 'x', description: null, permissions: [] },
    })),
    deleteRole: vi.fn(async () => ({ ok: true as const, data: { status: 'deleted' as const } })),
    overrideTemplate: vi.fn(async () => ({
      ok: true as const,
      data: { id: 'r1', name: 'x', description: null, permissions: [] },
    })),
    resetTemplate: vi.fn(async () => ({ ok: true as const, data: { status: 'reset' as const } })),
    listTeam: vi.fn(async () => ({
      data: [
        {
          userId: 'chef-1',
          role: 'CONSERVATOR',
          email: 'camila@example.com',
          name: 'Camila Barbosa',
          image: null,
          active: true,
          status: 'ENABLED' as const,
        },
      ],
      pagination: PAGINATION,
    })),
    teamContext: vi.fn(async () => ({
      customRolesByMember: [],
      assignableRoles: ['CLERK'],
      pendingInvites: [],
      invitesEnabled: true,
    })),
    getMember: vi.fn(async () => ({
      userId: 'chef-1',
      name: 'Camila Barbosa',
      email: 'camila@example.com',
      image: null,
      role: 'CONSERVATOR',
      customRoles: [],
      memberSince: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
    })),
    inviteMember: vi.fn(async () => ({
      ok: true as const,
      data: { status: 'invited' as const },
    })),
    cancelInvite: vi.fn(async () => ({ ok: true as const, data: { status: 'cancelled' } })),
    setMemberRole: vi.fn(async () => ({ ok: true as const, data: { status: 'updated' } })),
    grantMemberRole: vi.fn(async () => ({ ok: true as const, data: { status: 'granted' } })),
    revokeMemberRole: vi.fn(async () => ({ ok: true as const, data: { status: 'revoked' } })),
    setMemberActive: vi.fn(async () => ({ ok: true as const, data: { status: 'updated' } })),
    removeMember: vi.fn(async () => ({ ok: true as const, data: { status: 'removed' } })),
    ...overrides,
  };
}

function mountRoles(api: RbacApiClient, permissions: string[]): void {
  render(
    <MemoryRouter>
      <RbacProvider permissions={permissions}>
        <RolesScreen
          api={api}
          tenantSlug="acervo"
          permissions={DEMO_CATALOG.permissions}
          governance={DEMO_CATALOG.governance}
          labels={LABELS}
          managePermission="roles:manage"
          copy={COPY}
          seeds={new Map()}
        />
      </RbacProvider>
    </MemoryRouter>,
  );
}

function mountTeam(api: RbacApiClient, permissions: string[]): void {
  render(
    <MemoryRouter>
      <RbacProvider permissions={permissions}>
        <TeamScreen
          api={api}
          labels={LABELS}
          systemRoles={SYSTEM_ROLES}
          ownerRoles={DEMO_CATALOG.governance.ownerRoles}
          managePermission="team:manage"
          copy={COPY}
        />
      </RbacProvider>
    </MemoryRouter>,
  );
}

/** Open a row's ⋮ kebab and click one of its entries by label. */
async function chooseFromMenu(kebabTestId: string, label: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(kebabTestId));
  fireEvent.click(await screen.findByText(label));
}

describe('affordance hiding (useCan)', () => {
  it('shows an actor without roles:manage a neutral not-found, not a refusal', async () => {
    mountRoles(apiStub(), ['titles:read:all']);
    // Same answer the endpoints give: "you may not" and "there is nothing here"
    // are deliberately indistinguishable, so the screen may not reveal more.
    await waitFor(() => {
      expect(screen.getByTestId('roles-not-found')).toBeTruthy();
      expect(screen.queryByTestId('roles-grid')).toBeNull();
      expect(screen.queryByTestId('add-role-button')).toBeNull();
    });
  });

  it('shows the write affordances to an actor holding the gate permission', async () => {
    mountRoles(apiStub(), ['roles:manage']);
    await waitFor(() => {
      expect(screen.getByTestId('roles-grid')).toBeTruthy();
    });
    expect(screen.getByTestId('add-role-button')).toBeTruthy();
    expect(screen.getByTestId('role-actions-r1')).toBeTruthy();
  });

  it('withholds the roster row menu from an actor without team:manage', async () => {
    mountTeam(apiStub(), []);
    // No kebab AT ALL rather than a kebab that opens onto nothing — and no
    // invite affordance, which the header gates on the same permission. The
    // grid being on screen is what makes the two absences a verdict rather
    // than a not-yet-rendered race.
    await waitFor(() => {
      expect(screen.getByTestId('team-grid')).toBeTruthy();
      expect(screen.queryByTestId('team-actions-chef-1')).toBeNull();
      expect(screen.queryByTestId('add-admin-button')).toBeNull();
    });
  });
});

describe('destructive writes sit behind a confirm step', () => {
  it('deleting a role asks first, and backing out writes nothing', async () => {
    const api = apiStub();
    mountRoles(api, ['roles:manage']);
    await chooseFromMenu('role-actions-r1', COPY.rolesTable.deleteAction);

    const dialog = await screen.findByTestId('role-delete-confirm');
    expect(within(dialog).getByText(COPY.rolesList.deleteConfirm.title)).toBeTruthy();
    fireEvent.click(screen.getByTestId('role-delete-confirm-cancel-button'));
    expect(api.deleteRole).not.toHaveBeenCalled();

    await chooseFromMenu('role-actions-r1', COPY.rolesTable.deleteAction);
    fireEvent.click(await screen.findByTestId('role-delete-confirm-confirm-button'));
    await waitFor(() => {
      expect(api.deleteRole).toHaveBeenCalledWith('r1');
    });
  });

  it('removing a member asks first, naming the consequence', async () => {
    const api = apiStub();
    mountTeam(api, ['team:manage']);
    await chooseFromMenu('team-actions-chef-1', COPY.teamRowMenu.remove);

    const dialog = await screen.findByTestId('team-remove-confirm');
    expect(within(dialog).getByText(COPY.teamScreen.removeConfirm.body)).toBeTruthy();
    fireEvent.click(screen.getByTestId('team-remove-confirm-confirm-button'));
    await waitFor(() => {
      expect(api.removeMember).toHaveBeenCalledWith('chef-1');
    });
  });
});

describe('a refused write surfaces its error', () => {
  it('shows the owner-protection message when a disable is refused', async () => {
    const refusal = 'Não é possível desativar um proprietário.';
    const api = apiStub({
      setMemberActive: vi.fn(async () => ({ ok: false as const, error: refusal })),
    });
    mountTeam(api, ['team:manage']);
    await chooseFromMenu('team-actions-chef-1', COPY.teamRowMenu.deactivate);
    await waitFor(() => {
      expect(screen.getByTestId('team-error')).toBeTruthy();
    });
    expect(screen.getByText(refusal)).toBeTruthy();
  });
});

describe('the roster composes what two reads say', () => {
  it('renders a pending accountless invite as a roster row', async () => {
    const api = apiStub({
      teamContext: vi.fn(async () => ({
        customRolesByMember: [],
        assignableRoles: ['CLERK'],
        pendingInvites: [{ id: 'inv-1', email: 'nova@example.com', role: 'CLERK' }],
        invitesEnabled: true,
      })),
    });
    mountTeam(api, ['team:manage']);
    // The invite is a ROW, not a footnote below the table — which is what makes
    // it filterable, countable and cancellable like every other row.
    await waitFor(() => {
      expect(screen.getByTestId('status-invite:inv-1')).toBeTruthy();
    });
    // Twice, and correctly: an invite has no name, so the name column falls
    // back to the address the e-mail column also shows.
    expect(screen.getAllByText('nova@example.com').length).toBeGreaterThan(0);
  });

  it('offers a pending invite only its cancel, never a member action', async () => {
    const api = apiStub({
      teamContext: vi.fn(async () => ({
        customRolesByMember: [],
        assignableRoles: [],
        pendingInvites: [{ id: 'inv-1', email: 'nova@example.com', role: 'CLERK' }],
        invitesEnabled: true,
      })),
    });
    mountTeam(api, ['team:manage']);
    fireEvent.click(await screen.findByTestId('team-actions-invite:inv-1'));
    // There is no membership yet, so there is nothing to edit, disable or
    // remove — asserted beside the entry that IS offered, so the open menu is
    // the evidence the two absences are a decision.
    await waitFor(() => {
      expect(screen.getByText(COPY.teamRowMenu.cancelInvite)).toBeTruthy();
      expect(screen.queryByText(COPY.teamRowMenu.editRoles)).toBeNull();
      expect(screen.queryByText(COPY.teamRowMenu.remove)).toBeNull();
    });
  });

  it('cancelling an invite asks first and sends the invite id, not the row key', async () => {
    // The row's `userId` is the synthetic `invite:<id>`; sending THAT would
    // cancel nothing and report success.
    const api = apiStub({
      teamContext: vi.fn(async () => ({
        customRolesByMember: [],
        assignableRoles: [],
        pendingInvites: [{ id: 'inv-1', email: 'nova@example.com', role: 'CLERK' }],
        invitesEnabled: true,
      })),
    });
    mountTeam(api, ['team:manage']);
    await chooseFromMenu('team-actions-invite:inv-1', COPY.teamRowMenu.cancelInvite);
    fireEvent.click(await screen.findByTestId('team-cancel-invite-confirm-confirm-button'));
    await waitFor(() => {
      expect(api.cancelInvite).toHaveBeenCalledWith('inv-1');
    });
  });

  it('keeps an owner-tier member out of every destructive affordance', async () => {
    const owner = DEMO_CATALOG.governance.ownerRoles[0]!;
    const api = apiStub({
      listTeam: vi.fn(async () => ({
        data: [
          {
            userId: 'owner-1',
            role: owner,
            email: 'dona@example.com',
            name: 'Dona',
            image: null,
            active: true,
            status: 'ENABLED' as const,
          },
        ],
        pagination: PAGINATION,
      })),
    });
    mountTeam(api, ['team:manage']);
    // No kebab at all: every one of its entries is owner-protected, and a menu
    // offering nothing is worse than no menu.
    await waitFor(() => {
      expect(screen.getByTestId('team-grid')).toBeTruthy();
      expect(screen.queryByTestId('team-actions-owner-1')).toBeNull();
    });
  });
});

describe('the invite flow', () => {
  it('reports a DEFERRED grant, which the roster cannot show', async () => {
    const api = apiStub();
    mountTeam(api, ['team:manage']);
    fireEvent.click(await screen.findByTestId('add-admin-button'));

    const form = await screen.findByTestId('invite-form');
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: 'nova@example.com' },
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.inviteMember).toHaveBeenCalledWith('nova@example.com');
    });
    // There is no membership yet, so nothing appears in the table — and a
    // dialog closing over an unchanged roster reads as having done nothing.
    await waitFor(() => {
      expect(screen.getByTestId('team-invite-notice')).toBeTruthy();
    });
  });

  it('says nothing extra when the grant landed immediately', async () => {
    const api = apiStub({
      inviteMember: vi.fn(async () => ({
        ok: true as const,
        data: { status: 'granted' as const },
      })),
    });
    mountTeam(api, ['team:manage']);
    fireEvent.click(await screen.findByTestId('add-admin-button'));
    const form = await screen.findByTestId('invite-form');
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: 'ja@example.com' },
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.inviteMember).toHaveBeenCalledWith('ja@example.com');
    });
    // The new member is simply in the roster; a banner would be noise.
    await waitFor(() => {
      expect(screen.queryByTestId('team-invite-notice')).toBeNull();
    });
  });
});
