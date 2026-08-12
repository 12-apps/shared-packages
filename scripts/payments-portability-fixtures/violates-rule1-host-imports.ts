// RULE 1 violation fixture — linted as packages/payments/backend/src/<file>.
//
// Three distinct ways the package can stop being liftable: a sibling workspace
// package, a relative path that climbs out of packages/payments/, and a reach
// into the consumer harness.
import { getPrismaClient } from '@12-apps/prisma';
import { formatMoney } from '../../../shared-helpers/src/money';
import { harnessMerchant } from '../../../../harness/backend/tests/fixtures';

export const wired = { getPrismaClient, formatMoney, harnessMerchant };
