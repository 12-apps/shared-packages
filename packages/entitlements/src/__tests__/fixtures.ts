import { defineFeatures } from '../core/registry';
import { definePlans } from '../core/plans';

/**
 * A Future-Pay-shaped catalog used by the unit suites. The portability suite
 * deliberately does NOT import this — it builds its own from scratch.
 */
export const FEATURES = defineFeatures({
  // Boolean capability, surface disappears when revoked.
  audit: { onRevoke: 'hide', description: 'Trilha de auditoria' },
  // Boolean capability, existing connections deactivate but are retained.
  mcp: { onRevoke: 'disable', description: 'Integração com IA (MCP)' },
  // Numeric quota, existing rows stay usable when the plan shrinks.
  'stock.locations': { kind: 'quota', onRevoke: 'readonly' },
  // Gates writes, so an entitled tenant opts in deliberately.
  approvals: { onRevoke: 'disable', defaultWhenEntitled: false },
  // A delinquent tenant must keep reading their own orders.
  'orders.read': { onRevoke: 'hide', retainWhenRestricted: true },
} as const);

export type AppFeature = (typeof FEATURES.list)[number];

export const PLANS = definePlans(FEATURES, {
  basic: {
    entitlements: { 'orders.read': true, 'stock.locations': 1 },
    description: 'Básico',
  },
  plus: {
    extends: 'basic',
    entitlements: { mcp: true, 'stock.locations': 5 },
    description: 'Plus',
  },
  pro: {
    extends: 'plus',
    entitlements: {
      audit: true,
      approvals: true,
      'stock.locations': 'unlimited',
    },
    description: 'Pro',
  },
} as const);
