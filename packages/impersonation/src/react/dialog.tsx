import { useCallback, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Textarea } from '@12-apps/ui/form/Textarea';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { ImpersonationTenant, ImpersonationUser } from '../core/types';

import { AppField, TenantField, WriteOptIn } from './dialog-fields';
import {
  reviewDraft,
  toStartBody,
  writesAvailableFor,
  type DialogRules,
  type ImpersonationDraft,
} from './dialog-form';
import type { ImpersonationDialogLabels } from './labels';
import { startImpersonation, type ImpersonationEndpoints } from './session-control';
import { ImpersonationHttpError } from './transport';

/**
 * The dialog that STARTS an operator session — the one screen this package puts
 * in front of a person before a cookie exists.
 *
 * MOUNTED ONLY WHILE OPEN by its callers, which is why there is no reset effect
 * anywhere below: a fresh open is a fresh component, so a justification typed for
 * one person can never be sitting in the box for the next.
 */

/** Which app a session may land in, and what the picker calls it. */
export interface ImpersonationAppOption {
  value: string;
  label: string;
}

/** Everything the dialog needs that the banner does not. */
export interface DialogParts {
  endpoints: ImpersonationEndpoints;
  labels: ImpersonationDialogLabels;
  rules: DialogRules;
  apps: readonly ImpersonationAppOption[];
  /** The tenants the operator may pick from, when the caller has not decided. */
  loadTenants: () => Promise<ImpersonationTenant[]>;
  /** The tenant's staff user ids, for the note under the app picker. */
  loadStaff?: (tenantSlug: string) => Promise<readonly string[]>;
  /**
   * Where a started session lands.
   *
   * Same-origin and absolute, because the cookie is `path: '/'` with no Domain
   * and is therefore already carried. The dialog opens it in a NEW TAB — the
   * cookie's `SameSite=Lax` is chosen for exactly that top-level navigation, and
   * keeping the operator's own tab where it was is what lets them start a second
   * look without first ending this one.
   */
  landingUrl(parts: { app: string; tenantSlug: string }): string;
}

export interface ImpersonationDialogProps {
  /** The account being looked at, as every entry point already has it. */
  target: ImpersonationUser;
  /** The tenant, when the caller already knows it; `null` puts a picker in. */
  tenant?: ImpersonationTenant | null;
  /** The app, when the caller already knows it; `null` puts a picker in. */
  app?: string | null;
  onClose: () => void;
}

/** Everything the operator can change while the dialog is open. */
interface DialogState {
  tenant: ImpersonationTenant | null;
  app: string;
  reason: string;
  allowWrites: boolean;
  writeReason: string;
}

/**
 * The sentence to show for a failed start.
 *
 * The server's own message is PREFERRED over anything this file could say: the
 * route already wrote the refusal in the operator's terms, and re-deriving those
 * sentences from a status code would mean two wordings of one rule, with the
 * copy that reaches the screen being the one that never saw the refusal.
 */
function startFailureMessage(
  error: unknown,
  labels: ImpersonationDialogLabels,
): string {
  if (error instanceof ImpersonationHttpError) {
    const body = error.body;
    if (body !== null && typeof body === 'object') {
      const candidate = (body as { error?: unknown }).error;
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
    }
    if (error.status === 401) return labels.failure.unauthenticated;
    if (error.status === 403) return labels.failure.forbidden;
    if (error.status === 404) return labels.failure.notFound;
  }
  return labels.failure.generic;
}

/** The read-only default, stated whether or not writes can be asked for. */
function ReadOnlyNote({
  labels,
  writable,
}: {
  labels: ImpersonationDialogLabels;
  writable: boolean;
}): JSX.Element {
  return (
    <Text as="p" size="xs" color="secondary" data-testid="impersonation-readonly-note">
      {writable ? labels.readOnlyNote.writable : labels.readOnlyNote.alwaysReadOnly}
    </Text>
  );
}

/**
 * Everything the operator fills in, in the order the decision is made: what the
 * session IS, then where it acts, then why, then whether it may act at all.
 *
 * `askTenant` / `askApp` are what the caller has NOT already decided. An entry
 * point that answers both renders a justification box and a warning and nothing
 * else — which is the entire reason such an entry point exists.
 */
