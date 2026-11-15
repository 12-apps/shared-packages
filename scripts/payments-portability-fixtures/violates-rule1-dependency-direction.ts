// RULE 1 violation fixture for the dependency DIRECTION (FUT-4996) — linted
// once as a payments file and once as a card-terminal file. Each may name
// itself and never the other: the point of sale depends on payments, payments
// knows nothing of the terminal flow, and card-terminal depends on nothing of
// payments. So exactly one of these two imports is a violation at each path.
import { createCaptureActs } from '@12-apps/card-terminal/server';
import { createPaymentFlowsBE } from '@12-apps/payments-backend';

export const wired = { createCaptureActs, createPaymentFlowsBE };
