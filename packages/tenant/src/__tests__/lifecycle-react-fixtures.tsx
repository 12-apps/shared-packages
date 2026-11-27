/**
 * A host that is NOT the one the screens were extracted from: a hospital
 * network. Its pack writes every key as a marker (`«h.<key>»`, a sentence
 * echoing its values), so a test can strip every marker and every value it
 * passed and prove nothing else is left on screen: every word is the pack's.
 * Its codes, paths and test-id word are its own too.
 */
import { forwardRef, useState, type ReactNode } from 'react';
import { vi } from 'vitest';

import { TENANT_COPY_SHAPE } from '../config';
import {
  TENANT_LIFECYCLE_SCREENS_COPY_SHAPE,
  type TenantClosingBlocker,
  type TenantClosingScreensConfig,
  type TenantClosingState,
  type TenantClosingView,
  type TenantEmphasis,
  type TenantLifecycleCopy,
  type TenantLifecyclePin,
  type TenantMutation,
  type TenantPlatformArchiveConfig,
  type TenantQuery,
} from '../lifecycle/react';

const mark = (key: string, args: readonly unknown[] = []) =>
  args.length === 0 ? `«h.${key}»` : `«h.${key}(${args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join('|')})»`;

/** The emphasis sentences: the bold part is the first value (or the key), so a test finds it in a `<b>`. */
const EMPHASIS = new Set(['platformFactEmail', 'platformFactPurge', 'platformArchived', 'platformPurgeFact']);

function emphasis(key: string, args: readonly unknown[]): TenantEmphasis {
  const first = args[0];
  const bold = typeof first === 'object' && first !== null ? (first as { day: string }).day : String(first);
  return { before: `«h.${key}:`, bold, after: `:${mark(key, args)}»` };
}

export const HOSPITAL_PACK = Object.fromEntries(
  [...Object.entries(TENANT_COPY_SHAPE), ...Object.entries(TENANT_LIFECYCLE_SCREENS_COPY_SHAPE)].map(([key, kind]) => [
    key,
    kind === 'text'
      ? mark(key)
      : (...args: unknown[]) => (EMPHASIS.has(key) ? emphasis(key, args) : mark(key, args)),
  ]),
) as unknown as TenantLifecycleCopy;

/** Strip every marker and every value the test passed: what is left was not the pack's. */
export function wordsNotFromPack(text: string, values: readonly string[]): string {
  let left = text;
  // Markers nest (an emphasis wraps its own marker), so strip from the inside out.
  for (let round = 0; round < 4; round += 1) left = left.replace(/«h\.[^«»]*»/gu, '');
  for (const value of values) left = left.split(value).join('');
  return left.replace(/[\s.,:;|()·-]/gu, '');
}

export const NAME = 'Hospital Santa Clara';
const DAY = (iso: string) => `D[${iso.slice(0, 10)}]`;

interface PinState extends TenantLifecyclePin {
  /** The host's own field (proves the wider pin type fits). */
  mode: 'enter';
}

export function pin(overrides: Partial<PinState> = {}): PinState {
  return { mode: 'enter', ready: true, busy: false, confirm: vi.fn(async () => true), ...overrides };
}

export function query<T>(data: T | undefined, overrides: Partial<TenantQuery<T>> = {}): TenantQuery<T> {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...overrides };
}

export function view(overrides: Partial<TenantClosingView> = {}): TenantClosingView {
  return { status: 'OPEN', requestedAt: null, purgeAt: null, name: NAME, blockers: [], ...overrides };
}

export const BLOCKERS: TenantClosingBlocker[] = [
  { kind: 'admissions', count: 2, path: 'wards/admissions' },
  { kind: 'invoices', count: 1, path: 'billing' },
];

/** A write whose outcome the test decides: `run` answers or throws. */
function useFakeMutation<V, R>(run: (variables: V) => Promise<R>): TenantMutation<V, R> {
  const [state, setState] = useState<{ isPending: boolean; isSuccess: boolean; error: Error | null }>({
    isPending: false,
    isSuccess: false,
    error: null,
  });
  const go = async (variables: V): Promise<R> => {
    setState({ isPending: true, isSuccess: false, error: null });
    try {
      const answer = await run(variables);
      setState({ isPending: false, isSuccess: true, error: null });
      return answer;
    } catch (failure) {
      setState({ isPending: false, isSuccess: false, error: failure as Error });
      throw failure;
    }
  };
  return {
    ...state,
    isError: state.error !== null,
    mutate: (variables, options) => {
      go(variables).then(options?.onSuccess, () => undefined);
    },
    mutateAsync: go,
  };
}

