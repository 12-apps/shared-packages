/**
 * `@12-apps/chat/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution and the runtime inventory: HTTP routes
 * for a server host, the thread surface for a web host AND for a React Native
 * host. `@12-apps/wiring` is a TYPE-ONLY devDependency; the producer
 * assertions run in this package's own suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const chatManifest = {
  name: "@12-apps/chat",
  contract: 1,
  db: { partial: "prisma/chat.prisma", migrations: "prisma/migrations" },
  observability: { namespace: "chat" },
  server: ["http"],
  web: ["surface"],
  native: ["surface"],
} as const satisfies PackageManifest;
