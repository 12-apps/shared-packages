/** Aprovações — the change-request inbox, explorable with no host. */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { changeRequest, API_BASE, surface } from './__stories__/fixtures';
import { LifecycleHttpError } from './transport';

const meta: Meta = { title: 'Approvals' };
export default meta;

/**
 * All three filters answer, so the chips can be switched. The rejected request
 * carries its decision note — the only place a rejection says WHY, and the
 * thing the requester comes back to read.
 */
export const Inbox: StoryObj = {
  name: 'Pending, approved and rejected',
  render: () => {
    const { ApprovalsScreen } = surface({
      [`${API_BASE}/approvals?status=PENDING`]: {
        requests: [
          changeRequest(),
          changeRequest({
            id: 'cr-2',
            action: 'CREATE',
            entityId: null,
            entityType: 'supplier',
            label: 'Distribuidora Sul',
          }),
          changeRequest({
            id: 'cr-3',
            action: 'DELETE',
            entityType: 'category',
            label: 'Bebidas geladas',
            requestedByName: 'Carla Dias',
          }),
        ],
      },
      [`${API_BASE}/approvals?status=APPROVED`]: {
        requests: [
          changeRequest({
            id: 'cr-4',
            status: 'APPROVED',
            label: 'Água com gás 500ml',
            decidedBy: 'u1',
            decidedAt: new Date(Date.UTC(2026, 7, 15, 9, 0)).toISOString(),
          }),
        ],
      },
      [`${API_BASE}/approvals?status=REJECTED`]: {
        requests: [
          changeRequest({
            id: 'cr-5',
            status: 'REJECTED',
            label: 'Cerveja 1L',
            decidedBy: 'u1',
            decidedAt: new Date(Date.UTC(2026, 7, 15, 9, 0)).toISOString(),
            decisionNote: 'Preço abaixo do custo — refaça com a margem combinada.',
          }),
        ],
      },
    });
    return <ApprovalsScreen />;
  },
};

export const Empty: StoryObj = {
  name: 'Nothing pending',
  render: () => {
    const { ApprovalsScreen } = surface({ [`${API_BASE}/approvals`]: { requests: [] } });
    return <ApprovalsScreen />;
  },
};

/**
 * The tenant is not entitled to approvals, or switched them off. A 403 renders
 * a FRIENDLY notice rather than an error state: nothing is broken here, the
 * feature is simply not on.
 */
export const FeatureOff: StoryObj = {
  name: 'Feature off for this store (403)',
  render: () => {
    const { ApprovalsScreen } = surface({
      [`${API_BASE}/approvals`]: new LifecycleHttpError(403, 'Recurso não está ativo.'),
    });
    return <ApprovalsScreen />;
  },
};