/** What the fake host's hooks answer; each test sets what it needs. */
export interface HostState {
  view: TenantQuery<TenantClosingView>;
  state: TenantQuery<TenantClosingState>;
  holds: boolean;
  pathname: string;
  pin: PinState;
  exportRun: () => Promise<unknown>;
  closeRun: (answer: { reason: string; typedName: string }) => Promise<unknown>;
  reopenRun: () => Promise<{ status: string }>;
  stateEnabled: boolean[];
}

export function hostState(overrides: Partial<HostState> = {}): HostState {
  return {
    view: query(view()),
    state: query<TenantClosingState>(undefined),
    holds: true,
    pathname: '/wards',
    pin: pin(),
    exportRun: vi.fn(async () => ({})),
    closeRun: vi.fn(async () => ({})),
    reopenRun: vi.fn(async () => ({ status: 'OPEN' })),
    stateEnabled: [],
    ...overrides,
  };
}

const HostLink = forwardRef<HTMLAnchorElement, { to: string; children?: ReactNode }>(function HostLink({ to, children, ...rest }, ref) {
  return (
    <a ref={ref} href={to} {...rest}>
      {children}
    </a>
  );
});

function PinFields({ pin: value }: { pin: PinState }) {
  return <input aria-label="pin" data-testid="host-pin" data-mode={value.mode} />;
}

function UndoNote({ text, dataTestId }: { text: string; dataTestId: string }) {
  return <p data-testid={dataTestId}>{text}</p>;
}

function Frame({ eligible, children }: { eligible: boolean; children: ReactNode }) {
  return (
    <section data-testid="host-frame" data-eligible={String(eligible)}>
      {children}
    </section>
  );
}

function Overlay({ open, onClose, label, dataTestId, children }: { open: boolean; onClose: () => void; label: string; dataTestId: string; children?: ReactNode }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-label={label} data-testid={dataTestId}>
      <button type="button" aria-label="veil" data-testid="host-veil" onClick={onClose} />
      {children}
    </div>
  );
}

const STATUSES = { active: 'OPEN', closing: 'WINDING_DOWN', closed: 'SHUT' } as const;

export function closingConfig(host: HostState, toast = vi.fn()): TenantClosingScreensConfig<PinState> {
  return {
    statuses: STATUSES,
    copy: { locales: { 'x-hospital': HOSPITAL_PACK }, defaultLocale: 'x-hospital' },
    refusals: { closing: 'WARD_WINDING_DOWN', closed: 'WARD_SHUT', readOnly: 'WARD_READ_ONLY' },
    paths: { app: '/console/', api: '/api/console/', closePage: 'settings/wind-down' },
    errorAnswer: (error) =>
      error instanceof Error && 'status' in error
        ? { status: (error as Error & { status: number }).status, body: (error as Error & { body?: unknown }).body, message: error.message }
        : null,
    toast,
    testIdWord: 'ward',
    hooks: {
      useClosingView: () => host.view,
      useClosingState: (_slug, enabled) => {
        host.stateEnabled.push(enabled);
        return host.state;
      },
      useRequestExport: () => useFakeMutation<void, unknown>(() => host.exportRun()),
      useClose: () => useFakeMutation((answer: { reason: string; typedName: string }) => host.closeRun(answer)),
      useReopen: () => useFakeMutation<void, { status: string }>(() => host.reopenRun()),
      useHoldsClose: () => host.holds,
      usePathname: () => host.pathname,
      usePin: () => host.pin,
    },
    components: { PinFields, UndoNote, Link: HostLink, Frame },
    shortDay: DAY,
    nameLocale: 'en-US',
  };
}

export function platformConfig(toast = vi.fn()): TenantPlatformArchiveConfig<PinState> {
  return {
    statuses: { ...STATUSES, closableFrom: ['OPEN', 'ON_HOLD'] },
    copy: { locales: { 'x-hospital': HOSPITAL_PACK }, defaultLocale: 'x-hospital' },
    components: { PinFields, UndoNote, Overlay },
    toast,
  };
}

/** An error as the fake host's API client throws it: the server answered. */
export function answered(status: number, message: string, body: unknown = {}): Error {
  return Object.assign(new Error(message), { status, body });
}

/** A copy of a config with the key at a dotted path left out (the copies on the way are shallow). */
export function withoutKey(config: object, path: string): unknown {
  const [head, ...rest] = path.split('.');
  const bag = { ...(config as Record<string, unknown>) };
  if (head === undefined) return bag;
  if (rest.length === 0) delete bag[head];
  else bag[head] = withoutKey(bag[head] as object, rest.join('.'));
  return bag;
}
