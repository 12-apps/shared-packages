// RULE 1 clean counterpart — the same file written portably. Relative imports
// stay inside packages/payments/, node builtins and declared npm dependencies
// are fine, and the other half of the package is reachable by name.
//
// `./harness` is here deliberately: four suites under
// backend/src/checkout/__tests__/ import their own local test harness by that
// name, and an early version of this rule matched the WORD and failed all of
// them. Relative specifiers are judged by where they resolve, so a sibling
// module called `harness` is not the consumer harness at the repo root.
import { createHash } from 'node:crypto';

import type { ChargeInput } from '@12-apps/payments-backend';

import { harness } from './harness';
import { formatMoney } from './money';

export const wired = { createHash, formatMoney, harness };
export type Input = ChargeInput;
