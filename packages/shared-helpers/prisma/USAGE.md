# Using `getPrismaClient()` in a server action

`@repo/shared-helpers/prisma` exports `getPrismaClient()`, a lazily-initialised,
singleton `PrismaClient`. Call it from a server action (or any server-side
module) to read the rows that `prisma/seed.ts` upserts:

- the seeded **Client** named `Default Client`
- the seeded **Unit** named `Each`

Both rows are returned as the generated Prisma model types (`Client` and
`Unit`), so consumers get full type-safety without hand-written interfaces.

## Prerequisites

Generate the client and seed the baseline rows once:

```bash
pnpm --filter @repo/shared-helpers prisma:generate
pnpm --filter @repo/shared-helpers db:seed
```

## Example: a Next.js server action

```ts
'use server';

import { getPrismaClient } from '@repo/shared-helpers/prisma';
import type { Client, Unit } from '@prisma/client';

/**
 * Reads the seeded baseline Client and Unit via the shared Prisma singleton.
 * The returned records are typed as the generated Prisma models.
 */
export async function getBaselineRecords(): Promise<{
  client: Client;
  unit: Unit;
}> {
  const prisma = await getPrismaClient();

  // The seed (`prisma/seed.ts`) upserts these rows by their unique `name`.
  const client = await prisma.client.findUniqueOrThrow({
    where: { name: 'Default Client' },
  });

  const unit = await prisma.unit.findUniqueOrThrow({
    where: { name: 'Each' },
  });

  return { client, unit };
}
```

## Notes

- `getPrismaClient()` returns a `Promise<PrismaClient>` — always `await` it.
- The instance is a process-wide singleton; do not construct `new
  PrismaClient()` yourself in server actions.
- Because the seed is idempotent, the seeded **Client** and **Unit** are safe
  to assume present after running `db:seed`.
