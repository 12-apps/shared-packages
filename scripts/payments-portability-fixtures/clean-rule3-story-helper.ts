/**
 * A story HELPER may stand up the real backend.
 *
 * `packages/payments/frontend/package.json` ships `files` with
 * `!src/stories/**`, so nothing here reaches a consumer's bundle — the harm
 * rule 3 names is unreachable. And the fidelity matters: a story driving a
 * stubbed component goes green while the real screen is broken, which is the
 * one thing the Storybook exists to catch.
 */
import { createPaymentFlowsBE, createPaymentsGateway } from "@12-apps/payments-backend";

export const backend = { createPaymentFlowsBE, createPaymentsGateway };
