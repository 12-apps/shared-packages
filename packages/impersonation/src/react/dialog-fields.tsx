import { useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Select } from '@12-apps/ui/form/Select';
import { Switch } from '@12-apps/ui/form/Switch';
import { Textarea } from '@12-apps/ui/form/Textarea';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { ImpersonationTenant } from '../core/types';

import type { ImpersonationDialogLabels } from './labels';

/**
 * The fields of the start dialog that are more than a text box: which tenant the
 * session is bounded to, which app it lands in, and the write opt-in with its
 * own warning and its own justification.
 *
 * Split out so the dialog shell stays a shell. Each is a leaf with its own props
 * — the tenant list and the roster probe are fetched HERE rather than by the
 * dialog, so an entry point that already knows its tenant and its app mounts
 * neither.
 */

/** A resolved async read: `null` while pending, `[]` on failure or empty. */
interface AsyncList<T> {
  items: T[];
  pending: boolean;
  failed: boolean;
}

function useAsyncList<T>(load: (() => Promise<T[]>) | undefined): AsyncList<T> {
  const [state, setState] = useState<AsyncList<T>>({
    items: [],
    pending: load !== undefined,
    failed: false,
  });

  useEffect(() => {
    if (!load) {
      setState({ items: [], pending: false, failed: false });
      return undefined;
    }
    let cancelled = false;
    setState({ items: [], pending: true, failed: false });
    load()
      .then((items) => {
        if (!cancelled) setState({ items, pending: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ items: [], pending: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return state;
}

/**
 * Pick the tenant the session is confined to.
 *
 * A tenant is REQUIRED by the endpoint, not a filter on it: the cookie carries
 * one tenant id and every guard reads it, so "view as" is always "view as, in
 * that tenant". Presenting it as a required first choice is what keeps an
 * operator from expecting one session to follow a person across their tenants.
 *
 * Suspended or otherwise unusual tenants are deliberately NOT filtered out by
 * this component — a support call about a suspended tenant is exactly when
 * someone needs to look at it. A host that wants them gone filters in its own
 * `loadTenants`.
 */
export function TenantField({
  labels,
  load,
  value,
  onChange,
}: {
  labels: ImpersonationDialogLabels;
  load: () => Promise<ImpersonationTenant[]>;
  value: ImpersonationTenant | null;
  onChange: (tenant: ImpersonationTenant | null) => void;
}): JSX.Element {
  const { items, pending, failed } = useAsyncList(load);

  return (
    <Select
      size="sm"
      label={labels.tenantField.label}
      placeholder={labels.tenantField.placeholder}
      value={value?.id ?? ''}
      disabled={pending}
      helperText={failed ? labels.tenantField.error : labels.tenantField.helper}
      error={failed}
      options={items.map((row) => ({ value: row.id, label: `${row.name} (/${row.slug})` }))}
      onChange={(event) => {
        const id = String(event.target.value);
        onChange(items.find((candidate) => candidate.id === id) ?? null);
      }}
      data-testid="impersonation-tenant"
    />
  );
}

/**
 * Choose which app the session lands in.
 *
 * EVERY configured app is always offered, because the identities are not
 * mutually exclusive and the roster probe below cannot prove either one: it sees
 * STAFF only, so "not on the roster" is silence about any other membership
 * rather than evidence of one. Offering only what could be proved would hide the
 * correct answer in exactly the case support calls about — someone who both
 * administers a tenant and buys from it.
 */
export function AppField({
  labels,
  apps,
  tenantSlug,
  targetUserId,
  loadStaff,
  value,
  onChange,
}: {
  labels: ImpersonationDialogLabels;
  apps: readonly { value: string; label: string }[];
  tenantSlug: string;
  targetUserId: string;
  /** The tenant's staff user ids. Omitted by a host that cannot answer it. */
  loadStaff?: (tenantSlug: string) => Promise<readonly string[]>;
  value: string;
  onChange: (app: string) => void;
}): JSX.Element {
  const note = useStaffNote(labels, tenantSlug, targetUserId, loadStaff);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Select
        size="sm"
        label={labels.appField.label}
        value={value}
        options={apps.map((app) => ({ value: app.value, label: app.label }))}
        onChange={(event) => onChange(String(event.target.value))}
        data-testid="impersonation-app"
      />
      {note !== null ? (
        <Text as="p" size="xs" color="secondary" data-testid="impersonation-app-note">
          {note}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * What the staff roster says about this person, in the chosen tenant.
 *
 * `null` while there is nothing to say — no tenant yet, the host cannot answer,
 * or the roster is still loading. A `false` means "not staff HERE", never "has
 * no account", which is why the two sentences are worded as they are.
 */
function useStaffNote(
  labels: ImpersonationDialogLabels,
  tenantSlug: string,
  targetUserId: string,
  loadStaff?: (tenantSlug: string) => Promise<readonly string[]>,
): string | null {
  const [staff, setStaff] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (!loadStaff || tenantSlug === '') {
      setStaff(null);
      return undefined;
    }
    let cancelled = false;
    setStaff(null);
    loadStaff(tenantSlug)
      .then((ids) => {
        if (!cancelled) setStaff(ids);
      })
      .catch(() => {
        if (!cancelled) setStaff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadStaff, tenantSlug]);

  if (staff === null) return null;
  return staff.includes(targetUserId)
    ? labels.appField.onStaff
    : labels.appField.notOnStaff;
}

/**
 * The write opt-in — offered ONLY for an app the host marked writable.
 *
 * Three things make it deliberate rather than a checkbox: it is off by default,
 * turning it on raises an unmissable danger alert, and it demands its OWN
 * justification. That last one is not ceremony — the session's reason answers
 * "why look?", and the whole risk of this mechanism is the gap between looking
 * and acting. Making someone write the second sentence is the cheapest deterrent
 * available, and it lands in the same append-only entry.
 */
export function WriteOptIn({
  labels,
  reasonMin,
  allowWrites,
  writeReason,
  onToggle,
  onWriteReason,
}: {
  labels: ImpersonationDialogLabels;
  reasonMin: number;
  allowWrites: boolean;
  writeReason: string;
  onToggle: (next: boolean) => void;
  onWriteReason: (next: string) => void;
}): JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Switch
        checked={allowWrites}
        onChange={(event) => onToggle(event.target.checked)}
        label={labels.writeOptIn.label}
        description={labels.writeOptIn.description}
        dataTestId="impersonation-allow-writes"
      />
      {allowWrites ? (
        <>
          <Alert
            variant="danger"
            title={labels.writeOptIn.warningTitle}
            description={labels.writeOptIn.warningDescription}
            data-testid="impersonation-writes-warning"
          />
          <Textarea
            label={labels.writeOptIn.reasonLabel}
            value={writeReason}
            minRows={2}
            helperText={labels.writeOptIn.reasonHelper({ min: reasonMin })}
            onChange={(event) => onWriteReason(event.target.value)}
            dataTestId="impersonation-write-reason"
          />
        </>
      ) : null}
    </Box>
  );
}
