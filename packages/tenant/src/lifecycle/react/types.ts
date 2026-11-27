/**
 * What the host injects into the closing screens: its widgets, its data hooks
 * and its readers. Each is typed as the narrowest shape the screens call, so a
 * host's real one (a react-query result, its PIN hook, its router link, its
 * toast) fits as it is (`lifecycle-host-shapes.test.tsx` checks that at compile
 * time).
 */
import type { JSXElementConstructor, ReactNode } from 'react';

/** One kind of item that still blocks a close, with how many. */
export interface TenantClosingBlocker {
  /** One of the host's own blocker kinds; the pack's `blocker(kind, count)` names it. */
  kind: string;
  count: number;
  /** The path, under the tenant's own route, that resolves it (the close page's shortcut). */
  path?: string;
}

/** The close page's read: the tenant's lifecycle state and its blockers. */
export interface TenantClosingView {
  status: string;
  /** ISO: when the tenant went offline; null while open. */
  requestedAt: string | null;
  /** ISO: when its data is deleted; null while open. */
  purgeAt: string | null;
  /** The tenant's name, as the close dialog asks it typed. */
  name: string;
  blockers: readonly TenantClosingBlocker[];
}

/** The banner's read. */
export type TenantClosingState = Pick<TenantClosingView, 'status' | 'requestedAt' | 'purgeAt'>;

/** A read as the screens use it (a react-query `UseQueryResult` fits). */
export interface TenantQuery<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
}

/** A write as the screens use it (a react-query `UseMutationResult` fits). */
export interface TenantMutation<V, R> {
  mutate(variables: V, options?: { onSuccess?: (answer: R) => void }): void;
  mutateAsync(variables: V): Promise<R>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
}

/** What the close sends once the PIN unlocked it. */
export interface TenantCloseAnswer {
  reason: string;
  typedName: string;
}

/** The host's data hooks for the owner's close page and banner. Each refetches what it must on success. */
export interface TenantClosingHooks {
  /** The close page's read. */
  useClosingView(slug: string): TenantQuery<TenantClosingView>;
  /** The banner's read; `enabled` is false for whoever does not hold the close permission. */
  useClosingState(slug: string, enabled: boolean): TenantQuery<TenantClosingState>;
  /** Ask for the data export (the link goes by e-mail). */
  useRequestExport(slug: string): TenantMutation<void, unknown>;
  /** Close; the host re-reads every screen on success. */
  useClose(slug: string): TenantMutation<TenantCloseAnswer, unknown>;
  /** Reopen; answers the status it restored. The host re-reads every screen on success. */
  useReopen(slug: string): TenantMutation<void, { status: string }>;
  /** Whether the person on screen holds the close permission. */
  useHoldsClose(): boolean;
  /** The router's current path (the banner hides on the close page). */
  usePathname(): string;
}

/** The person's PIN for a dangerous act, as the screens use it. The host's own hook may carry more. */
export interface TenantLifecyclePin {
  /** The button may light: unlocked, or the fields filled. */
  ready: boolean;
  /** The PIN is with the server: the popup holds its buttons. */
  busy: boolean;
  /** True once the server unlocked the act and the popup is still up. */
  confirm(): Promise<boolean>;
}

/** The host's PIN fields, drawn for the pin its hook answers. */
export type TenantPinFields<P extends TenantLifecyclePin> = JSXElementConstructor<{ pin: P }>;

/** The host's note for what cannot be undone, set apart. */
export type TenantUndoNote = JSXElementConstructor<{ text: string; dataTestId: string }>;

/** The host's router link: the blocker shortcut renders as it. */
export type TenantLink = JSXElementConstructor<{ to: string; children?: ReactNode }>;

/** The host's frame around the close page (an intro, a welcome); `eligible` is false unless the tenant is open. */
export type TenantClosePageFrame = JSXElementConstructor<{ eligible: boolean; children: ReactNode }>;

/**
 * The host's overlay shell: a right side panel on a computer, a bottom sheet
 * on a phone. The package fills it (title row, a body that is the only
 * scroller, the actions pinned to the bottom); the shell's content area must be
 * a flex column of bounded height. The veil and Escape call `onClose`, and the
 * shell returns focus to its opener when it closes.
 */
export type TenantOverlay = JSXElementConstructor<{
  open: boolean;
  onClose: () => void;
  /** Names the dialog for a screen reader. */
  label: string;
  dataTestId: string;
  children?: ReactNode;
}>;

/** One toast action. */
export interface TenantToastAction {
  label: string;
  onClick: () => void;
}

/** The host's toast (a `@12-apps/notifications` toaster fits). */
export type TenantToast = (
  message: string,
  options: {
    id?: string;
    severity: 'success' | 'warning';
    duration?: number;
    dismissible?: boolean;
    assertive?: boolean;
    testId: string;
    actions?: readonly TenantToastAction[];
  },
) => unknown;

/** The server's answer an error carries, or null when the request never reached it (the host's `ApiError`). */
export type TenantErrorAnswer = (error: unknown) => { status: number; body: unknown; message: string } | null;
