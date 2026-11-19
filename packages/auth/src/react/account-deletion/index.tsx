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
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX, type RefObject } from "react";

import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { alpha } from "@12-apps/ui/mui/styles";
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
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {items.map((item) => (
        <Box component="li" key={item} sx={FACT_ROW_SX}>
          <Text as="span" color="secondary" aria-hidden>{mark}</Text>
          <Text as="span">{item}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** One fact row, with a hairline under every row but the last (the prototype's). */
const FACT_ROW_SX = {
  display: "flex",
  gap: 1,
  py: 1,
  borderBottom: 1,
  borderColor: "divider",
  "&:last-of-type": { borderBottom: 0 },
} as const;

/** The action inside a notice: inline, with a 40px tap target below `sm` that does not move the line. */
const ACTION_SX = {
  color: "inherit",
  fontWeight: 600,
  display: "inline-block",
  py: { xs: 1.5, sm: 0 },
  my: { xs: -1.5, sm: 0 },
} as const;

/** The flat, lightly tinted box of the prototype: static, so `status`, not `alert`. */
const NOTICE_SX = {
  bgcolor: (theme: { palette: { warning: { main: string } } }) => alpha(theme.palette.warning.main, 0.1),
  color: "text.primary",
  borderRadius: 1,
  px: 2,
  py: 1.5,
} as const;

interface NoticeRow {
  readonly lead: string;
  readonly text: string;
  readonly href: string;
  readonly action: string;
}

function Notice({ title, rows, testId }: { title: string; rows: readonly NoticeRow[]; testId: string }): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Box role="status" data-testid={testId} sx={NOTICE_SX}>
      <Text as="p" weight="semibold">{title}</Text>
      <Box component="ul" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.5 }}>
        {rows.map((row, index) => (
          <li key={`${row.href}-${index}`}>
            {row.lead ? <strong>{row.lead}</strong> : null}
            {row.lead ? " " : null}
            {row.text}{" "}
            {row.action ? <Box component="a" href={row.href} sx={ACTION_SX}>{row.action}</Box> : null}
          </li>
        ))}
      </Box>
    </Box>
  );
}

/** One error style on both screens: announced as it appears. */
function ErrorLine({ message, id }: { message: string | null; id?: string }): JSX.Element | null {
  if (!message) return null;
  return <Text as="p" size="sm" color="danger" role="alert" id={id} data-testid={id ?? "deletion-error"}>{message}</Text>;
}

/** The bordered surface both screens sit on (the prototype's card), capped at the package's form measure. */
const CARD_SX = {
  boxSizing: "border-box",
  maxWidth: 720,
  mx: "auto",
  border: 1,
  borderColor: "divider",
  borderRadius: 2,
  p: { xs: 2, sm: 3 },
} as const;

export interface WebAccountDeletion {
  /** "Excluir minha conta": the whole screen, with its heading. */
  readonly DeleteAccountPage: (props: PageProps) => JSX.Element;
  /** "Sua conta será excluída em <data>": the only screen while pending. */
  readonly PendingDeletionScreen: (props: { purgeAt: string }) => JSX.Element;
}

interface PageProps {
  /** The link's words for one blocker kind ("Ver pedido"). */
  readonly blockerAction?: (kind: string) => string;
  /** The link's words for one forfeit kind ("Usar antes"): a vale cannot be refunded, credit can. */
  readonly forfeitAction?: (kind: string) => string;
}

/** What both screens read: the config, resolved once. */
interface Ctx {
  readonly config: WebAccountDeletionConfig;
  readonly hooks: AccountDeletionSessionHooks;
  readonly copy: AccountDeletionScreenCopy;
  readonly fetchImpl: typeof fetch;
  readonly navigate: (url: string) => void;
  readonly dateOf: (iso: string) => string;
}

type Loaded = DeletionReport | null | "failed";

/** The page's state and its one act: the report, the password, the refusal, and the submit. */
function useDeleteAccount(ctx: Ctx) {
  const { signOut } = ctx.hooks.useSession();
  const [report, setReport] = useState<Loaded>(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    setReport(null);
    call<DeletionReport>(ctx.fetchImpl, ctx.config.mount).then(setReport, () => setReport("failed"));
  }, [ctx]);
  useEffect(load, [load]);
  // After a refusal the next act is typing again: focus (and select) the field; the message is announced on its own.
  useEffect(() => {
    if (!error) return;
    const input = field.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [error]);
  const submit = async (shown: DeletionReport): Promise<void> => {
    if (pending || !isReady(shown, password)) return;
    setPending(true);
    setError(null);
    try {
      await call(ctx.fetchImpl, ctx.config.mount, shown.confirm === "google" ? {} : { password });
      await signOut().catch(() => undefined);
      ctx.navigate(ctx.config.afterSchedule ?? "/");
    } catch (failure) {
      setError(sentenceOf(failure, ctx.copy.failed));
      setPending(false);
    }
  };
  return { report, load, password, setPassword, pending, error, field, submit };
}

