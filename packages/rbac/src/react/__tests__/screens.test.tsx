// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_CATALOG } from '../../__tests__/demo-catalog';

import type { RbacApiClient } from '../api';
import { RbacProvider } from '../context';
import { createRbacLabels } from '../labels';
import { RolesScreen } from '../roles-screen';
import { TeamScreen } from '../team-screen';

/**
 * The packaged screens' affordance gating and destructive-write discipline
 * (12-13, review-150 MAJOR-5 / MINOR-13): `useCan` HIDES what the actor may
 * not do, every destructive act sits behind a confirm step, and a refused
 * write surfaces its user-safe error instead of rendering nothing.
 */

const PAGINATION = { total: 1, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false };

function apiStub(overrides: Partial<RbacApiClient> = {}): RbacApiClient {
  return {
    myPermissions: vi.fn(async () => []),
    listRoles: vi.fn(async () => ({
      data: [
        {
          id: 'r1',
          name: 'Barista',
          description: null,
          permissions: ['stock:read'] as readonly string[],
          kind: 'CUSTOM',
          locked: false,
        },
      ],
      pagination: PAGINATION,
    })),
    createRole: vi.fn(async () => ({ ok: true as const, data: { id: 'r2', name: 'x', description: null, permissions: [] } })),
    updateRole: vi.fn(async () => ({ ok: true as const, data: { id: 'r1', name: 'x', description: null, permissions: [] } })),
    deleteRole: vi.fn(async () => ({ ok: true as const, data: { status: 'deleted' as const } })),
    overrideTemplate: vi.fn(async () => ({ ok: true as const, data: { id: 'r1', name: 'x', description: null, permissions: [] } })),
    resetTemplate: vi.fn(async () => ({ ok: true as const, data: { status: 'reset' as const } })),
    listTeam: vi.fn(async () => ({
      data: [
        {
          userId: 'chef-1',
          role: 'CHEF',
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
      assignableRoles: ['WAITER'],
      pendingInvites: [],
      invitesEnabled: false,
    })),
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
    <RbacProvider permissions={permissions}>
      <RolesScreen
        api={api}
        permissions={DEMO_CATALOG.permissions}
        governance={DEMO_CATALOG.governance}
        labels={createRbacLabels(DEMO_CATALOG.labels)}
        managePermission="roles:manage"
      />
    </RbacProvider>,
  );
}

function mountTeam(api: RbacApiClient, permissions: string[]): void {
  render(
    <RbacProvider permissions={permissions}>
      <TeamScreen
        api={api}
        labels={createRbacLabels(DEMO_CATALOG.labels)}
        systemRoles={['ADMIN', 'MANAGER', 'WAITER', 'CHEF']}
        managePermission="team:manage"
      />
    </RbacProvider>,
  );
}

describe('affordance hiding (useCan)', () => {
  it('hides the write affordances from an actor without roles:manage', async () => {
    mountRoles(apiStub(), ['products:read:all']);
    // The grid is on screen (the read resolved), so the absences below are
    // the gate's verdict, not a not-yet-rendered race — asserted inside
    // waitFor per the flakiness gate's own rule.
    await waitFor(() => {
      expect(screen.getByTestId('roles-grid')).toBeTruthy();
      expect(screen.queryByTestId('add-role-button')).toBeNull();
      expect(screen.queryByTestId('delete-role-Barista')).toBeNull();
      expect(screen.queryByTestId('edit-role-Barista')).toBeNull();
    });
  });

  it('shows them to an actor holding the gate permission', async () => {
    mountRoles(apiStub(), ['roles:manage']);
    await waitFor(() => {
      expect(screen.getByTestId('add-role-button')).toBeTruthy();
    });
    expect(screen.getByTestId('delete-role-Barista')).toBeTruthy();
  });

  it('withholds the team row actions from an actor without team:manage', async () => {
    mountTeam(apiStub(), []);
    await waitFor(() => {
      expect(screen.getByTestId('team-grid')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('team-actions-chef-1'));
    await waitFor(() => {
      // The menu is open (its fallback row proves it) and still offers no
      // write affordance.
      expect(screen.getByText('Sem ações disponíveis')).toBeTruthy();
      expect(screen.queryByText('Editar papéis')).toBeNull();
      expect(screen.queryByText('Remover')).toBeNull();
    });
  });
});

describe('destructive writes sit behind a confirm step', () => {
  it('deleting a role asks first, and Cancelar writes nothing', async () => {
    const api = apiStub();
    mountRoles(api, ['roles:manage']);
    await waitFor(() => {
      expect(screen.getByTestId('delete-role-Barista')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('delete-role-Barista'));
    expect(screen.getByText('Excluir o papel?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    expect(api.deleteRole).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('delete-role-Barista'));
    fireEvent.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => {
      expect(api.deleteRole).toHaveBeenCalledWith('r1');
    });
  });

  it('removing a member asks first with the future-pay consequence copy', async () => {
    const api = apiStub();
    mountTeam(api, ['team:manage']);
    await waitFor(() => {
      expect(screen.getByTestId('team-grid')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('team-actions-chef-1'));
    fireEvent.click(screen.getByText('Remover'));
    expect(screen.getByText('A pessoa perde o acesso ao painel imediatamente.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => {
      expect(api.removeMember).toHaveBeenCalledWith('chef-1');
    });
  });
});

describe('a refused write surfaces its error', () => {
  it('shows the server message when a delete is refused', async () => {
    const api = apiStub({
      deleteRole: vi.fn(async () => ({
        ok: false as const,
        error: 'Você não tem permissão para esta ação.',
      })),
    });
    mountRoles(api, ['roles:manage']);
    await waitFor(() => {
      expect(screen.getByTestId('delete-role-Barista')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('delete-role-Barista'));
    fireEvent.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => {
      expect(screen.getByTestId('roles-error')).toBeTruthy();
    });
  });

  it('shows the owner-protection message when a disable is refused', async () => {
    const api = apiStub({
      setMemberActive: vi.fn(async () => ({
        ok: false as const,
        error: 'Não é possível desativar um proprietário.',
      })),
    });
    mountTeam(api, ['team:manage']);
    await waitFor(() => {
      expect(screen.getByTestId('team-grid')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('team-actions-chef-1'));
    fireEvent.click(screen.getByText('Desativar'));
    await waitFor(() => {
      expect(screen.getByTestId('team-error')).toBeTruthy();
    });
    expect(screen.getByText('Não é possível desativar um proprietário.')).toBeTruthy();
  });
});
