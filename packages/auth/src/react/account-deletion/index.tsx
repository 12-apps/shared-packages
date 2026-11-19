/**
 * "Excluir minha conta" and the grace-period screen, the web half of
 * `createApiAuth({ accountDeletion })`, built by `createWebAuth({ accountDeletion })`
 * from that web auth's own session (`signIn`, `signOut`).
 *
 * The page decides nothing: what blocks, what is lost and how to confirm is
 * the route's answer, checked again on the button. There is no dialog on top:
 * the password is the confirmation, the grace window is the undo, and what
 * cannot be undone after it is said apart, under the button.
 *
 * What goes and what stays (`facts`) is the host's to say: it is a promise
 * about the host's own data, so the package ships none.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { purgeDateWords } from "../../account-deletion/copy";
import type { DeletionReport } from "../../account-deletion/types";
import type { AccountDeletionScreenCopy } from "./copy";
import { EN_US_ACCOUNT_DELETION_SCREEN } from "./copy.en-US";
import { PT_BR_ACCOUNT_DELETION_SCREEN } from "./copy.pt-BR";

export { EN_US_ACCOUNT_DELETION_SCREEN, PT_BR_ACCOUNT_DELETION_SCREEN };
export type { AccountDeletionScreenCopy };

export interface WebAccountDeletionConfig {
  /** Where the host mounted the routes (`GET`, `POST`, `POST …/cancel`). */
  readonly mount: string;
  /** What deleting erases, and what the host keeps (anonymised, by law…): the host's own promises. */
  readonly facts: { readonly goes: readonly string[]; readonly stays: readonly string[] };
  /** The IANA zone the purge date is worded in (the same as the API config's). */
  readonly timeZone: string;
  readonly locale?: "pt-BR" | "en-US";
  /** The provider whose fresh sign-in stands in for a password (default "google"). */
  readonly freshProvider?: string;
  /** Where to go after scheduling (default `/`), and the page to come back to after re-signing in. */
  readonly afterSchedule?: string;
  readonly pagePath?: string;
  /** After a cancel the session was moved on, so the person signs in again (default `/login`). */
  readonly afterCancel?: string;
  readonly fetchImpl?: typeof fetch;
  readonly copy?: AccountDeletionScreenCopy;
  /** Leave for another page (default `location.assign`); a test passes its own. */
  readonly navigate?: (url: string) => void;
}

/** What the screens need of the web auth's session. */
export interface AccountDeletionSessionHooks {
  useSession: () => { signIn: (provider?: string, callbackUrl?: string) => Promise<void>; signOut: () => Promise<void> };
}

/** The pending deletion a session answer carries, if any. */
export function pendingDeletionOf(session: unknown): { purgeAt: string } | null {
  const deletion = (session as { deletion?: { purgeAt?: unknown } } | null)?.deletion;
  return deletion && typeof deletion.purgeAt === "string" ? { purgeAt: deletion.purgeAt } : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

class Refusal extends Error {}

async function call<T>(fetchImpl: typeof fetch, url: string, body?: unknown): Promise<T> {
  const response = await fetchImpl(url, body === undefined ? { credentials: "same-origin" } : {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  // A server refusal says its own sentence; a network failure never reaches here as one.
  if (!response.ok) throw new Refusal(payload.error ?? "");
  return payload.data as T;
}

const sentenceOf = (failure: unknown, fallback: string): string =>
  failure instanceof Refusal && failure.message ? failure.message : fallback;

function Facts({ items, mark }: { items: readonly string[]; mark: "×" | "✓" }): JSX.Element | null {
  if (items.length === 0) return null;
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
            {row.action ? <Box component="a" href={row.href} sx={{ color: "inherit", fontWeight: 600 }}>{row.action}</Box> : null}
          </li>
        ))}
      </Box>
    </Alert>
  );
}

export interface WebAccountDeletion {
  /** "Excluir minha conta": the whole screen, with its heading. */
  readonly DeleteAccountPage: (props: { blockerAction?: (kind: string) => string; forfeitAction?: string }) => JSX.Element;
  /** "Sua conta será excluída em <data>": the only screen while pending. */
  readonly PendingDeletionScreen: (props: { purgeAt: string }) => JSX.Element;
}