function DialogFields({
  parts,
  target,
  askTenant,
  askApp,
  state,
  patch,
}: {
  parts: DialogParts;
  target: ImpersonationUser;
  askTenant: boolean;
  askApp: boolean;
  state: DialogState;
  patch: (next: Partial<DialogState>) => void;
}): JSX.Element {
  const { labels, rules } = parts;
  const writable = writesAvailableFor(state.app, rules);
  return (
    <>
      <Alert
        variant="warning"
        title={labels.notice.title}
        description={labels.notice.description}
        data-testid="impersonation-notice"
      />
      {askTenant ? (
        <TenantField
          labels={labels}
          load={parts.loadTenants}
          value={state.tenant}
          onChange={(next) => patch({ tenant: next })}
        />
      ) : null}
      {askApp && state.tenant !== null ? (
        <AppField
          labels={labels}
          apps={parts.apps}
          tenantSlug={state.tenant.slug}
          targetUserId={target.id}
          loadStaff={parts.loadStaff}
          value={state.app}
          onChange={(next) =>
            patch({
              app: next,
              allowWrites: writesAvailableFor(next, rules) && state.allowWrites,
            })
          }
        />
      ) : null}
      <Textarea
        label={labels.reasonField.label}
        value={state.reason}
        minRows={2}
        helperText={labels.reasonField.helper({ min: rules.reasonLength.min })}
        onChange={(event) => patch({ reason: event.target.value })}
        dataTestId="impersonation-reason"
      />
      <ReadOnlyNote labels={labels} writable={writable} />
      {writable ? (
        <WriteOptIn
          labels={labels}
          reasonMin={rules.reasonLength.min}
          allowWrites={state.allowWrites}
          writeReason={state.writeReason}
          onToggle={(next) => patch({ allowWrites: next })}
          onWriteReason={(next) => patch({ writeReason: next })}
        />
      ) : null}
    </>
  );
}

/** The blocker sentence plus the two buttons. */
function DialogFooter({
  labels,
  blocker,
  pending,
  onCancel,
  onConfirm,
}: {
  labels: ImpersonationDialogLabels;
  blocker: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {blocker !== null ? (
        <Text as="p" size="xs" color="secondary" data-testid="impersonation-blocker">
          {blocker}
        </Text>
      ) : null}
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button variant="text" onClick={onCancel} dataTestId="impersonation-cancel">
          {labels.cancel}
        </Button>
        <Button
          color="danger"
          disabled={blocker !== null || pending}
          onClick={onConfirm}
          dataTestId="impersonation-confirm"
        >
          {pending ? labels.confirmPending : labels.confirm}
        </Button>
      </Stack>
    </Box>
  );
}

/** The submit half: what is in flight, what failed, and what to do on success. */
function useStart(
  parts: DialogParts,
  state: DialogState,
  onClose: () => void,
): { pending: boolean; error: unknown; submit: (body: unknown) => void } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = useCallback(
    (body: unknown) => {
      setPending(true);
      setError(null);
      startImpersonation(parts.endpoints, {
        path: parts.endpoints.platformPath,
        body,
      })
        .then((result) => {
          if (!result.started) {
            // The banner never painted, so the session was undone. Reported as a
            // failure rather than a silent close: an operator told "it opened"
            // would go looking for a tab that is not there.
            setError(new Error(result.refusal));
            return;
          }
          window.open(
            parts.landingUrl({ app: state.app, tenantSlug: state.tenant?.slug ?? '' }),
            '_blank',
            'noopener',
          );
          onClose();
        })
        .catch(setError)
        .finally(() => setPending(false));
    },
    [parts, state.app, state.tenant, onClose],
  );

  return { pending, error, submit };
}

export function bindImpersonationDialog(
  parts: DialogParts,
): (props: ImpersonationDialogProps) => JSX.Element {
  return function ImpersonationDialog({
    target,
    tenant = null,
    app = null,
    onClose,
  }): JSX.Element {
    const [state, setState] = useState<DialogState>({
      tenant,
      app: app ?? parts.apps[0]?.value ?? '',
      reason: '',
      allowWrites: false,
      writeReason: '',
    });
    const { pending, error, submit } = useStart(parts, state, onClose);

    const draft: ImpersonationDraft = {
      tenantId: state.tenant?.id ?? '',
      targetApp: state.app,
      reason: state.reason,
      allowWrites: state.allowWrites,
      writeReason: state.writeReason,
    };
    const review = reviewDraft(draft, parts.rules);

    function patch(next: Partial<DialogState>): void {
      setState((previous) => ({ ...previous, ...next }));
    }

    function confirm(): void {
      if (review.blocker !== null || pending) return;
      submit(toStartBody(draft, target.id, review.reason, parts.rules));
    }

    return (
      <Dialog
        open
        onClose={onClose}
        title={parts.labels.title({ target: target.email })}
        size="sm"
        showCloseButton
        dataTestId="impersonation-dialog"
      >
        <DialogContent>
          <Stack spacing={2}>
            <DialogFields
              parts={parts}
              target={target}
              askTenant={tenant === null}
              askApp={app === null}
              state={state}
              patch={patch}
            />
            {error !== null ? (
              <Alert
                variant="danger"
                title={parts.labels.errorTitle}
                description={startFailureMessage(error, parts.labels)}
                data-testid="impersonation-error"
              />
            ) : null}
            <DialogFooter
              labels={parts.labels}
              blocker={review.blocker}
              pending={pending}
              onCancel={onClose}
              onConfirm={confirm}
            />
          </Stack>
        </DialogContent>
      </Dialog>
    );
  };
}
