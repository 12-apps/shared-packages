/**
 * The closing screens' hook, widget and reader types accept a real host's
 * shapes. The checks are compile-time: this file is in the package's `tsc`, so
 * narrowing a type the screens take (a react-query result, a toaster, a PIN
 * hook that answers more than the screens read, a router link) fails here
 * instead of in the host's catalog bump.
 *
 * - The reads and writes are react-query's own results.
 * - The toast is `@12-apps/notifications`' toaster.
 * - The PIN carries more than the screens read, and its fields take more props.
 * - The link is a ref-forwarding component whose `to` is wider than a string.
 */
import { forwardRef, type JSX, type ReactNode } from 'react';
import { toast } from '@12-apps/notifications/toast';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type {
  TenantClosingHooks,
  TenantClosingState,
  TenantClosingView,
  TenantErrorAnswer,
  TenantLifecyclePin,
  TenantLink,
  TenantOverlay,
  TenantPinFields,
  TenantToast,
  TenantUndoNote,
} from '../lifecycle/react';

/** A host's PIN hook answer: more than the screens read. */
interface HostPin {
  mode: 'enter' | 'create' | 'unlocked';
  pin: string;
  setPin: (pin: string) => void;
  error: string | null;
  locked: boolean;
  busy: boolean;
  ready: boolean;
  confirm: () => Promise<boolean>;
  lock: () => Promise<void>;
}

function HostPinFields({ pin, onEnter }: { pin: HostPin; onEnter?: () => void }): JSX.Element {
  return <input aria-label={pin.mode} onKeyDown={onEnter} />;
}

function HostUndoNote({ text, dataTestId }: { text: string; dataTestId: string }): JSX.Element {
  return <p data-testid={dataTestId}>{text}</p>;
}

type To = string | { pathname?: string; search?: string };
const HostLink = forwardRef<HTMLAnchorElement, { to: To; replace?: boolean; children?: ReactNode }>(function HostLink(props, ref) {
  return <a ref={ref} href={typeof props.to === 'string' ? props.to : props.to.pathname}>{props.children}</a>;
});

function HostOverlay(props: {
  open: boolean;
  onClose: () => void;
  label: string;
  dataTestId: string;
  dark?: boolean;
  fit?: boolean;
  children?: ReactNode;
}): JSX.Element | null {
  return props.open ? <div aria-label={props.label}>{props.children}</div> : null;
}

class HostApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

declare const viewRead: UseQueryResult<TenantClosingView>;
declare const stateRead: UseQueryResult<TenantClosingState>;
declare const exportWrite: UseMutationResult<{ id: string; status: 'PREPARING' }, Error, void>;
declare const closeWrite: UseMutationResult<TenantClosingView, Error, { reason: string; typedName: string }>;
declare const reopenWrite: UseMutationResult<TenantClosingView, Error, void>;
declare const hostPin: HostPin;

/** Compile-time only: each assignment is the check. */
export function hostShapesFit() {
  const hooks: TenantClosingHooks & { usePin(): HostPin } = {
    useClosingView: () => viewRead,
    useClosingState: () => stateRead,
    useRequestExport: () => exportWrite,
    useClose: () => closeWrite,
    useReopen: () => reopenWrite,
    useHoldsClose: () => true,
    usePathname: () => '/',
    usePin: () => hostPin,
  };
  const pinFields: TenantPinFields<HostPin> = HostPinFields;
  const undo: TenantUndoNote = HostUndoNote;
  const link: TenantLink = HostLink;
  const overlay: TenantOverlay = HostOverlay;
  const hostToast: TenantToast = toast;
  const errorAnswer: TenantErrorAnswer = (error) => (error instanceof HostApiError ? error : null);
  const pin: TenantLifecyclePin = hostPin;
  return { hooks, pinFields, undo, link, overlay, hostToast, errorAnswer, pin };
}

describe('lifecycle host shapes', () => {
  it('are checked by the package type check (this file compiles)', () => {
    expect(typeof hostShapesFit).toBe('function');
  });
});
