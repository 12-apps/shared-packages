/**
 * `@12-apps/app-shell/react` — the shell's browser half (12-18).
 *
 * One factory: {@link createWebAppShell}. Everything else exported here is either a
 * seam a consumer legitimately needs on its own (`lazyRoute` for a route table,
 * `useDeviceDetection` for a login button, `createAppTheme` for a second theme,
 * `useCollapsedSections` / `useSidebarRail` for a collapsible nav) or a type it needs
 * to satisfy the config.
 *
 * The contract a consumer is held to, in two lines:
 *
 *  - **Build the shell ONCE, at module scope.** The boundary and the session context
 *    it contains are component types; rebuilding them per render remounts the whole
 *    tree below.
 *  - **`onCrash` is yours.** Report through your own observability adapter, not
 *    straight into the reporter — the adapter is what loads your noise rules, and
 *    without them a crashed page can file an issue for a routine 404.
 */
export {
  createWebAppShell,
  type ShellBrand,
  type ShellConsentConfig,
  type ShellProviderProps,
  type WebAppShell,
  type WebAppShellConfig,
} from './create-web-app-shell';

export {
  TermsConsentDialog,
  type ConsentSignalHook,
  type TermsConsentDialogProps,
} from './consent/terms-consent-dialog';
export {
  useTermsConsent,
  type TermsConsent,
  type UseTermsConsentOptions,
} from './consent/use-terms-consent';

export { lazyRoute } from './lazy-route';
export { useServerDataViews } from './server-data-views';
export { useDeviceDetection, type DeviceDetection } from './device-detection';

export {
  createShellRouteErrorBoundary,
  type RouteCrashReporter,
  type ShellRouteErrorBoundaryConfig,
} from './route-error-boundary';

export {
  createAppTheme,
  DEFAULT_SURFACES,
  DEFAULT_THEME_TOKENS,
  type AppThemeOptions,
  type ModeTokens,
  type PaletteOverride,
  type ThemeMode,
} from './theme';

export {
  messagesOf,
  noLocale,
  type AppShellLocaleHook,
  type AppShellMessages,
} from './messages';

/**
 * The copy mirror, re-exported so a browser host satisfies
 * {@link WebAppShellConfig.messages} without importing the framework-free root
 * for a type. Same declaration either way — see `core/copy.ts`.
 */
export type { AppShellCopyResolver, AppShellCopySource } from '../core/copy';

export {
  sidebarPanelBg,
  sidebarStorageKey,
  useCollapsedSections,
  useSidebarRail,
} from './sidebar-state';
