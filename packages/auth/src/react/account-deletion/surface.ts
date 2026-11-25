import type { AccountDeletionSessionHooks, WebAccountDeletion, WebAccountDeletionConfig } from "./index";
import { lazyAccountDeletion } from "./lazy";

/** The one-argument config the wiring surface takes: the screens' config and the session hook it reads. */
export type WebAccountDeletionSurfaceConfig = WebAccountDeletionConfig & AccountDeletionSessionHooks;

/**
 * The deletion screens as `authAccountDeletionWebManifest`'s surface: a wiring
 * surface factory takes ONE config, so the session hook rides inside it. The
 * screens load on their first render (`./lazy`): the manifest module is
 * imported by a host's shell, so a static import would put them on every
 * page's first paint.
 */
export function createWebAccountDeletionSurface(config: WebAccountDeletionSurfaceConfig): WebAccountDeletion {
  const { useSession, ...screens } = config;
  return lazyAccountDeletion(screens, { useSession });
}