/** The button may go: nothing blocks, and the person is confirmed (password typed, or a fresh sign-in). */
function isReady(report: DeletionReport, password: string): boolean {
  if (!report.canSchedule) return false;
  return report.confirm === "google" ? report.freshSignIn : password.length > 0;
}

function Heading({ ctx }: { ctx: Ctx }): JSX.Element {
  return <Text as="h1" variant="heading">{ctx.copy.title}</Text>;
}

function LoadFailed({ ctx, retry }: { ctx: Ctx; retry: () => void }): JSX.Element {
  return (
    <Box sx={{ display: "grid", gap: 2, justifyItems: "start" }}>
      <Heading ctx={ctx} />
      <Text as="p" role="alert">{ctx.copy.loadFailed}</Text>
      <Button variant="outline" color="primary" size="md" onClick={retry}>{ctx.copy.retry}</Button>
    </Box>
  );
}

interface ConfirmationProps {
  readonly ctx: Ctx;
  readonly report: DeletionReport;
  readonly password: string;
  readonly setPassword: (value: string) => void;
  readonly error: string | null;
  readonly field: RefObject<HTMLDivElement | null>;
}

/** How the person confirms: a fresh sign-in for an account with no password, else the password. */
function Confirmation({ ctx, report, password, setPassword, error, field }: ConfirmationProps): JSX.Element {
  const { signIn } = ctx.hooks.useSession();
  if (report.confirm === "google") {
    return (
      <Box sx={{ display: "grid", gap: 1, justifyItems: "start" }}>
        <Text as="p" size="sm">{report.freshSignIn ? ctx.copy.googleFresh : ctx.copy.googleLead}</Text>
        {report.freshSignIn ? null : (
          <Button variant="outline" color="primary" size="md" onClick={() => void signIn(ctx.config.freshProvider ?? "google", ctx.config.pagePath)} dataTestId="delete-account-google">{ctx.copy.googleAction}</Button>
        )}
      </Box>
    );
  }
  return (
    <Box ref={field} sx={{ maxWidth: 360, width: "100%" }}>
      <Input label={ctx.copy.passwordLabel} type="password" fullWidth autoComplete="current-password" value={password} disabled={!report.canSchedule} error={error !== null} onChange={(event: { target: { value: string } }) => setPassword(event.target.value)} inputProps={{ "aria-describedby": error ? "delete-account-error" : undefined }} data-testid="delete-account-password" />
    </Box>
  );
}

interface NoticesProps {
  readonly ctx: Ctx;
  readonly report: DeletionReport;
  readonly blockerAction: (kind: string) => string;
  readonly forfeitAction: (kind: string) => string;
}

function Notices({ ctx, report, blockerAction, forfeitAction }: NoticesProps): JSX.Element {
  return (
    <>
      {report.state === "pending" ? <Text as="p" role="status" color="secondary">{ctx.copy.alreadyPending}</Text> : null}
      <Notice title={ctx.copy.settleFirst} testId="delete-account-blockers" rows={report.blockers.map((b) => ({ lead: "", text: b.label, href: b.href, action: blockerAction(b.kind) }))} />
      <Notice title={ctx.copy.forfeitTitle} testId="delete-account-forfeits" rows={report.forfeits.map((f) => ({ lead: f.amount, text: f.label, href: f.href, action: forfeitAction(f.kind) }))} />
    </>
  );
}

function When({ ctx, report }: { ctx: Ctx; report: DeletionReport }): JSX.Element {
  return (
    <Box sx={{ display: "grid", gap: 0.5 }}>
      <Text as="p" size="sm" color="secondary">{ctx.copy.when(ctx.dateOf(new Date(Date.now() + report.graceDays * DAY_MS).toISOString()))}</Text>
      <Text as="p" size="sm" color="secondary">{ctx.copy.irreversible(report.graceDays)}</Text>
    </Box>
  );
}

