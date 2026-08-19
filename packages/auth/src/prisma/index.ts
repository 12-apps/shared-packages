/**
 * The persistence half of `@12-apps/auth`, over the package's OWN tables.
 *
 * `prisma/auth.prisma` (copied into a host's schema folder by
 * `pnpm --filter @12-apps/auth prisma:sync`) owns `auth_credentials`,
 * `auth_tokens` and `auth_platform_settings`; the migrations beside it are
 * discovered structurally by the host. Nothing here imports `@prisma/client` —
 * the client is duck-typed, so this package never resolves a generated client
 * and installs into a repo that generates its own somewhere else.
 */
export {
  createPrismaEmailCredentialsStore,
  type AuthDb,
  type AuthDbProvider,
  type EmailIdentity,
  type EmailIdentityDelegate,
  type PrismaCredentialsStoreConfig,
} from "./store";

export {
  createAuthSettingsStore,
  AUTH_SETTING_KEYS,
  DEFAULT_AUTH_SETTINGS,
  type AuthSettingsAuditEntry,
  type AuthSettingsDb,
  type AuthSettingsDbProvider,
  type AuthSettingsStore,
  type AuthSettingsStoreConfig,
} from "./settings-store";