export function createWebAccountDeletion(config: WebAccountDeletionConfig, hooks: AccountDeletionSessionHooks): WebAccountDeletion {
  const locale = config.locale ?? "pt-BR";
  const copy = config.copy ?? (locale === "en-US" ? EN_US_ACCOUNT_DELETION_SCREEN : PT_BR_ACCOUNT_DELETION_SCREEN);
  const fetchImpl: typeof fetch = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const dateOf = (iso: string): string => purgeDateWords(new Date(iso), locale, config.timeZone);
  const navigate = config.navigate ?? ((url: string) => globalThis.location.assign(url));

  function DeleteAccountPage({ blockerAction = () => "", forfeitAction = "" }: { blockerAction?: (kind: string) => string; forfeitAction?: string }): JSX.Element {
    const { signIn, signOut } = hooks.useSession();
    const [report, setReport] = useState<DeletionReport | null | "failed">(null);
    const [password, setPassword] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const alert = useRef<HTMLParagraphElement>(null);
    const load = useCallback(() => {
      setReport(null);
      call<DeletionReport>(fetchImpl, config.mount).then(setReport, () => setReport("failed"));
    }, []);
    useEffect(load, [load]);
    // The refusal is announced and takes focus, so a keyboard or screen-reader user lands on it.
    useEffect(() => {
      if (error) alert.current?.focus();
    }, [error]);
    const heading = <Text as="h1" variant="heading">{copy.title}</Text>;
    if (report === null) return <Box sx={{ display: "grid", gap: 2 }}>{heading}<LoadingState dataTestId="delete-account-loading" /></Box>;
    if (report === "failed") {
      return (
        <Box sx={{ display: "grid", gap: 2, justifyItems: "start" }}>
          {heading}
          <Text as="p" role="alert">{copy.loadFailed}</Text>
          <Button variant="outline" color="primary" size="md" onClick={load}>{copy.retry}</Button>
        </Box>
      );
    }
    const google = report.confirm === "google";
    const ready = report.canSchedule && (google ? report.freshSignIn : password.length > 0);
    const submit = async (event?: FormEvent): Promise<void> => {
      event?.preventDefault();
      if (!ready || pending) return;
      setPending(true);
      setError(null);
      try {
        await call(fetchImpl, config.mount, google ? {} : { password });
        await signOut().catch(() => undefined);
        navigate(config.afterSchedule ?? "/");
      } catch (failure) {
        setError(sentenceOf(failure, copy.failed));
        setPending(false);
      }
    };
    return (
      <Box component="form" noValidate onSubmit={(event: FormEvent) => void submit(event)} data-testid="delete-account-view" sx={{ display: "grid", gap: 2.5, containerType: "inline-size" }}>
        {heading}
        <Box sx={{ display: "grid", gap: 1, "@container (min-width: 560px)": { gridTemplateColumns: "1fr 1fr", columnGap: 3 } }}>
          <Facts items={config.facts.goes} mark="×" />
          <Facts items={config.facts.stays} mark="✓" />
        </Box>
        {report.state === "pending" ? <Alert variant="info" description={copy.alreadyPending} /> : null}
        <Notice title={copy.settleFirst} testId="delete-account-blockers" rows={report.blockers.map((b) => ({ text: b.label, href: b.href, action: blockerAction(b.kind) }))} />
        <Notice title={copy.forfeitTitle} testId="delete-account-forfeits" rows={report.forfeits.map((f) => ({ text: `${f.amount} — ${f.label}.`, href: f.href, action: forfeitAction }))} />
        {google ? (
          <Box sx={{ display: "grid", gap: 1, justifyItems: "start" }}>
            <Text as="p" size="sm">{report.freshSignIn ? copy.googleFresh : copy.googleLead}</Text>
            {report.freshSignIn ? null : (
              <Button variant="outline" color="primary" size="md" onClick={() => void signIn(config.freshProvider ?? "google", config.pagePath)} dataTestId="delete-account-google">{copy.googleAction}</Button>
            )}
          </Box>
        ) : (
          <Box sx={{ maxWidth: 360, width: "100%" }}>
            <Input label={copy.passwordLabel} type="password" fullWidth autoComplete="current-password" value={password} disabled={!report.canSchedule} error={error !== null} onChange={(event: { target: { value: string } }) => setPassword(event.target.value)} inputProps={{ "aria-describedby": error ? "delete-account-error" : undefined }} data-testid="delete-account-password" />
          </Box>
        )}
        {error ? (
          <Box component="p" ref={alert} tabIndex={-1} role="alert" id="delete-account-error" data-testid="delete-account-error" sx={{ m: 0, color: "error.main", outline: "none" }}>
            {error}
          </Box>
        ) : null}
        <Box sx={{ display: "grid", gap: 0.5 }}>
          <Text as="p" size="sm" color="secondary">{copy.when(dateOf(new Date(Date.now() + report.graceDays * DAY_MS).toISOString()))}</Text>
          <Text as="p" size="sm" color="secondary">{copy.irreversible(report.graceDays)}</Text>
        </Box>
        <Box>
          <Button type="submit" variant="solid" color="primary" size="md" loading={pending} disabled={!ready || pending} dataTestId="delete-account-submit">{copy.submit}</Button>
        </Box>
      </Box>
    );
  }

  function PendingDeletionScreen({ purgeAt }: { purgeAt: string }): JSX.Element {
    const { signOut } = hooks.useSession();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cancelButton = useRef<HTMLButtonElement>(null);
    const cancel = async (): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await call(fetchImpl, `${config.mount}/cancel`, {});
        // The cancel moved the session on (no token from the window outlives it): sign in again.
        await signOut().catch(() => undefined);
        navigate(config.afterCancel ?? "/login");
      } catch (failure) {
        setError(sentenceOf(failure, copy.failed));
        setBusy(false);
        cancelButton.current?.focus();
      }
    };
    return (
      <Box data-testid="deletion-pending-view" sx={{ maxWidth: 480, mx: "auto", width: "100%", px: 2, py: 4, display: "grid", gap: 2 }}>
        <Text as="h1" variant="heading">{copy.pendingTitle(dateOf(purgeAt))}</Text>
        <Text as="p" color="secondary">{copy.pendingBody}</Text>
        {error ? <Text as="p" size="sm" color="danger" role="alert">{error}</Text> : null}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Button ref={cancelButton} variant="solid" color="primary" size="md" loading={busy} disabled={busy} onClick={() => void cancel()} dataTestId="deletion-pending-cancel">{copy.pendingCancel}</Button>
          <Button variant="outline" color="primary" size="md" disabled={busy} onClick={() => void signOut().then(() => navigate("/"))} dataTestId="deletion-pending-sign-out">{copy.pendingSignOut}</Button>
        </Box>
      </Box>
    );
  }

  return { DeleteAccountPage, PendingDeletionScreen };
}
