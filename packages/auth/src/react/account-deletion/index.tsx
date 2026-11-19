/**
 * "Excluir minha conta" and the grace-period screen (FUT-5322), the package's
 * half of `createApiAuth({ accountDeletion })`. The host mounts the page where
 * its account area puts it, and renders the pending screen in place of
 * everything else while the session carries `deletion`.
 *
 * The page decides nothing: what blocks, what is lost and how to confirm is
 * the route's answer, checked again on the button. No dialog on top (ADR 0150
 * in Future Pay): the password is the confirmation, the grace window is the
 * undo, and what cannot be undone after it is said apart, under the button.
 */
import { useCallback, useEffect, useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { purgeDateWords } from "../../account-deletion/copy";
import type { DeletionReport } from "../../account-deletion/types";
import { EN_US_ACCOUNT_DELETION_SCREEN, PT_BR_ACCOUNT_DELETION_SCREEN, type AccountDeletionScreenCopy } from "./copy";

export { EN_US_ACCOUNT_DELETION_SCREEN, PT_BR_ACCOUNT_DELETION_SCREEN };
export type { AccountDeletionScreenCopy };

export interface WebAccountDeletionConfig {
  /** Where the host mounted the routes (`GET`, `POST`, `POST …/cancel`). */
  readonly mount: string;
  readonly locale?: "pt-BR" | "en-US";
  /** Start a Google sign-in that returns to the page (the host's `signIn`). */
  readonly signInWithGoogle: () => void;
  /** End this browser's session (the host's `signOut`), then leave. */
  readonly signOut: () => Promise<void>;
  /** Where to go after scheduling or cancelling (default `/`, `/account`). */
  readonly afterSchedule?: string;
  readonly afterCancel?: string;
  readonly fetchImpl?: typeof fetch;
  readonly copy?: AccountDeletionScreenCopy;
}

/** The pending deletion a session answer carries, if any. */
export function pendingDeletionOf(session: unknown): { purgeAt: string } | null {
  const deletion = (session as { deletion?: { purgeAt?: unknown } } | null)?.deletion;
  return deletion && typeof deletion.purgeAt === "string" ? { purgeAt: deletion.purgeAt } : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function call<T>(fetchImpl: typeof fetch, url: string, body?: unknown): Promise<T> {
  const response = await fetchImpl(url, body === undefined ? { credentials: "same-origin" } : {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "");
  return payload.data as T;
}

function Facts({ items, mark }: { items: readonly string[]; mark: "×" | "✓" }): JSX.Element {
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
      {items.map((item) => (
        <Box component="li" key={item} sx={{ display: "flex", gap: 1 }}>
          <Text as="span" color="secondary" aria-hidden>{mark}</Text>
          <Text as="span">{item}</Text>
        </Box>
      ))}
    </Box>
  );
}

function Notice({ title, rows, testId }: { title: string; rows: ReadonlyArray<{ text: string; href: string; action: string }>; testId: string }): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Alert variant="warning" title={title} data-testid={testId}>
      <Box component="ul" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.5 }}>
        {rows.map((row, index) => (
          <li key={`${row.href}-${index}`}>
            {row.text}{" "}
            <Box component="a" href={row.href} sx={{ color: "inherit", fontWeight: 600 }}>{row.action}</Box>
          </li>
        ))}
      </Box>
    </Alert>
  );
}

export interface WebAccountDeletion {
  /** "Excluir minha conta": the whole screen. */
  readonly DeleteAccountPage: (props: { blockerAction?: (kind: string) => string; forfeitAction?: string }) => JSX.Element;
  /** "Sua conta será excluída em <data>": the only screen while pending. */
  readonly PendingDeletionScreen: (props: { purgeAt: string }) => JSX.Element;
}

