// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import { useCardActions } from '@12-apps/ui/data-display/CardKit';
import type { RowAction } from '@12-apps/ui/data-display/DataViews';

import { labelsOf } from '../../core/compose';
import { DEMO_CATALOG } from '../../__tests__/demo-catalog';

import type { RbacApiClient } from '../api';
import { RbacProvider } from '../context';
import { createRbacLabels } from '../labels';
import { PT_BR_RBAC_WEB_COPY } from '../pt-BR';
import { RolesScreen, type RolesBulkSlotProps } from '../roles-screen';
import type { RoleRow } from '../role-grid-config';

/**
 * The host's multi-select slot on the roles grid.
 *
 * Four properties, and the two that matter most are the NEGATIVE ones. A slot
 * is an extension point on a screen this package owns, so the failure that
 * costs an adopter is not "the actions are missing" — they would notice that —
 * it is the slot changing the screen for hosts that never asked for it, or
 * offering a batch to a reader who may not perform one.
 */

const PAGINATION = { total: 1, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false };
const COPY = PT_BR_RBAC_WEB_COPY;
const LABELS = createRbacLabels(labelsOf(DEMO_CATALOG));

function apiStub(): RbacApiClient {
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

/** What an adopter writes: chrome of its own, plus entries for the grid. */
function HostSlot({ children }: RolesBulkSlotProps): JSX.Element {
  // The whole reason the slot is a component rendered INSIDE the screen's
  // provider — a host batch reloads the grid through the same refresh the row
  // menus use, with no second channel for it.
  const { onRefresh } = useCardActions();
  const actions: RowAction<RoleRow>[] = [
    {
      id: 'delete',
      label: 'Excluir',
      color: 'danger',
      row: false,
      onSelect: () => onRefresh(),
    },
  ];
  return (
    <>
      <div data-testid="host-bulk-chrome" />
      {children(actions)}
    </>
  );
}

function mount(options: { permissions: string[]; slot?: typeof HostSlot }): void {
  render(
    <MemoryRouter>
      <RbacProvider permissions={options.permissions}>
        <RolesScreen
          api={apiStub()}
          tenantSlug="acervo"
          permissions={DEMO_CATALOG.permissions}
          governance={DEMO_CATALOG.governance}
          labels={LABELS}
          managePermission="roles:manage"
          copy={COPY}
          seeds={new Map()}
          bulkSlot={options.slot}
        />
      </RbacProvider>
    </MemoryRouter>,
  );
}

describe('the roles grid bulk slot', () => {
  it('renders the host chrome and the grid together', async () => {
    mount({ permissions: ['roles:manage'], slot: HostSlot });

    await waitFor(() => expect(screen.getByTestId('roles-grid')).toBeTruthy());
    expect(screen.getByTestId('host-bulk-chrome')).toBeTruthy();
  });

  it('reaches this screen own card-actions provider from inside the slot', async () => {
    // `useCardActions()` throws outside a provider, so the slot rendering at
    // all is the assertion: it proves the slot sits INSIDE the provider rather
    // than beside it, which is what gives a host batch its refresh.
    expect(() => mount({ permissions: ['roles:manage'], slot: HostSlot })).not.toThrow();

    await waitFor(() => expect(screen.getByTestId('host-bulk-chrome')).toBeTruthy());
  });

  it('renders the grid UNCHANGED when a host supplies no slot', async () => {
    // The load-bearing case. Every adopter that never heard of this feature
    // must get exactly the screen it had before, so the default cannot be a
    // slot that renders `children([])`.
    mount({ permissions: ['roles:manage'] });

    // The absence rides inside the SAME wait as the positive: `getByTestId`
    // throws until the grid renders, so the wait is driven by something
    // appearing rather than by something being gone — which is what
    // `test-flakiness/no-element-removal-check` asks for, and it is right to.
    await waitFor(() => {
      expect(screen.getByTestId('roles-grid')).toBeTruthy();
      expect(screen.queryByTestId('host-bulk-chrome')).toBeNull();
    });
  });

  it('withholds the slot actions from a reader who may not manage roles', async () => {
    // The screen already hides the row menu and the create button from such a
    // reader. A batch entry is strictly more destructive than either, so it
    // follows the same gate rather than trusting the host to remember.
    mount({ permissions: [], slot: HostSlot });

    await waitFor(() => {
      expect(screen.queryByTestId('roles-grid')).toBeNull();
    });
  });
});