function DeleteAccountPage({ ctx, actions }: { ctx: Ctx; actions: PageProps }): JSX.Element {
  const page = useDeleteAccount(ctx);
  const { report } = page;
  if (report === null) return <Box sx={{ display: "grid", gap: 2 }}><Heading ctx={ctx} /><LoadingState dataTestId="delete-account-loading" /></Box>;
  if (report === "failed") return <LoadFailed ctx={ctx} retry={page.load} />;
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void page.submit(report);
  };
  return (
    <Box component="form" noValidate onSubmit={onSubmit} data-testid="delete-account-view" sx={{ ...CARD_SX, display: "grid", gap: 2.5, containerType: "inline-size" }}>
      <Heading ctx={ctx} />
      <Box sx={{ display: "grid", gap: 1, "@container (min-width: 640px)": { gridTemplateColumns: "1fr 1fr", columnGap: 3 } }}>
        <Facts items={ctx.config.facts.goes} mark="×" />
        <Facts items={ctx.config.facts.stays} mark="✓" />
      </Box>
      <Notices ctx={ctx} report={report} blockerAction={actions.blockerAction ?? (() => "")} forfeitAction={actions.forfeitAction ?? (() => "")} />
      <Confirmation ctx={ctx} report={report} password={page.password} setPassword={page.setPassword} error={page.error} field={page.field} />
      <ErrorLine message={page.error} id="delete-account-error" />
      <When ctx={ctx} report={report} />
      <Box>
        <Button type="submit" variant="solid" color="primary" size="md" loading={page.pending} disabled={!isReady(report, page.password) || page.pending} dataTestId="delete-account-submit">{ctx.copy.submit}</Button>
      </Box>
    </Box>
  );
}

function PendingDeletionScreen({ ctx, purgeAt }: { ctx: Ctx; purgeAt: string }): JSX.Element {
  const { signOut } = ctx.hooks.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const cancel = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await call(ctx.fetchImpl, `${ctx.config.mount}/cancel`, {});
      // The cancel moved the session on (no token from the window outlives it): sign in again.
      await signOut().catch(() => undefined);
      ctx.navigate(ctx.config.afterCancel ?? "/login");
    } catch (failure) {
      setError(sentenceOf(failure, ctx.copy.failed));
      setBusy(false);
    }
  };
  // After the re-render that enables the button again: focus on a disabled button does nothing.
  useEffect(() => {
    if (error && !busy) cancelButton.current?.focus();
  }, [error, busy]);
  return (
    <Box data-testid="deletion-pending-view" sx={{ ...CARD_SX, maxWidth: 480, my: 4, display: "grid", gap: 2 }}>
      <Text as="h1" variant="heading">{ctx.copy.pendingTitle(ctx.dateOf(purgeAt))}</Text>
      <Text as="p" color="secondary">{ctx.copy.pendingBody}</Text>
      <ErrorLine message={error} />
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <Button ref={cancelButton} variant="solid" color="primary" size="md" loading={busy} disabled={busy} onClick={() => void cancel()} dataTestId="deletion-pending-cancel">{ctx.copy.pendingCancel}</Button>
        <Button variant="outline" color="primary" size="md" disabled={busy} onClick={() => void signOut().then(() => ctx.navigate("/"))} dataTestId="deletion-pending-sign-out">{ctx.copy.pendingSignOut}</Button>
      </Box>
    </Box>
  );
}

export function createWebAccountDeletion(config: WebAccountDeletionConfig, hooks: AccountDeletionSessionHooks): WebAccountDeletion {
  const locale = config.locale ?? "pt-BR";
  const ctx: Ctx = {
    config,
    hooks,
    copy: config.copy ?? (locale === "en-US" ? EN_US_ACCOUNT_DELETION_SCREEN : PT_BR_ACCOUNT_DELETION_SCREEN),
    fetchImpl: config.fetchImpl ?? ((...args) => globalThis.fetch(...args)),
    navigate: config.navigate ?? ((url: string) => globalThis.location.assign(url)),
    dateOf: (iso: string): string => purgeDateWords(new Date(iso), locale, config.timeZone),
  };
  return {
    DeleteAccountPage: (actions: PageProps) => <DeleteAccountPage ctx={ctx} actions={actions} />,
    PendingDeletionScreen: (props: { purgeAt: string }) => <PendingDeletionScreen ctx={ctx} purgeAt={props.purgeAt} />,
  };
}
