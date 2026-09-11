// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { labelsOf } from '../../core/compose';
import { DEMO_CATALOG } from '../../__tests__/demo-catalog';

import type { RbacApiClient, RoleListRowWire } from '../api';
import { RbacProvider } from '../context';
import { createRbacLabels } from '../labels';
import { PT_BR_RBAC_WEB_COPY } from '../pt-BR';
import { toRoleRow } from '../role-grid-config';
import { RolesScreen } from '../roles-screen';

/**
 * WHAT THE ROLES GRID PUTS IN ITS TWO WORD COLUMNS (12-13 · FUT-1747).
 *
 * A seeded role is keyed by a NAME and read as a sentence, and the endpoint
 * sends both: the stored pair, which every write and every drift comparison is
 * made against, and the displayed pair, resolved from the host's catalog for
 * the reader this request belongs to. These cases pin which of the two reaches
 * the screen — and, in the last one, that a host whose endpoint sends neither
 * gets exactly the grid it had before this existed.
 */

const PAGINATION = { total: 2, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false };
const LABELS = createRbacLabels(labelsOf(DEMO_CATALOG));

/** A seeded row as the packaged endpoint answers it, and the tenant's own beside it. */
const ROWS: RoleListRowWire[] = [
  {
    id: 'r1',
    name: 'CLERK',
    description: 'Works the counter.',
    displayName: 'Atendente de balcão',
    displayDescription: 'Trabalha no balcão.',
    permissions: ['copies:read'],
    kind: 'SYSTEM',
    locked: false,
  },
  {
    id: 'r2',
    name: 'Voluntário',
    description: 'Ajuda no acervo',
    displayName: 'Voluntário',
    displayDescription: 'Ajuda no acervo',
    permissions: ['copies:read'],
    kind: 'CUSTOM',
    locked: false,
  },
];

function apiStub(rows: RoleListRowWire[]): RbacApiClient {
  return {
    myPermissions: vi.fn(async () => []),
    listRoles: vi.fn(async () => ({ data: rows, pagination: PAGINATION })),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    overrideTemplate: vi.fn(),
    resetTemplate: vi.fn(),
    listTeam: vi.fn(async () => ({ data: [], pagination: PAGINATION })),
    inviteMember: vi.fn(),
    grantMemberRole: vi.fn(),
    revokeMemberRole: vi.fn(),
    setMemberActive: vi.fn(),
    removeMember: vi.fn(),
  } as unknown as RbacApiClient;
}

function mount(rows: RoleListRowWire[]): void {
  render(
    <MemoryRouter>
      <RbacProvider permissions={['roles:manage']}>
        <RolesScreen
          api={apiStub(rows)}
          tenantSlug="acervo"
          permissions={DEMO_CATALOG.permissions}
          governance={DEMO_CATALOG.governance}
          labels={LABELS}
          managePermission="roles:manage"
          copy={PT_BR_RBAC_WEB_COPY}
          seeds={new Map()}
        />
      </RbacProvider>
    </MemoryRouter>,
  );
}

describe('the words the roles grid shows', () => {
  it('reads a seeded role by its displayed name and sentence, not by its key', async () => {
    mount(ROWS);

    await waitFor(() => expect(screen.getByTestId('roles-grid')).toBeTruthy());
    const grid = screen.getByTestId('roles-grid');
    expect(grid.textContent).toContain('Atendente de balcão');
    expect(grid.textContent).toContain('Trabalha no balcão.');
    // The key is still what the row ACTS on — it simply is not what is read.
    expect(grid.textContent).not.toContain('Works the counter.');
  });

  it('shows a tenant own role exactly as the tenant named it', async () => {
    mount(ROWS);

    await waitFor(() => expect(screen.getByTestId('roles-grid')).toBeTruthy());
    expect(screen.getByTestId('roles-grid').textContent).toContain('Voluntário');
  });

  it('falls back to the stored pair when the endpoint sends no displayed one', async () => {
    // A host serving `GET /roles` itself, or one whose catalog contributes no
    // role words. The grid it had before this existed is the one it keeps.
    const wire: RoleListRowWire = {
      id: 'r3',
      name: 'LEGACY',
      description: 'Left over.',
      permissions: ['copies:read'],
      kind: 'SYSTEM',
      locked: false,
    };
    expect(toRoleRow(wire, new Map())).toMatchObject({
      displayName: 'LEGACY',
      displayDescription: 'Left over.',
    });

    mount([wire]);
    await waitFor(() => expect(screen.getByTestId('roles-grid')).toBeTruthy());
    expect(screen.getByTestId('roles-grid').textContent).toContain('LEGACY');
  });

  it('keeps the drift comparison on the STORED description, never the displayed one', async () => {
    // The trap this closes: a seeded row reading in the reader's language is
    // NOT an edited row. Comparing the displayed sentence against the seed
    // would mark every translated row "Sistema · editado" for a pt-BR reader
    // and none of them for an en-US one.
    const seeds = new Map([
      ['CLERK', { permissions: ['copies:read'] as readonly string[], description: 'Works the counter.' }],
    ]);
    expect(toRoleRow(ROWS[0]!, seeds)).toMatchObject({ overridden: false });
  });
});
