import {
  createWebAccountDeletion,
  type AccountDeletionSessionHooks,
  type WebAccountDeletion,
  type WebAccountDeletionConfig,
} from "./index";

/** The one-argument config the wiring surface takes: the screens' config and the session hook it reads. */
export type WebAccountDeletionSurfaceConfig = WebAccountDeletionConfig & AccountDeletionSessionHooks;

/**
 * {@link createWebAccountDeletion} as `authAccountDeletionWebManifest`'s
 * surface: a wiring surface factory takes ONE config, so the session hook
 * rides inside it.
 */
export function createWebAccountDeletionSurface(config: WebAccountDeletionSurfaceConfig): WebAccountDeletion {
  const { useSession, ...screens } = config;
  return createWebAccountDeletion(screens, { useSession });
}
