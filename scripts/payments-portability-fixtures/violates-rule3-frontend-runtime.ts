// RULE 3 violation fixture — linted as packages/payments/frontend/src/<file>.
//
// Every shape that drags a runtime value across the seam: a named value import,
// a value mixed in beside inline types, a default binding, a namespace binding,
// a bare side-effect import, a value re-export and a dynamic import.
import { createPaymentsGateway } from '@12-apps/payments-backend';
import { defineProviders, type ChargeInput } from '@12-apps/payments-backend';
import gateway from '@12-apps/payments-backend';
import * as backend from '@12-apps/payments-backend';
import '@12-apps/payments-backend';

export { createMemoryChargeStore } from '@12-apps/payments-backend';

export async function lazy() {
  return import('@12-apps/payments-backend/providers/stripe');
}

export const used = { createPaymentsGateway, defineProviders, gateway, backend };
export type Input = ChargeInput;