export function createWebAccountDeletion(config: WebAccountDeletionConfig): WebAccountDeletion {
  const locale = config.locale ?? "pt-BR";
  const copy = config.copy ?? (locale === "en-US" ? EN_US_ACCOUNT_DELETION_SCREEN : PT_BR_ACCOUNT_DELETION_SCREEN);
  const fetchImpl: typeof fetch = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const dateOf = (iso: string): string => purgeDateWords(new Date(iso), locale);

  function DeleteAccountPage({ blockerAction = () => copy.settleFirst, forfeitAction = "" }: { blockerAction?: (kind: string) => string; forfeitAction?: string }): JSX.Element {
    const [report, setReport] = useState<DeletionReport | null | "failed">(null);
    const [password, setPassword] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const load = useCallback(() => {
      call<DeletionReport>(fetchImpl, config.mount).then(setReport, () => setReport("failed"));
    }, []);
    useEffect(load, [load]);
    if (report === null) return <LoadingState dataTestId="delete-account-loading" />;
    if (report === "failed") return <Alert variant="danger" description={copy.loadFailed} />;
    const google = report.confirm === "google";
    const ready = report.canSchedule && (google ? report.freshSignIn : password.length > 0);
    const submit = async (): Promise<void> => {
      setPending(true);
      setError(null);
      try {
        await call(fetchImpl, config.mount, google ? {} : { password });
        await config.signOut().catch(() => undefined);
        globalThis.location.assign(config.afterSchedule ?? "/");
      } catch (failure) {
        setError(failure instanceof Error && failure.message ? failure.message : copy.failed);
        setPending(false);
      }
    };
    return (
      <Box data-testid="delete-account-view" sx={{ display: "grid", gap: 2.5, containerType: "inline-size" }}>
        <Box sx={{ display: "grid", gap: 1, "@container (min-width: 560px)": { gridTemplateColumns: "1fr 1fr", columnGap: 3 } }}>
          <Facts items={copy.goes} mark="×" />
          <Facts items={copy.stays} mark="✓" />
        </Box>
        <Notice title={copy.settleFirst} testId="delete-account-blockers" rows={report.blockers.map((b) => ({ text: b.label, href: b.href, action: blockerAction(b.kind) }))} />
        <Notice title={copy.forfeitTitle} testId="delete-account-forfeits" rows={report.forfeits.map((f) => ({ text: `${f.amount} — ${f.label}.`, href: f.href, action: forfeitAction }))} />
        {google ? (
          <Box sx={{ display: "grid", gap: 1, justifyItems: "start" }}>
            <Text as="p" size="sm">{report.freshSignIn ? copy.googleFresh : copy.googleLead}</Text>
            {report.freshSignIn ? null : (
              <Button variant="outline" color="primary" size="md" onClick={config.signInWithGoogle} dataTestId="delete-account-google">{copy.googleAction}</Button>
            )}
          </Box>
        ) : (
          <Box sx={{ maxWidth: 360, width: "100%" }}>
            <Input label={copy.passwordLabel} type="password" fullWidth autoComplete="current-password" value={password} disabled={!report.canSchedule} error={error !== null} helperText={error ?? undefined} onChange={(event: { target: { value: string } }) => setPassword(event.target.value)} data-testid="delete-account-password" />
          </Box>
        )}
        <Box sx={{ display: "grid", gap: 0.5 }}>
          <Text as="p" size="sm" color="secondary">{copy.when(dateOf(new Date(Date.now() + report.graceDays * DAY_MS).toISOString()))}</Text>
          <Text as="p" size="sm" color="secondary">{copy.irreversible(report.graceDays)}</Text>
        </Box>
        <Box>
          <Button variant="solid" color="primary" size="md" loading={pending} disabled={!ready || pending} onClick={() => void submit()} dataTestId="delete-account-submit">{copy.submit}</Button>
        </Box>
      </Box>
    );
  }

  function PendingDeletionScreen({ purgeAt }: { purgeAt: string }): JSX.Element {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cancel = async (): Promise<void> => {
      setBusy(true);
      try {
        await call(fetchImpl, `${config.mount}/cancel`, {});
        globalThis.location.assign(config.afterCancel ?? "/account");
      } catch (failure) {
        setError(failure instanceof Error && failure.message ? failure.message : copy.failed);
        setBusy(false);
      }
    };
    return (
      <Box data-testid="deletion-pending-view" sx={{ maxWidth: 480, mx: "auto", width: "100%", px: 2, py: 4, display: "grid", gap: 2 }}>
        <Text as="h1" variant="heading">{copy.pendingTitle(dateOf(purgeAt))}</Text>
        <Text as="p" color="secondary">{copy.pendingBody}</Text>
        {error ? <Text as="p" size="sm" color="danger">{error}</Text> : null}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Button variant="solid" color="primary" size="md" loading={busy} disabled={busy} onClick={() => void cancel()} dataTestId="deletion-pending-cancel">{copy.pendingCancel}</Button>
          <Button variant="outline" color="primary" size="md" disabled={busy} onClick={() => void config.signOut().then(() => globalThis.location.assign("/"))} dataTestId="deletion-pending-sign-out">{copy.pendingSignOut}</Button>
        </Box>
      </Box>
    );
  }

  return { DeleteAccountPage, PendingDeletionScreen };
}
